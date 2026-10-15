import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "phollet_builder_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export function getAuthConfig() {
  const secret = process.env.BUILDER_SESSION_SECRET;
  return secret && secret.length >= 32 ? { secret } : null;
}

function cookieValue(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? cookie.slice(SESSION_COOKIE.length + 1) : null;
}

export function getSessionUserId(request: Request): string | null {
  const config = getAuthConfig();
  const token = cookieValue(request);
  if (!config || !token) return null;

  const [userId, expiryText, signature, ...extra] = token.split(".");
  const expiresAt = Number(expiryText);
  if (
    extra.length > 0 ||
    !userId ||
    !/^[0-9a-f-]{36}$/i.test(userId) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000) ||
    expiresAt > Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS + 60 ||
    !signature ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    return null;
  }

  const expected = createHmac("sha256", config.secret).update(`${userId}.${expiryText}`).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? userId : null;
}

export function hasValidSession(request: Request): boolean {
  return getSessionUserId(request) !== null;
}

export function createSessionCookie(userId: string): string {
  const config = getAuthConfig();
  if (!config) {
    throw new Error("Builder session signing is not configured.");
  }
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `${userId}.${expiresAt}`;
  const signature = createHmac("sha256", config.secret).update(payload).digest("hex");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function opaqueRequestIdentity(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return (
    request.headers.get("x-real-ip")?.trim() ||
    forwardedFor?.split(",").at(-1)?.trim() ||
    "unknown"
  );
}

export function sessionIdentity(request: Request): string {
  return cookieValue(request) ?? "missing-session";
}

export function rateLimitKey(secret: string, namespace: string, identity: string): string {
  return createHmac("sha256", secret).update(`${namespace}:${identity}`).digest("hex");
}
