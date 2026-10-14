import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  getAuthConfig,
  getSessionUserId,
  isSameOrigin,
  rateLimitKey,
} from "@/lib/auth";
import { DatabaseConfigurationError, ensureBillingSchema, getPool } from "@/lib/database";
import { checkRateLimit } from "@/lib/rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/request-body";
import { isPlanId, PLANS } from "@/lib/payments/plans";
import { getPaymentProvider, type PaymentOrder } from "@/lib/payments/provider";

export const runtime = "nodejs";
export const maxDuration = 30;

const CheckoutSchema = z.object({
  planId: z.string().refine(isPlanId),
  checkoutKey: z.string().uuid(),
});

function response(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function isProviderConfigured() {
  const environment = process.env.PAYWAY_ENVIRONMENT;
  const publicUrlValue = process.env.BUILDER_PUBLIC_URL;
  const callbackSecret = process.env.PAYWAY_CALLBACK_SECRET;
  if (
    (process.env.PAYMENT_PROVIDER !== undefined && process.env.PAYMENT_PROVIDER !== "aba_payway") ||
    (environment !== undefined && environment !== "sandbox" && environment !== "production") ||
    !process.env.PAYWAY_MERCHANT_ID ||
    !process.env.PAYWAY_API_KEY ||
    !publicUrlValue ||
    !callbackSecret ||
    callbackSecret.length < 32
  ) {
    return false;
  }
  try {
    const publicUrl = new URL(publicUrlValue);
    return publicUrl.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return response({ error: "Request origin is not allowed." }, 403);
  const config = getAuthConfig();
  const userId = getSessionUserId(request);
  if (!userId || !config) return response({ error: "Sign in to start checkout." }, 401);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return response({ error: "Content-Type must be application/json." }, 415);
  }
  if (!isProviderConfigured()) {
    return response({ error: "ABA PayWay checkout is not configured. Please try again later." }, 503);
  }
  const rate = checkRateLimit(
    rateLimitKey(config.secret, "checkout", userId),
    5,
    10 * 60_000,
  );
  if (!rate.allowed) {
    return response({ error: "Too many checkout attempts. Please wait and try again." }, 429);
  }

  let payload: unknown;
  try {
    payload = await readJsonBody(request, 2048);
  } catch (error) {
    return response(
      { error: "Provide a valid checkout request." },
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }
  const parsed = CheckoutSchema.safeParse(payload);
  if (!parsed.success) return response({ error: "Select a valid Pro plan." }, 400);

  try {
    await ensureBillingSchema();
    const { planId, checkoutKey } = parsed.data;
    const plan = PLANS[planId];
    const orderId = randomUUID();
    const tranId = `${Date.now()}${String(randomInt(0, 10_000_000)).padStart(7, "0")}`.slice(0, 20);
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const inserted = await getPool().query<{
      id: string;
      tran_id: string;
      amount: string;
      plan_id: "pro_monthly" | "pro_annual";
      user_id: string;
      qr_image: string | null;
      qr_string: string | null;
      expires_at: Date;
    }>(
      `INSERT INTO builder_orders
         (id, user_id, checkout_key, provider, plan_id, tran_id, amount, currency, status, expires_at)
       VALUES ($1, $2, $3, 'aba_payway', $4, $5, $6, 'USD', 'pending', $7)
       ON CONFLICT (user_id, checkout_key) DO NOTHING
       RETURNING id, tran_id, amount, plan_id, user_id, qr_image, qr_string, expires_at`,
      [orderId, userId, checkoutKey, planId, tranId, plan.amount, expiresAt],
    );
    let order = inserted.rows[0];
    if (!order) {
      const existing = await getPool().query<typeof inserted.rows[number]>(
        `SELECT id, tran_id, amount, plan_id, user_id, qr_image, qr_string, expires_at
         FROM builder_orders
         WHERE user_id = $1 AND checkout_key = $2 AND provider = 'aba_payway' AND status = 'pending'`,
        [userId, checkoutKey],
      );
      order = existing.rows[0];
      if (!order) return response({ error: "This checkout attempt is no longer available. Start a new checkout." }, 409);
      if (order.plan_id !== planId) {
        return response({ error: "This checkout key is already assigned to another plan." }, 409);
      }
      if (order.qr_image && order.qr_string && order.expires_at > new Date()) {
        return response({
          orderId: order.id,
          planId: order.plan_id,
          amount: order.amount,
          currency: "USD",
          provider: "aba_payway",
          qrImage: order.qr_image,
          qrString: order.qr_string,
          expiresAt: order.expires_at.toISOString(),
        });
      }
      if (!order.qr_image) {
        return response({ error: "Checkout is being prepared. Please wait and retry." }, 409);
      }
      return response({ error: "This QR code has expired. Start a new checkout." }, 409);
    }

    const provider = getPaymentProvider("aba_payway");
    const checkout = await provider.createCheckout({
      id: order.id,
      tranId: order.tran_id,
      amount: order.amount,
      planId: order.plan_id,
      userId: order.user_id,
    } satisfies PaymentOrder);
    await getPool().query(
      "UPDATE builder_orders SET qr_image = $1, qr_string = $2, expires_at = $3 WHERE id = $4 AND status = 'pending'",
      [checkout.qrImage, checkout.qrString, checkout.expiresAt, order.id],
    );
    return response({
      orderId: order.id,
      planId: order.plan_id,
      amount: order.amount,
      currency: "USD",
      provider: checkout.provider,
      qrImage: checkout.qrImage,
      qrString: checkout.qrString,
      expiresAt: checkout.expiresAt,
    });
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return response({ error: "PostgreSQL is required for payment checkout." }, 503);
    }
    console.error("ABA checkout creation failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response({ error: "Could not start ABA KHQR checkout. Please try again." }, 502);
  }
}
