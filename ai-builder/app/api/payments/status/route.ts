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
import { settlePaymentOrder } from "@/lib/payments/settle-order";

export const runtime = "nodejs";
export const maxDuration = 20;

const StatusSchema = z.object({ orderId: z.string().uuid() });

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
  if (!userId || !config) return response({ error: "Sign in to check this payment." }, 401);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return response({ error: "Content-Type must be application/json." }, 415);
  }
  const rate = checkRateLimit(rateLimitKey(config.secret, "payment-status", userId), 8, 60_000);
  if (!rate.allowed) {
    return response({ error: "Please wait before checking payment status again." }, 429);
  }

  let payload: unknown;
  try {
    payload = await readJsonBody(request, 1024);
  } catch (error) {
    return response(
      { error: "Provide a valid order identifier." },
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }
  const parsed = StatusSchema.safeParse(payload);
  if (!parsed.success) return response({ error: "This payment order is invalid." }, 400);

  try {
    await ensureBillingSchema();
    const result = await getPool().query<{
      id: string;
      user_id: string;
      provider: string;
      plan_id: "pro_monthly" | "pro_annual";
      tran_id: string;
      amount: string;
      status: "pending" | "paid" | "declined" | "cancelled" | "refunded";
      expires_at: Date;
    }>(
      `SELECT id, user_id, provider, plan_id, tran_id, amount, status, expires_at
       FROM builder_orders
       WHERE id = $1 AND user_id = $2`,
      [parsed.data.orderId, userId],
    );
    const order = result.rows[0];
    if (!order) return response({ error: "Payment order not found." }, 404);
    const paymentResult = await settlePaymentOrder({
      id: order.id,
      tranId: order.tran_id,
      amount: order.amount,
      planId: order.plan_id,
      userId: order.user_id,
      provider: order.provider,
      status: order.status,
      expiresAt: order.expires_at,
    });
    return response(paymentResult);
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return response({ error: "PostgreSQL is required for payment verification." }, 503);
    }
    console.error("Payment status verification failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response({ error: "Could not verify payment status. Retry in a moment." }, 502);
  }
}
