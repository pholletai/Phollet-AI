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
  ensureBillingSchema,
  getActiveSubscription,
  getPool,
} from "@/lib/database";
import { MailConfigurationError, sendVerificationEmail } from "@/lib/mail";
import { hashPassword, verifyPassword } from "@/lib/password";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/request-body";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

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

async function rateLimit(request: Request, kind: string, limit: number, duration: number) {
  const config = getAuthConfig();
  if (!config) return false;
  const result = checkRateLimit(
    rateLimitKey(config.secret, kind, opaqueRequestIdentity(request)),
    limit,
    duration,
  );
  if (!result.allowed) return false;
  return true;
}

export async function GET(request: Request) {
  try {
    await ensureBillingSchema();
    const verifyToken = new URL(request.url).searchParams.get("verify");
    if (verifyToken) {
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
    const result = await getPool().query<{
      email: string;
      plan_id: string | null;
      current_period_end: Date | null;
    }>(
      `SELECT u.email, s.plan_id, s.current_period_end
       FROM builder_users u
       LEFT JOIN builder_subscriptions s
         ON s.user_id = u.id AND s.status = 'active' AND s.current_period_end > NOW()
       WHERE u.id = $1 AND u.verified_at IS NOT NULL`,
      [userId],
    );
    const user = result.rows[0];
    if (!user) return authResponse({ authenticated: false });
    return authResponse({
      authenticated: true,
      email: user.email,
      subscription: user.plan_id
        ? { planId: user.plan_id, currentPeriodEnd: user.current_period_end?.toISOString() }
        : null,
    });
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return authResponse({ error: "Account storage is not configured." }, 503);
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
  if (!(await rateLimit(request, action === "register" ? "register" : "login", action === "register" ? 3 : 10, 15 * 60_000))) {
    return authResponse({ error: "Too many account attempts. Try again later." }, 429);
  }

  try {
    await ensureBillingSchema();
    const email = parsed.data.email.toLowerCase();
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

    const result = await getPool().query<{ id: string; password_hash: string; verified_at: Date | null }>(
      "SELECT id, password_hash, verified_at FROM builder_users WHERE email = $1",
      [email],
    );
    const user = result.rows[0];
    const validPassword = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, "scrypt$00000000000000000000000000000000$" + "0".repeat(128));
    if (!user || !validPassword) return authResponse({ error: "The email or password is incorrect." }, 401);
    if (!user.verified_at) {
      return authResponse({ error: "Verify your email using the link sent to your inbox before signing in." }, 403);
    }
    const subscription = await getActiveSubscription(user.id);
    return authResponse(
      {
        authenticated: true,
        email,
        subscription: subscription
          ? { planId: subscription.plan_id, currentPeriodEnd: subscription.current_period_end.toISOString() }
          : null,
      },
      200,
      { "Set-Cookie": createSessionCookie(user.id) },
    );
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return authResponse({ error: "Account storage is not configured." }, 503);
    }
    if (error instanceof MailConfigurationError) {
      return authResponse({ error: "Email verification is not configured. Contact the administrator." }, 503);
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
