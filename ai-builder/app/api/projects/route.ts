import { z } from "zod";
import { getAuthConfig, getSessionUserId, isSameOrigin, rateLimitKey } from "@/lib/auth";
import {
  BuilderProjectNotFoundError,
  DatabaseConfigurationError,
  databaseErrorCode,
  databaseFailureMessage,
  ensureBillingSchema,
  getBuilderProject,
  getBuilderProjects,
  ProAccessRequiredError,
  saveBuilderProject,
} from "@/lib/database";
import { ProjectResponseSchema } from "@/lib/project-response";
import { checkRateLimit } from "@/lib/rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ProjectSaveRequestSchema = z.object({
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

export async function GET(request: Request) {
  if (!getAuthConfig()) return response({ error: "Builder access is not securely configured." }, 503);
  const userId = getSessionUserId(request);
  if (!userId) return response({ error: "Sign in to access this project." }, 401);

  const projectId = new URL(request.url).searchParams.get("id");
  try {
    await ensureBillingSchema();
    if (!projectId) return response({ projects: await getBuilderProjects(userId) });
    if (!z.string().uuid().safeParse(projectId).success) {
      return response({ error: "This project identifier is invalid." }, 400);
    }
    const project = await getBuilderProject(userId, projectId);
    if (!project) return response({ error: "This project was not found." }, 404);
    return response(project);
     } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return response({ error: "Project storage is not configured." }, 503);
    }
    const message = databaseFailureMessage(error);
    if (message) {
      console.error("Builder project lookup could not reach PostgreSQL.", { errorCode: databaseErrorCode(error) });
      return response({ error: message }, 503);
    }
    console.error("Builder project lookup failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response({ error: "Could not load your projects. Please try again." }, 503);
  }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return response({ error: "Request origin is not allowed." }, 403);
  const config = getAuthConfig();
  const userId = getSessionUserId(request);
  if (!userId || !config) return response({ error: "Sign in to save this project." }, 401);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return response({ error: "Content-Type must be application/json." }, 415);
  }
  const rate = checkRateLimit(rateLimitKey(config.secret, "project-save", userId), 30, 60_000);
  if (!rate.allowed) return response({ error: "Please wait before saving more project changes." }, 429);

  let payload: unknown;
  try {
    payload = await readJsonBody(request, 200_000);
  } catch (error) {
    return response(
      { error: "Provide a valid project within the save size limit." },
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }
  const requestResult = ProjectSaveRequestSchema.safeParse(payload);
  if (!requestResult.success) return response({ error: "Select a valid project to save." }, 400);
  const projectResult = ProjectResponseSchema.safeParse({
    status: "files",
    message: "Project update",
    files: requestResult.data.files,
    dependencies: requestResult.data.dependencies,
  });
  if (!projectResult.success || projectResult.data.status !== "files") {
    return response({ error: "The project files are invalid or exceed the save limits." }, 400);
  }

  try {
    await ensureBillingSchema();
    await saveBuilderProject(
      userId,
      requestResult.data.projectId,
      projectResult.data.files,
      projectResult.data.dependencies,
    );
    return response({ saved: true });
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return response({ error: "Project storage is not configured." }, 503);
    }
    if (error instanceof BuilderProjectNotFoundError) {
      return response({ error: "This project was not found." }, 404);
    }
    if (error instanceof ProAccessRequiredError) {
      return response({ error: "An active Pro plan is required to save this project." }, 402);
    }
    const message = databaseFailureMessage(error);
    if (message) {
      console.error("Builder project save could not reach PostgreSQL.", { errorCode: databaseErrorCode(error) });
      return response({ error: message }, 503);
    }
    console.error("Builder project save failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response({ error: "Could not save this project. Please try again." }, 503);
  }
}
