import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { parseModelJson } from "@/lib/project-response";
import {
  getAuthConfig,
  isSameOrigin,
  rateLimitKey,
  getSessionUserId,
  sessionIdentity,
} from "@/lib/auth";
import {
  BuilderProjectNotFoundError,
  DatabaseConfigurationError,
  FreeTrialLimitError,
  ProAccessRequiredError,
  databaseErrorCode,
  databaseFailureMessage,
  ensureBillingSchema,
  getActiveSubscription,
  getBuilderAccess,
  getBuilderProject,
  saveBuilderProject,
} from "@/lib/database";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/request-body";
import { checkRateLimit } from "@/lib/rate-limit";
import { FREE_TRIAL_PROJECT_LIMIT } from "@/lib/payments/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const RequestSchema = z.object({
  projectId: z.string().uuid().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(16000).refine((content) => !content.includes("\0")),
        kind: z.enum(["proposal", "files", "error"]).optional(),
      }),
    )
    .min(1)
    .max(24),
  images: z
    .array(
      z.object({
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        data: z
          .string()
          .min(1)
          .max(2_800_000)
          .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
      }),
    )
    .max(4)
    .optional()
    .default([]),
});

type ImageInput = z.infer<typeof RequestSchema>["images"][number];

class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super("AI provider request failed.");
    this.name = "ProviderHttpError";
  }
}

const SYSTEM_PROMPT = `You are Phollet Builder, a senior React UI engineer and UX designer.
Match the language of the user's latest message (Khmer, Thai, English, or another language).

This is an interactive website-building workflow:
1. For a new website request, first return a concise proposal explaining page/component structure, visual theme, and key features. Ask the user to approve or request changes. Do not return implementation files before approval.
2. After the user clearly approves the latest proposal (for example: "OK", "សូមធ្វើ", or "យល់ព្រម"), return the complete project files.
3. If the user asks to revise a proposal, return an updated proposal and ask for approval again.
4. For code edits to an already generated project, return the complete updated file set needed for the project to work.

Every response MUST be exactly one valid JSON object with no Markdown fences or surrounding prose.
Proposal shape:
{"status":"proposal","message":"A concise proposal in the user's language"}
Generated project shape:
{"status":"files","message":"A concise completion note in the user's language","files":[{"path":"/App.tsx","content":"..."}],"dependencies":{"lucide-react":"1.56.0"}}

Project constraints:
- Generate a React + TypeScript project that runs in a browser preview, not a server-side Next.js app.
- Always include /App.tsx and /styles.css; include other source files when needed.
- Use React, semantic accessible markup, and responsive layouts. Prefer plain CSS; Tailwind utility classes are available in the preview.
- Return only source files with paths beginning with /. Do not return package.json, lockfiles, environment files, secrets, scripts, or server-side code.
- Keep generated dependencies minimal. Include only packages imported by generated files, with exact semver versions.
- Never claim that files were saved to disk; files are rendered in the in-browser sandbox.`;

type ProviderMessage = {
  role: "user" | "assistant";
  content: string;
  images?: ImageInput[];
};

type JsonChatCompletion = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  error?: {
    message?: unknown;
  };
};

function getAssistantText(content: Anthropic.Messages.Message["content"]): string {
  return content
   .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
.map((block: Anthropic.Messages.TextBlock) => block.text)
    .join("\n")
    .trim();
}

function jsonResponse(body: unknown, status = 200, additionalHeaders?: HeadersInit) {
  const headers = new Headers(additionalHeaders);
  headers.set("Cache-Control", "no-store, max-age=0");
  return Response.json(body, { status, headers });
}

function validateImageData(images: ImageInput[]) {
  let totalBytes = 0;
  for (const image of images) {
    const bytes = Buffer.from(image.data, "base64");
    totalBytes += bytes.byteLength;
    if (bytes.byteLength === 0 || bytes.byteLength > 1_572_864 || totalBytes > 2_097_152) {
      return false;
    }

    const validSignature =
      (image.mimeType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
      (image.mimeType === "image/png" &&
        bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
      (image.mimeType === "image/webp" &&
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP");
    if (!validSignature) return false;
  }
  return true;
}

async function fetchProvider(endpoint: string, init: RequestInit) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(endpoint, {
      ...init,
      signal: AbortSignal.timeout(75_000),
    });
    if (![503, 504].includes(response.status) || attempt >= 1) {
      return response;
    }
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function callOpenAICompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
) {
  const response = await fetchProvider(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages.map(({ role, content, images }) => ({
          role,
          content: images?.length
            ? [
                { type: "text", text: content },
                ...images.map((image) => ({
                  type: "image_url",
                  image_url: { url: `data:${image.mimeType};base64,${image.data}` },
                })),
              ]
            : content,
        })),
      ],
    }),
  });

  const body = await response.text();
  let data: JsonChatCompletion | null;
  try {
    data = body ? (JSON.parse(body) as JsonChatCompletion) : null;
  } catch {
    throw new Error("The AI provider returned an invalid response.");
  }

  if (!response.ok) {
    throw new ProviderHttpError(response.status);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("The AI provider returned no generated content.");
  }
  return content;
}

