import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { FREE_TRIAL_PROJECT_LIMIT, type PlanId } from "@/lib/payments/plans";

export type BuilderProject = {
  id: string;
  is_trial: boolean;
  files: Array<{ path: string; content: string }>;
  dependencies: Record<string, string>;
};

export type BuilderProjectSummary = {
  id: string;
  isTrial: boolean;
  updatedAt: string;
};

let pool: Pool | undefined;
let schemaInitialization: Promise<void> | undefined;

export class DatabaseConfigurationError extends Error {
  constructor() {
    super("PostgreSQL is not configured.");
    this.name = "DatabaseConfigurationError";
  }
}

export class FreeTrialLimitError extends Error {
  constructor() {
    super("The free project limit has been reached.");
    this.name = "FreeTrialLimitError";
  }
}

export class BuilderProjectNotFoundError extends Error {
  constructor() {
    super("The Builder project was not found.");
    this.name = "BuilderProjectNotFoundError";
  }
}

export class ProAccessRequiredError extends Error {
  constructor() {
    super("An active Pro plan is required for this project.");
    this.name = "ProAccessRequiredError";
  }
}

export function databaseErrorCode(error: unknown): string | undefined {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined
  );
}

export function databaseFailureMessage(error: unknown): string | null {
  const code = databaseErrorCode(error) ?? "";
  if (
    code.startsWith("08") ||
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOTFOUND",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "CERT_HAS_EXPIRED",
      "57P01",
      "57P03",
      "53300",
    ].includes(code)
  ) {
    return "The account database is temporarily unreachable. Please try again shortly.";
  }
  if (["28P01", "3D000", "3F000", "42501", "42P01"].includes(code)) {
    return "The account database configuration needs attention. Please contact the administrator.";
  }
  return null;
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new DatabaseConfigurationError();
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
    });
    pool.on("error", (error: Error & { code?: string }) => {
      console.error("An idle PostgreSQL connection failed.", {
        errorName: error.name,
        errorCode: error.code,
      });
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
          password_hash TEXT,
          google_sub TEXT,
          trial_project_count INTEGER NOT NULL DEFAULT 0 CHECK (trial_project_count >= 0),
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
        CREATE TABLE IF NOT EXISTS builder_projects (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES builder_users(id) ON DELETE CASCADE,
          is_trial BOOLEAN NOT NULL,
          files JSONB NOT NULL,
          dependencies JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS builder_projects_user_updated_idx
          ON builder_projects (user_id, updated_at DESC);
      `);
      await getPool().query(
        "ALTER TABLE builder_users ALTER COLUMN password_hash DROP NOT NULL",
      );
      await getPool().query(
        "ALTER TABLE builder_users ADD COLUMN IF NOT EXISTS google_sub TEXT",
      );
      await getPool().query(
        "ALTER TABLE builder_users ADD COLUMN IF NOT EXISTS trial_project_count INTEGER NOT NULL DEFAULT 0 CHECK (trial_project_count >= 0)",
      );
      await getPool().query(
        `CREATE UNIQUE INDEX IF NOT EXISTS builder_users_google_sub_idx
         ON builder_users (google_sub)
         WHERE google_sub IS NOT NULL`,
      );
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
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("A PostgreSQL transaction rollback failed.", {
        errorName: rollbackError instanceof Error ? rollbackError.name : "UnknownError",
        errorCode: databaseErrorCode(rollbackError),
      });
    }
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

export async function getBuilderAccess(userId: string) {
  const result = await getPool().query<{
    email: string;
    plan_id: PlanId | null;
    current_period_end: Date | null;
    trial_project_count: number;
    recent_project_id: string | null;
  }>(
    `SELECT u.email,
            s.plan_id,
            s.current_period_end,
            u.trial_project_count,
            p.id AS recent_project_id
     FROM builder_users u
     LEFT JOIN builder_subscriptions s
       ON s.user_id = u.id AND s.status = 'active' AND s.current_period_end > NOW()
     LEFT JOIN LATERAL (
       SELECT id FROM builder_projects
       WHERE user_id = u.id
       ORDER BY updated_at DESC
       LIMIT 1
     ) p ON TRUE
     WHERE u.id = $1 AND u.verified_at IS NOT NULL`,
    [userId],
  );
  const user = result.rows[0];
  if (!user) return null;
  return {
    email: user.email,
    subscription: user.plan_id
      ? { planId: user.plan_id, currentPeriodEnd: user.current_period_end?.toISOString() ?? null }
      : null,
    trialProjectCount: user.trial_project_count,
    trialProjectLimit: FREE_TRIAL_PROJECT_LIMIT,
    recentProjectId: user.recent_project_id,
  };
}

export async function getBuilderProject(userId: string, projectId: string): Promise<BuilderProject | null> {
  const result = await getPool().query<BuilderProject>(
    `SELECT id, is_trial, files, dependencies
     FROM builder_projects
     WHERE id = $1 AND user_id = $2`,
    [projectId, userId],
  );
  return result.rows[0] ?? null;
}

export async function getBuilderProjects(userId: string): Promise<BuilderProjectSummary[]> {
  const result = await getPool().query<{ id: string; is_trial: boolean; updated_at: Date }>(
    `SELECT id, is_trial, updated_at
     FROM builder_projects
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT 50`,
    [userId],
  );
  return result.rows.map((project) => ({
    id: project.id,
    isTrial: project.is_trial,
    updatedAt: project.updated_at.toISOString(),
  }));
}

export async function saveBuilderProject(
  userId: string,
  projectId: string | undefined,
  files: BuilderProject["files"],
  dependencies: BuilderProject["dependencies"],
): Promise<BuilderProject> {
  return withTransaction(async (client) => {
    if (projectId) {
      const existing = await client.query<{ id: string; is_trial: boolean }>(
        "SELECT id, is_trial FROM builder_projects WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [projectId, userId],
      );
      if (!existing.rows[0]) throw new BuilderProjectNotFoundError();
      const activeSubscription = await client.query(
        `SELECT 1 FROM builder_subscriptions
         WHERE user_id = $1 AND status = 'active' AND current_period_end > NOW()`,
        [userId],
      );
      if (activeSubscription.rowCount === 0 && !existing.rows[0].is_trial) {
        throw new ProAccessRequiredError();
      }
      const updated = await client.query<BuilderProject>(
        `UPDATE builder_projects
         SET files = $1, dependencies = $2, updated_at = NOW()
         WHERE id = $3 AND user_id = $4
         RETURNING id, is_trial, files, dependencies`,
        [JSON.stringify(files), JSON.stringify(dependencies), projectId, userId],
      );
      return updated.rows[0];
    }

    const user = await client.query<{ id: string; trial_project_count: number }>(
      "SELECT id, trial_project_count FROM builder_users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    if (!user.rows[0]) throw new BuilderProjectNotFoundError();

    const activeSubscription = await client.query(
      `SELECT 1 FROM builder_subscriptions
       WHERE user_id = $1 AND status = 'active' AND current_period_end > NOW()`,
      [userId],
    );
    const isTrial = activeSubscription.rowCount === 0;
    if (isTrial) {
      const claimed = await client.query(
        `UPDATE builder_users
         SET trial_project_count = trial_project_count + 1
         WHERE id = $1 AND trial_project_count < $2`,
        [userId, FREE_TRIAL_PROJECT_LIMIT],
      );
      if (claimed.rowCount !== 1) throw new FreeTrialLimitError();
    }

    const created = await client.query<BuilderProject>(
      `INSERT INTO builder_projects (id, user_id, is_trial, files, dependencies)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, is_trial, files, dependencies`,
      [randomUUID(), userId, isTrial, JSON.stringify(files), JSON.stringify(dependencies)],
    );
    return created.rows[0];
  });
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
