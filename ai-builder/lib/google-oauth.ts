import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { getAuthConfig } from "@/lib/auth";

export const GOOGLE_STATE_COOKIE = "phollet_builder_google_state";
const GOOGLE_STATE_TTL_SECONDS = 10 * 60;

export type GoogleOAuthState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
};

export function getBuilderPublicUrl(): URL | null {
  const value = process.env.BUILDER_PUBLIC_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function googleOAuthConfigurationErrors() {
  const errors: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID) errors.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) errors.push("GOOGLE_CLIENT_SECRET");
  if (!getAuthConfig()) errors.push("BUILDER_SESSION_SECRET (at least 32 characters)");
  if (!process.env.BUILDER_PUBLIC_URL) {
    errors.push("BUILDER_PUBLIC_URL");
  } else if (!getBuilderPublicUrl()) {
    errors.push("BUILDER_PUBLIC_URL (must be an HTTPS origin in production)");
  }
  return errors;
}

export function createGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const publicUrl = getBuilderPublicUrl();
  const auth = getAuthConfig();
  if (
    googleOAuthConfigurationErrors().length > 0 ||
    !clientId ||
    !clientSecret ||
    !publicUrl ||
    !auth
  ) {
    return null;
  }

  const redirectUri = new URL("/api/auth/google/callback", publicUrl).toString();
  return {
    clientId,
    client: new OAuth2Client(clientId, clientSecret, redirectUri),
    redirectUri,
    secret: auth.secret,
    publicUrl,
  };
}

function encryptionKey(secret: string) {
  return createHash("sha256")
    .update("phollet-builder-google-state:")
    .update(secret)
    .digest();
}

export function createGoogleStateCookie(state: GoogleOAuthState, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(state), "utf8"),
    cipher.final(),
  ]);
  const value = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${GOOGLE_STATE_COOKIE}=${value}; Path=/api/auth/google; Max-Age=${GOOGLE_STATE_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

function cookieValue(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${GOOGLE_STATE_COOKIE}=`));
  return cookie ? cookie.slice(GOOGLE_STATE_COOKIE.length + 1) : null;
}

export function readGoogleStateCookie(
  request: Request,
  secret: string,
): GoogleOAuthState | null {
  const value = cookieValue(request);
  if (!value) return null;
  try {
    const packed = Buffer.from(value, "base64url");
    if (packed.length < 29) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      packed.subarray(0, 12),
    );
    decipher.setAuthTag(packed.subarray(12, 28));
    const plaintext = Buffer.concat([
      decipher.update(packed.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
    const candidate = JSON.parse(plaintext) as Partial<GoogleOAuthState>;
    if (
      typeof candidate.state !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(candidate.state) ||
      typeof candidate.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(candidate.nonce) ||
      typeof candidate.codeVerifier !== "string" ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(candidate.codeVerifier) ||
      typeof candidate.expiresAt !== "number" ||
      !Number.isSafeInteger(candidate.expiresAt) ||
      candidate.expiresAt <= Math.floor(Date.now() / 1000) ||
      candidate.expiresAt >
        Math.floor(Date.now() / 1000) + GOOGLE_STATE_TTL_SECONDS + 30
    ) {
      return null;
    }
    return candidate as GoogleOAuthState;
  } catch {
    return null;
  }
}

export function clearGoogleStateCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${GOOGLE_STATE_COOKIE}=; Path=/api/auth/google; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}