async function callAnthropic(messages: ProviderMessage[]) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: messages.map(({ role, content, images }) => ({
      role,
      content: images?.length
        ? [
            { type: "text" as const, text: content },
            ...images.map((image) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: image.mimeType,
                data: image.data,
              },
            })),
          ]
        : content,
    })),
  });

  return getAssistantText(response.content);
}

async function callDeepSeek(messages: ProviderMessage[]) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return null;
  }

  return callOpenAICompatible(
    "https://api.deepseek.com/chat/completions",
    apiKey,
    process.env.DEEPSEEK_MODEL || "deepseek-chat",
    messages,
  );
}

async function callGroq(messages: ProviderMessage[]) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return null;
  }
  const hasImages = messages.some((message) => message.images?.length);
  if (hasImages && !process.env.GROQ_VISION_MODEL) {
    throw new Error("Configure a vision-capable model with GROQ_VISION_MODEL to analyze images.");
  }

  return callOpenAICompatible(
    "https://api.groq.com/openai/v1/chat/completions",
    apiKey,
    hasImages ? process.env.GROQ_VISION_MODEL! : process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    messages,
  );
}

async function callGemini(messages: ProviderMessage[]) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const requestModel = (modelName: string) =>
    fetchProvider(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: messages.map(({ role, content, images }) => ({
            role: role === "assistant" ? "model" : "user",
            parts: [
              { text: content },
              ...(images ?? []).map((image) => ({
                inlineData: { mimeType: image.mimeType, data: image.data },
              })),
            ],
          })),
          generationConfig: {
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
      },
    );
  let response = await requestModel(model);
  if (model === "gemini-3.5-flash" && [503, 504].includes(response.status)) {
    await response.body?.cancel();
    response = await requestModel("gemini-3.5-flash-lite");
  }

  const body = await response.text();
  let data: unknown;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    throw new Error("The AI provider returned an invalid response.");
  }

  if (!response.ok) {
    throw new ProviderHttpError(response.status);
  }

  if (typeof data !== "object" || data === null || !("candidates" in data) || !Array.isArray(data.candidates)) {
    throw new Error("The AI provider returned an invalid response.");
  }

  const candidate = data.candidates[0];
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("content" in candidate) ||
    typeof candidate.content !== "object" ||
    candidate.content === null ||
    !("parts" in candidate.content) ||
    !Array.isArray(candidate.content.parts)
  ) {
    throw new Error("The AI provider returned no generated content.");
  }

  const parts: unknown[] = candidate.content.parts;
  const content = parts
    .filter((part: unknown): part is { text: string } =>
      typeof part === "object" && part !== null && "text" in part && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!content) {
    throw new Error("The AI provider returned no generated content.");
  }
  return content;
}

