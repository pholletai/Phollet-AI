import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  clearSessionCookie,
  createSessionCookie,
  getAuthConfig,
  getSessionUserId,
  isSameOrigin,
  opaqueRequestIdentity,
  rateLimitKey,
} from "@/lib/auth";
import {
  DatabaseConfigurationError,
  databaseErrorCode,
  databaseFailureMessage,
  ensureBillingSchema,
  getBuilderAccess,
  getPool,
} from "@/lib/database";
import {
  MailConfigurationError,
  MailDeliveryError,
  sendVerificationEmail,
} from "@/lib/mail";
import { hashPassword, verifyPassword } from "@/lib/password";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/request-body";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AuthSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("register"),
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(256),
  }),
  z.object({
    action: z.literal("login"),
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(256),
  }),
]);

function authResponse(body: object, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store, max-age=0");
  responseHeaders.set("Pragma", "no-cache");
  return Response.json(body, { status, headers: responseHeaders });
}

function rateLimit(request: Request, kind: "register" | "login", email: string) {
  const config = getAuthConfig();
  if (!config) return { allowed: false, retryAfterSeconds: 60 };
  const results =
    kind === "register"
      ? [
          checkRateLimit(
            rateLimitKey(config.secret, "register:ip", opaqueRequestIdentity(request)),
            25,
            15 * 60_000,
          ),
          checkRateLimit(
            rateLimitKey(config.secret, "register:email", email),
            5,
            15 * 60_000,
          ),
        ]
      : [
          checkRateLimit(
            rateLimitKey(config.secret, "login:ip", opaqueRequestIdentity(request)),
            60,
            15 * 60_000,
          ),
          checkRateLimit(
            rateLimitKey(config.secret, "login:email", email),
            12,
            15 * 60_000,
          ),
        ];
  const blocked = results.filter((result) => !result.allowed);
  return {
    allowed: blocked.length === 0,
    retryAfterSeconds: Math.max(1, ...blocked.map((result) => result.retryAfterSeconds)),
  };
}

export async function GET(request: Request) {
  try {
    const verifyToken = new URL(request.url).searchParams.get("verify");
    if (verifyToken) {
      await ensureBillingSchema();
      if (!/^[A-Za-z0-9_-]{43}$/.test(verifyToken)) {
        return authResponse({ error: "This verification link is invalid or expired." }, 400);
      }
      const tokenHash = createHash("sha256").update(verifyToken).digest("hex");
      const result = await getPool().query(
        `UPDATE builder_users
         SET verified_at = NOW(), verification_token_hash = NULL, verification_expires_at = NULL
         WHERE verification_token_hash = $1
           AND verification_expires_at > NOW()
           AND verified_at IS NULL`,
        [tokenHash],
      );
      if (result.rowCount !== 1) {
        return authResponse({ error: "This verification link is invalid or expired." }, 400);
      }
      return authResponse({ verified: true });
    }

    const userId = getSessionUserId(request);
    if (!userId) return authResponse({ authenticated: false });
    await ensureBillingSchema();
    const access = await getBuilderAccess(userId);
    if (!access) return authResponse({ authenticated: false });
    return authResponse({ authenticated: true, ...access });
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return authResponse({ error: "Account storage is not configured." }, 503);
    }
    const databaseMessage = databaseFailureMessage(error);
    if (databaseMessage) {
      console.error("Account status request could not reach PostgreSQL.", {
        errorCode: databaseErrorCode(error),
      });
      return authResponse({ error: databaseMessage }, 503);
    }
    console.error("Account status request failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return authResponse({ error: "Account service is temporarily unavailable." }, 503);
  }
}

