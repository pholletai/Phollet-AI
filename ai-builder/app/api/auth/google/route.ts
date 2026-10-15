import { randomBytes } from "node:crypto";
import { CodeChallengeMethod } from "google-auth-library";
import { NextResponse } from "next/server";
import {
  createGoogleOAuthClient,
  createGoogleStateCookie,
  googleOAuthConfigurationErrors,
  type GoogleOAuthState,
} from "@/lib/google-oauth";

export const runtime = "nodejs";

function returnWithError(request: Request, error: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("auth_error", error);
  const response = NextResponse.redirect(url, { status: 303 });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function GET(request: Request) {
  const configuration = createGoogleOAuthClient();
  if (!configuration) {
    console.error("Google sign-in configuration is incomplete.", {
      missingConfiguration: googleOAuthConfigurationErrors(),
    });
    return returnWithError(request, "google_not_configured");
  }
  if (new URL(request.url).origin !== configuration.publicUrl.origin) {
    console.error("The Google OAuth public URL does not match the request domain.", {
      configuredOrigin: configuration.publicUrl.origin,
      requestOrigin: new URL(request.url).origin,
    });
    return returnWithError(request, "google_domain_mismatch");
  }

  try {
    const verifier = await configuration.client.generateCodeVerifierAsync();
    const state: GoogleOAuthState = {
      state: randomBytes(32).toString("base64url"),
      nonce: randomBytes(32).toString("base64url"),
      codeVerifier: verifier.codeVerifier,
      expiresAt: Math.floor(Date.now() / 1000) + 10 * 60,
    };
    const authorizationUrl = configuration.client.generateAuthUrl({
      access_type: "online",
      code_challenge: verifier.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      nonce: state.nonce,
      prompt: "select_account",
      redirect_uri: configuration.redirectUri,
      response_type: "code",
      scope: ["openid", "email", "profile"],
      state: state.state,
    });
    const response = NextResponse.redirect(authorizationUrl, { status: 302 });
    response.headers.append(
      "Set-Cookie",
      createGoogleStateCookie(state, configuration.secret),
    );
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  } catch (error) {
    console.error("Could not start Google sign-in.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return returnWithError(request, "google_unavailable");
  }
}
