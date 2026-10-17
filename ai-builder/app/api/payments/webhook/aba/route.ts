import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { rateLimitKey } from "@/lib/auth";
import { DatabaseConfigurationError, ensureBillingSchema, getPool } from "@/lib/database";
import { checkRateLimit } from "@/lib/rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/request-body";
import { settlePaymentOrder } from "@/lib/payments/settle-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const CallbackSchema = z.object({
  tran_id: z.string().min(1).max(20).regex(/^[0-9]+$/),
  status: z.union([z.string().max(10), z.number()]).transform(String),
});

function response(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function validCallbackToken(supplied: string | null, expected: string | undefined) {
  if (!supplied || !expected || expected.length < 32) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

export async function POST(request: Request) {
  const callbackSecret = process.env.PAYWAY_CALLBACK_SECRET;
  if (
    !callbackSecret ||
    !validCallbackToken(new URL(request.url).searchParams.get("token"), callbackSecret)
  ) {
    return response({ error: "Not found." }, 404);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return response({ error: "Content-Type must be application/json." }, 415);
  }

  let payload: unknown;
  try {
    payload = await readJsonBody(request, 4096);
  } catch (error) {
    return response(
      { error: "Provide a valid PayWay notification." },
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }
  const parsed = CallbackSchema.safeParse(payload);
  if (!parsed.success) return response({ error: "Invalid PayWay notification." }, 400);
  if (parsed.data.status !== "0") return response({ received: true });

  try {
    await ensureBillingSchema();
    const rate = checkRateLimit(
      rateLimitKey(callbackSecret, "aba-callback", parsed.data.tran_id),
      5,
      60_000,
    );
    if (!rate.allowed) return response({ error: "Notification rate limit exceeded." }, 429);

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
       WHERE tran_id = $1 AND provider = 'aba_payway'`,
      [parsed.data.tran_id],
    );
    const order = result.rows[0];
    if (!order) return response({ received: true });
    await settlePaymentOrder({
      id: order.id,
      userId: order.user_id,
      provider: order.provider,
      planId: order.plan_id,
      tranId: order.tran_id,
      amount: order.amount,
      status: order.status,
      expiresAt: order.expires_at,
    });
    return response({ received: true });
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return response({ error: "Payment storage is unavailable." }, 503);
    }
    console.error("ABA payment callback processing failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response({ error: "Could not verify this payment notification." }, 502);
  }
}
