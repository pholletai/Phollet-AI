import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  createSessionCookie,
} from "@/lib/auth";
import {
  DatabaseConfigurationError,
  databaseErrorCode,
  databaseFailureMessage,
  ensureBillingSchema,
  getPool,
} from "@/lib/database";
import {
  clearGoogleStateCookie,
  createGoogleOAuthClient,
  getBuilderPublicUrl,
  googleOAuthConfigurationErrors,
  readGoogleStateCookie,
} from "@/lib/google-oauth";

export const runtime = "nodejs";

function redirectToBuilder(request: Request, error?: string, sessionCookie?: string) {
  const builderUrl = getBuilderPublicUrl() ?? new URL(request.url);
  const url = new URL("/", builderUrl);
  if (error) url.searchParams.set("auth_error", error);
  const response = NextResponse.redirect(url, { status: 303 });
  response.headers.append("Set-Cookie", clearGoogleStateCookie());
  if (sessionCookie) response.headers.append("Set-Cookie", sessionCookie);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function googleProviderErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  const responseData =
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null
      ? error.response.data
      : null;
  const candidate =
    responseData && "error" in responseData && typeof responseData.error === "string"
      ? responseData.error
      : "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
  return candidate && /^[A-Za-z0-9_.-]{1,80}$/.test(candidate)
    ? candidate
    : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("error")) {
    return redirectToBuilder(request, "google_cancelled");
  }

  const code = url.searchParams.get("code");
  const suppliedState = url.searchParams.get("state");
  const configuration = createGoogleOAuthClient();
  if (!configuration) {
    console.error("Google sign-in configuration is incomplete.", {
      missingConfiguration: googleOAuthConfigurationErrors(),
    });
    return redirectToBuilder(request, "google_not_configured");
  }
  if (url.origin !== configuration.publicUrl.origin) {
    console.error("Google OAuth callback arrived on a different domain than configured.", {
      configuredOrigin: configuration.publicUrl.origin,
      requestOrigin: url.origin,
    });
    return redirectToBuilder(request, "google_domain_mismatch", clearSessionCookie());
  }
  if (!code || code.length > 4096 || !suppliedState) {
    return redirectToBuilder(request, "google_invalid");
  }

  const state = readGoogleStateCookie(request, configuration.secret);
  if (!state || !constantTimeEqual(suppliedState, state.state)) {
    return redirectToBuilder(request, "google_invalid");
  }

  try {
    const { tokens } = await configuration.client.getToken({
      code,
      codeVerifier: state.codeVerifier,
      redirect_uri: configuration.redirectUri,
    });
    if (!tokens.id_token) return redirectToBuilder(request, "google_failed");

    const ticket = await configuration.client.verifyIdToken({
      idToken: tokens.id_token,
      audience: configuration.clientId,
    });
    const identity = ticket.getPayload();
    if (
      !identity?.sub ||
      !identity.email ||
      identity.email_verified !== true ||
      !identity.nonce ||
      !constantTimeEqual(identity.nonce, state.nonce)
    ) {
      return redirectToBuilder(request, "google_unverified");
    }

    await ensureBillingSchema();
    const result = await getPool().query<{ id: string }>(
      `INSERT INTO builder_users
         (id, email, password_hash, google_sub, verified_at)
       VALUES ($1, $2, NULL, $3, NOW())
       ON CONFLICT (email) DO UPDATE SET
         google_sub = COALESCE(builder_users.google_sub, EXCLUDED.google_sub),
         verified_at = COALESCE(builder_users.verified_at, NOW()),
         verification_token_hash = NULL,
         verification_expires_at = NULL
       WHERE builder_users.google_sub IS NULL
          OR builder_users.google_sub = EXCLUDED.google_sub
       RETURNING id`,
      [randomUUID(), identity.email.toLowerCase(), identity.sub],
    );
    const userId = result.rows[0]?.id;
    if (!userId) return redirectToBuilder(request, "google_account_conflict");
    return redirectToBuilder(request, undefined, createSessionCookie(userId));
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return redirectToBuilder(request, "database_not_configured");
    }
    const databaseMessage = databaseFailureMessage(error);
    if (databaseMessage) {
      console.error("Google sign-in could not reach PostgreSQL.", {
        errorCode: databaseErrorCode(error),
      });
      return redirectToBuilder(request, "database_unavailable", clearSessionCookie());
    }
    if (databaseErrorCode(error) === "23505") {
      return redirectToBuilder(request, "google_account_conflict");
    }
    const providerErrorCode = googleProviderErrorCode(error);
    if (["invalid_client", "unauthorized_client", "redirect_uri_mismatch"].includes(providerErrorCode ?? "")) {
      console.error("Google rejected the OAuth client or callback configuration.", {
        providerErrorCode,
      });
      return redirectToBuilder(request, "google_configuration_error", clearSessionCookie());
    }
    if (providerErrorCode === "invalid_grant") {
      console.error("Google rejected an expired or reused OAuth authorization code.");
      return redirectToBuilder(request, "google_invalid", clearSessionCookie());
    }
    console.error("Google sign-in could not be completed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode: databaseErrorCode(error),
      providerErrorCode,
    });
    return redirectToBuilder(request, "service_unavailable", clearSessionCookie());
  }
}