export async function POST(request: Request) {
  const authConfig = getAuthConfig();
  if (!authConfig) {
    return jsonResponse({ error: "Builder access is not securely configured." }, 503);
  }
  if (!isSameOrigin(request)) {
    return jsonResponse({ error: "Request origin is not allowed." }, 403);
  }
  const userId = getSessionUserId(request);
  if (!userId) {
    return jsonResponse({ error: "Sign in to use the Builder." }, 401);
  }
  let hasSubscription = false;
try {
  await ensureBillingSchema();
  hasSubscription = Boolean(await getActiveSubscription(userId));
   } catch (error) {
  if (error instanceof DatabaseConfigurationError) {
    return jsonResponse({ error: "Account and subscription storage is not configured." }, 503);
  }
  console.error("Builder subscription check failed.", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 503);
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ error: "Content-Type must be application/json." }, 415);
  }

  const limit = checkRateLimit(
    rateLimitKey(authConfig.secret, "generate", sessionIdentity(request)),
    12,
    60_000,
  );
  if (!limit.allowed) {
    return jsonResponse(
      { error: "Too many generation requests. Please wait a minute and try again." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  let payload: unknown;
  try {
    payload = await readJsonBody(request, 4 * 1024 * 1024);
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    return jsonResponse({ error: "Provide a valid generation request within the size limit." }, status);
  }

  const parsedRequest = RequestSchema.safeParse(payload);
  if (!parsedRequest.success) {
    return jsonResponse({ error: "Provide a valid conversation to generate a project." }, 400);
  }
  if (parsedRequest.data.messages.at(-1)?.role !== "user") {
    return jsonResponse({ error: "The latest message must be from the user." }, 400);
  }
  if (!validateImageData(parsedRequest.data.images)) {
    return jsonResponse({ error: "Images must be valid JPEG, PNG, or WebP files within the upload limit." }, 400);
  }

  const conversation = parsedRequest.data.messages;
  const images = parsedRequest.data.images;
  const projectId = parsedRequest.data.projectId;
  const latestUserMessage = conversation.at(-1)?.content ?? "";
  const previousAssistantMessage = conversation
    .slice(0, -1)
    .findLast((message) => message.role === "assistant");
  const approval = /^(?:ok(?:ay)?|yes|approved?|go ahead|proceed|sounds good|យល់ព្រម|សូមធ្វើ|បាទ|ចាស|បាន|អនុម័ត|ตกลง|อนุมัติ|ทำเลย|ใช่)[.!၊。!?\s]*$/i.test(
    latestUserMessage.trim(),
  );
  const canGenerateFiles =
    previousAssistantMessage?.kind === "files" ||
    (previousAssistantMessage?.kind === "proposal" && approval);

    if (canGenerateFiles && !hasSubscription) {
  return jsonResponse(
    {
      error: "Upgrade to Phollet AI Pro to generate the full project code.",
      code: "subscription_required",
    },
    402,
  );
}

  const provider =
    process.env.AI_PROVIDER?.trim().toLowerCase() ||
    (images.length > 0
      ? process.env.GEMINI_API_KEY
        ? "gemini"
        : process.env.ANTHROPIC_API_KEY
          ? "anthropic"
          : process.env.GROQ_API_KEY
            ? "groq"
            : process.env.DEEPSEEK_API_KEY
              ? "deepseek"
              : ""
      : process.env.GROQ_API_KEY
        ? "groq"
        : process.env.GEMINI_API_KEY
          ? "gemini"
          : process.env.ANTHROPIC_API_KEY
            ? "anthropic"
            : process.env.DEEPSEEK_API_KEY
              ? "deepseek"
              : "");

  try {
    const currentProject = projectId ? await getBuilderProject(userId, projectId) : null;
    const providerMessages: ProviderMessage[] = conversation.map(({ role, content }, index) => ({
      role,
      content,
      ...(index === conversation.length - 1 && images.length > 0 ? { images } : {}),
    }));
    if (currentProject && canGenerateFiles) {
      providerMessages.splice(providerMessages.length - 1, 0, {
        role: "assistant",
        content: `Current saved project files:\n${JSON.stringify({
          files: currentProject.files,
          dependencies: currentProject.dependencies,
        })}`,
      });
    }

    if (images.length > 0 && (provider === "deepseek" || provider === "")) {
      return jsonResponse(
        {
          error:
            "The selected AI provider does not support image input. Configure Gemini, Anthropic, or a vision-capable Groq model.",
        },
        400,
      );
    }
    let content: string | null;
    if (provider === "anthropic") {
      content = await callAnthropic(providerMessages);
    } else if (provider === "deepseek") {
      content = await callDeepSeek(providerMessages);
    } else if (provider === "groq") {
      content = await callGroq(providerMessages);
    } else if (provider === "gemini") {
      content = await callGemini(providerMessages);
    } else {
      return jsonResponse({ error: "Configure AI_PROVIDER and its server-side API key to enable generation." }, 503);
    }

    if (!content) {
      return jsonResponse({ error: `The ${provider} API key is missing from the server environment.` }, 503);
    }

    const result = parseModelJson(content);
    if (result.status === "files" && !canGenerateFiles) {
      const languagePrompt = /[\u1780-\u17ff]/.test(latestUserMessage)
        ? "សូមពិនិត្យសំណើររចនាខាងលើ ហើយឆ្លើយ «យល់ព្រម» ដើម្បីឱ្យខ្ញុំបង្កើតកូដ។"
        : /[\u0e00-\u0e7f]/.test(latestUserMessage)
          ? "โปรดตรวจสอบข้อเสนอด้านบน แล้วตอบว่า “ตกลง” เพื่อให้ฉันสร้างโค้ด"
          : "Please review the proposal above and reply “OK” to generate the code.";
      return jsonResponse({ status: "proposal", message: languagePrompt });
    }
    if (result.status === "files") {
      const savedProject = await saveBuilderProject(
        userId,
        projectId,
        result.files,
        result.dependencies,
      );
      return jsonResponse({ ...result, projectId: savedProject.id });
    }
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof FreeTrialLimitError) {
      return jsonResponse(
        { error: "Your free project is ready. Upgrade to Pro to start another project." },
        402,
      );
    }
    if (error instanceof BuilderProjectNotFoundError) {
      return jsonResponse({ error: "This project was not found." }, 404);
    }
    if (error instanceof ProAccessRequiredError) {
      return jsonResponse({ error: "An active Pro plan is required to continue this project." }, 402);
    }
    if (error instanceof DatabaseConfigurationError) {
      return jsonResponse({ error: "Project storage is not configured." }, 503);
    }
    const databaseMessage = databaseFailureMessage(error);
    if (databaseMessage) {
      console.error("Generated project could not be saved to PostgreSQL.", {
        errorCode: databaseErrorCode(error),
      });
      return jsonResponse({ error: databaseMessage }, 503);
    }
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const providerStatus = error instanceof ProviderHttpError
      ? error.status
      : typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
        ? error.status
        : undefined;
    console.error("AI project generation failed.", { provider, errorName, providerStatus });
    return jsonResponse(
      { error: "The AI provider could not complete this request. Check server configuration and try again." },
      502,
    );
  }
}
