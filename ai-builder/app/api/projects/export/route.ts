import { z } from "zod";
import { getAuthConfig, getSessionUserId, isSameOrigin, rateLimitKey } from "@/lib/auth";
import {
  DatabaseConfigurationError,
  BuilderProjectNotFoundError,
  databaseErrorCode,
  databaseFailureMessage,
  ensureBillingSchema,
  getActiveSubscription,
  ProAccessRequiredError,
  saveBuilderProject,
} from "@/lib/database";
import { ProjectResponseSchema } from "@/lib/project-response";
import { checkRateLimit } from "@/lib/rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";

const ExportRequestSchema = z.object({
  projectId: z.string().uuid(),
  files: z.unknown(),
  dependencies: z.unknown(),
});

function response(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return response({ error: "Request origin is not allowed." }, 403);
  const config = getAuthConfig();
  const userId = getSessionUserId(request);
  if (!userId || !config) return response({ error: "Sign in to export a project." }, 401);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return response({ error: "Content-Type must be application/json." }, 415);
  }

  const rate = checkRateLimit(rateLimitKey(config.secret, "project-export", userId), 10, 60_000);
  if (!rate.allowed) return response({ error: "Please wait before exporting another project." }, 429);

  let payload: unknown;
  try {
    payload = await readJsonBody(request, 200_000);
  } catch (error) {
    return response(
      { error: "Provide a valid project within the export size limit." },
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }

  const requestResult = ExportRequestSchema.safeParse(payload);
  if (!requestResult.success) return response({ error: "Select a valid project to export." }, 400);
  const projectResult = ProjectResponseSchema.safeParse({
    status: "files",
    message: "Project export",
    files: requestResult.data.files,
    dependencies: requestResult.data.dependencies,
  });
  if (!projectResult.success || projectResult.data.status !== "files") {
    return response({ error: "The project files are invalid or exceed the export limits." }, 400);
  }

  try {
    await ensureBillingSchema();
    if (!(await getActiveSubscription(userId))) {
      return response({ error: "Upgrade to Phollet AI Pro to export project files." }, 402);
    }
    const saved = await saveBuilderProject(
      userId,
      requestResult.data.projectId,
      projectResult.data.files,
      projectResult.data.dependencies,
    );
    const body = JSON.stringify({ files: saved.files, dependencies: saved.dependencies }, null, 2);
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Disposition": 'attachment; filename="phollet-project.json"',
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return response({ error: "Project and subscription storage is not configured." }, 503);
    }
    if (error instanceof BuilderProjectNotFoundError) {
      return response({ error: "This project was not found." }, 404);
    }
    if (error instanceof ProAccessRequiredError) {
      return response({ error: "Upgrade to Phollet AI Pro to export project files." }, 402);
    }
    const message = databaseFailureMessage(error);
    if (message) {
      console.error("Builder project export could not reach PostgreSQL.", { errorCode: databaseErrorCode(error) });
      return response({ error: message }, 503);
    }
    console.error("Builder project export failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response({ error: "Could not export this project. Please try again." }, 503);
  }
}
