import {
  activateSubscription,
  getPool,
  withTransaction,
} from "@/lib/database";
import { getPaymentProvider, type PaymentOrder, type VerifiedPayment } from "@/lib/payments/provider";

export type StoredPaymentOrder = PaymentOrder & {
  provider: string;
  status: "pending" | "paid" | "declined" | "cancelled" | "refunded";
  expiresAt: Date;
};

async function getSubscriptionEnd(userId: string) {
  const result = await getPool().query<{ current_period_end: Date }>(
    `SELECT current_period_end
     FROM builder_subscriptions
     WHERE user_id = $1 AND status = 'active' AND current_period_end > NOW()`,
    [userId],
  );
  return result.rows[0]?.current_period_end.toISOString() ?? null;
}

async function getOrderStatus(orderId: string, fallback: VerifiedPayment["state"] | "expired") {
  const result = await getPool().query<{ status: StoredPaymentOrder["status"] }>(
    "SELECT status FROM builder_orders WHERE id = $1",
    [orderId],
  );
  return result.rows[0]?.status ?? fallback;
}

export async function settlePaymentOrder(order: StoredPaymentOrder) {
  if (order.status !== "pending") {
    return { status: order.status, subscriptionEndsAt: await getSubscriptionEnd(order.userId) };
  }

  const provider = getPaymentProvider(order.provider);
  const verified = await provider.verifyPayment(order);
  if (verified.state === "pending") {
    if (order.expiresAt > new Date()) return { status: "pending" as const };
    await getPool().query(
      "UPDATE builder_orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending'",
      [order.id],
    );
    const status = await getOrderStatus(order.id, "expired");
    return {
      status: status === "cancelled" ? "expired" : status,
      subscriptionEndsAt: await getSubscriptionEnd(order.userId),
    };
  }

  await withTransaction(async (client) => {
    const locked = await client.query<{ status: string }>(
      "SELECT status FROM builder_orders WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [order.id, order.userId],
    );
    if (locked.rows[0]?.status !== "pending") return;
    const nextStatus = verified.state === "paid" ? "paid" : verified.state;
    await client.query(
      "UPDATE builder_orders SET status = $1, paid_at = CASE WHEN $1 = 'paid' THEN NOW() ELSE NULL END WHERE id = $2",
      [nextStatus, order.id],
    );
    if (verified.state === "paid") {
      await activateSubscription(client, order.userId, order.planId, order.id);
    } else if (verified.state === "refunded") {
      await client.query(
        `UPDATE builder_subscriptions
         SET status = 'expired', current_period_end = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND last_order_id = $2`,
        [order.userId, order.id],
      );
    }
  });

  const status = await getOrderStatus(order.id, verified.state);
  return { status, subscriptionEndsAt: await getSubscriptionEnd(order.userId) };
}
