import { Pool, type PoolClient } from "pg";
import type { PlanId } from "@/lib/payments/plans";

let pool: Pool | undefined;
let schemaInitialization: Promise<void> | undefined;

export class DatabaseConfigurationError extends Error {
  constructor() {
    super("PostgreSQL is not configured.");
    this.name = "DatabaseConfigurationError";
  }
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new DatabaseConfigurationError();
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export async function ensureBillingSchema(): Promise<void> {
  if (!schemaInitialization) {
    schemaInitialization = (async () => {
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS builder_users (
          id UUID PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          verified_at TIMESTAMPTZ,
          verification_token_hash TEXT,
          verification_expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS builder_orders (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES builder_users(id),
          checkout_key UUID NOT NULL,
          provider TEXT NOT NULL,
          plan_id TEXT NOT NULL CHECK (plan_id IN ('pro_monthly', 'pro_annual')),
          tran_id VARCHAR(20) NOT NULL UNIQUE,
          amount NUMERIC(10, 2) NOT NULL,
          currency CHAR(3) NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'declined', 'cancelled', 'refunded')),
          qr_image TEXT,
          qr_string TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          paid_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS builder_orders_user_created_idx
          ON builder_orders (user_id, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS builder_orders_checkout_key_idx
          ON builder_orders (user_id, checkout_key);
        CREATE TABLE IF NOT EXISTS builder_subscriptions (
          user_id UUID PRIMARY KEY REFERENCES builder_users(id),
          plan_id TEXT NOT NULL CHECK (plan_id IN ('pro_monthly', 'pro_annual')),
          status TEXT NOT NULL CHECK (status IN ('active', 'expired')),
          current_period_start TIMESTAMPTZ NOT NULL,
          current_period_end TIMESTAMPTZ NOT NULL,
          last_order_id UUID NOT NULL REFERENCES builder_orders(id),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    })().catch((error: unknown) => {
      schemaInitialization = undefined;
      throw error;
    });
  }
  await schemaInitialization;
}

export async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getActiveSubscription(userId: string) {
  const result = await getPool().query<{
    plan_id: PlanId;
    current_period_end: Date;
  }>(
    `SELECT plan_id, current_period_end
     FROM builder_subscriptions
     WHERE user_id = $1 AND status = 'active' AND current_period_end > NOW()`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function activateSubscription(
  client: PoolClient,
  userId: string,
  planId: PlanId,
  orderId: string,
): Promise<void> {
  const current = await client.query<{ current_period_end: Date }>(
    `SELECT current_period_end
     FROM builder_subscriptions
     WHERE user_id = $1
       AND status = 'active'
       AND current_period_end > NOW()
     FOR UPDATE`,
    [userId],
  );
  const now = new Date();
  const existingEnd = current.rows[0]?.current_period_end;
  const periodStart = existingEnd && existingEnd > now ? existingEnd : now;
  const periodEnd = new Date(periodStart);
  const originalDay = periodEnd.getUTCDate();
  periodEnd.setUTCDate(1);
  if (planId === "pro_monthly") periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  else periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, 0),
  ).getUTCDate();
  periodEnd.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));

  await client.query(
    `INSERT INTO builder_subscriptions
       (user_id, plan_id, status, current_period_start, current_period_end, last_order_id, updated_at)
     VALUES ($1, $2, 'active', $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       status = 'active',
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       last_order_id = EXCLUDED.last_order_id,
       updated_at = NOW()`,
    [userId, planId, periodStart, periodEnd, orderId],
  );
}