export async function POST(request: Request) {
  if (!getAuthConfig()) return authResponse({ error: "Account sessions are not configured." }, 503);
  if (!isSameOrigin(request)) return authResponse({ error: "Request origin is not allowed." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return authResponse({ error: "Content-Type must be application/json." }, 415);
  }

  let payload: unknown;
  try {
    payload = await readJsonBody(request, 4096);
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    return authResponse({ error: "Provide a valid account request." }, status);
  }
  const parsed = AuthSchema.safeParse(payload);
  if (!parsed.success) return authResponse({ error: "Enter a valid email and password." }, 400);

  const { action, password } = parsed.data;
  const email = parsed.data.email.toLowerCase();
  const attemptLimit = rateLimit(request, action, email);
  if (!attemptLimit.allowed) {
    const waitMinutes = Math.max(1, Math.ceil(attemptLimit.retryAfterSeconds / 60));
    const actionText = action === "register" ? "sign-up" : "sign-in";
    return authResponse(
      {
        error: `Too many ${actionText} attempts. Please wait about ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"} and try again.`,
        retryAfterSeconds: attemptLimit.retryAfterSeconds,
      },
      429,
      { "Retry-After": String(attemptLimit.retryAfterSeconds) },
    );
  }

  try {
    await ensureBillingSchema();
    if (action === "register") {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const passwordHash = await hashPassword(password);
      const result = await getPool().query<{ id: string; verified_at: Date | null }>(
        `INSERT INTO builder_users
           (id, email, password_hash, verification_token_hash, verification_expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 minutes')
         ON CONFLICT (email) DO UPDATE SET
           password_hash = CASE WHEN builder_users.verified_at IS NULL THEN EXCLUDED.password_hash ELSE builder_users.password_hash END,
           verification_token_hash = CASE WHEN builder_users.verified_at IS NULL THEN EXCLUDED.verification_token_hash ELSE builder_users.verification_token_hash END,
           verification_expires_at = CASE WHEN builder_users.verified_at IS NULL THEN EXCLUDED.verification_expires_at ELSE builder_users.verification_expires_at END
         RETURNING id, verified_at`,
        [randomUUID(), email, passwordHash, tokenHash],
      );
      if (!result.rows[0]?.verified_at) {
        await sendVerificationEmail(email, token);
      }
      return authResponse({
        message: "If this address can be registered, a verification link has been sent. Check your inbox.",
      }, 202);
    }

    const result = await getPool().query<{ id: string; password_hash: string | null; verified_at: Date | null }>(
      "SELECT id, password_hash, verified_at FROM builder_users WHERE email = $1",
      [email],
    );
    const user = result.rows[0];
    if (user && !user.password_hash) {
      await verifyPassword(password, "scrypt$00000000000000000000000000000000$" + "0".repeat(128));
      return authResponse(
        { error: "The email or password is incorrect. If you created this account with Google, continue with Google." },
        401,
      );
    }
    const validPassword = user?.password_hash
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, "scrypt$00000000000000000000000000000000$" + "0".repeat(128));
    if (!user || !validPassword) return authResponse({ error: "The email or password is incorrect." }, 401);
    if (!user.verified_at) {
      return authResponse({ error: "Verify your email using the link sent to your inbox before signing in." }, 403);
    }
    const access = await getBuilderAccess(user.id);
    if (!access) return authResponse({ error: "Sign in to continue." }, 401);
    return authResponse(
      {
        authenticated: true,
        ...access,
      },
      200,
      { "Set-Cookie": createSessionCookie(user.id) },
    );
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return authResponse({ error: "Account storage is not configured." }, 503);
    }
    const databaseMessage = databaseFailureMessage(error);
    if (databaseMessage) {
      console.error("Account request could not reach PostgreSQL.", {
        action,
        errorCode: databaseErrorCode(error),
      });
      return authResponse({ error: databaseMessage }, 503);
    }
    if (error instanceof MailConfigurationError) {
      return authResponse({ error: "Email verification is not configured. Contact the administrator." }, 503);
    }
    if (error instanceof MailDeliveryError) {
      console.error("Account verification email could not be delivered.");
      return authResponse(
        { error: "We could not send the verification email. Your account details are saved; please try again shortly." },
        502,
      );
    }
    console.error("Account request failed.", {
      action,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return authResponse({ error: "Account service is temporarily unavailable." }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return authResponse({ error: "Request origin is not allowed." }, 403);
  return authResponse({ authenticated: false }, 200, { "Set-Cookie": clearSessionCookie() });
}
