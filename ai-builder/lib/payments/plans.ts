export const PLANS = {
  pro_monthly: { id: "pro_monthly", label: "Phollet AI Pro (monthly)", amount: "14.99", months: 1 },
  pro_annual: { id: "pro_annual", label: "Phollet AI Pro (annual)", amount: "129.99", months: 12 },
} as const;

export const FREE_TRIAL_PROJECT_LIMIT = 1;

export type PlanId = keyof typeof PLANS;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && Object.hasOwn(PLANS, value);
}
