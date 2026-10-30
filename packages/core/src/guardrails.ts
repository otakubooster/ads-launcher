import { adAccounts, appSettings } from "@fahd/db/schema";
import type { UserRole } from "@fahd/db/schema";
import { eq, sql } from "drizzle-orm";
import { activeDailyBudget } from "./objects";
import { currencyDigits } from "./sync";
import type { AnyDb } from "./types";

/** Buyers move a budget at most this much in one step unless their member row says otherwise (users.max_budget_change_pct). */
export const DEFAULT_MAX_CHANGE_PCT = 30;

export type GuardReason = "max_daily_budget" | "max_change" | "approval_threshold";
export type GuardDecision =
  | { decision: "allow"; total: number; newTotal: number }
  | { decision: "block" | "approval"; reason: GuardReason; title: string; detail: string; fix?: string; total: number; newTotal: number };

export type GuardInput = {
  role: UserRole;
  accountName: string;
  currency: string;
  /** Today's active daily budget for the account, minor units. */
  total: number;
  max: number | null;
  approvalThreshold: number | null;
  /** How much the active daily budget goes up (0 for pauses and cuts). */
  increase: number;
  /** For budget edits: the change in percent (+25, −40). */
  changePct?: number | null;
  maxChangePct?: number;
};

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 10 ** currencyDigits(currency));
}

/**
 * The three spend rules, in order: the account maximum blocks everyone, a buyer's
 * step above the max change is blocked, and a buyer's increase above the
 * approval threshold becomes an approval request. Pure; callers load the numbers.
 */
export function evaluateGuardrails(input: GuardInput): GuardDecision {
  const { total, increase, currency } = input;
  const newTotal = total + Math.max(0, increase);
  const limit = input.maxChangePct ?? DEFAULT_MAX_CHANGE_PCT;
  if (increase > 0 && input.max !== null && newTotal > input.max) {
    return {
      decision: "block",
      reason: "max_daily_budget",
      title: "Above the account's daily budget limit",
      detail: `This would take ${input.accountName} to ${money(newTotal, currency)}/day. The limit is ${money(input.max, currency)}/day.`,
      fix: "Pause something else first, or ask an owner or admin to raise the limit in Settings.",
      total,
      newTotal,
    };
  }
  if (input.role === "buyer" && input.changePct != null && Math.abs(input.changePct) > limit + 1e-9) {
    return {
      decision: "block",
      reason: "max_change",
      title: "Change too large",
      detail: `Buyers can move a budget at most ${limit}% in one step. This change is ${Math.round(Math.abs(input.changePct))}%.`,
      fix: "Make the change in smaller steps, or ask an owner or admin.",
      total,
      newTotal,
    };
  }
  if (input.role === "buyer" && increase > 0 && input.approvalThreshold !== null && increase > input.approvalThreshold) {
    return {
      decision: "approval",
      reason: "approval_threshold",
      title: "Sent for approval",
      detail: `Adding ${money(increase, currency)}/day to ${input.accountName} is above its ${money(input.approvalThreshold, currency)} approval threshold. An owner or admin will review it.`,
      total,
      newTotal,
    };
  }
  return { decision: "allow", total, newTotal };
}

/** Loads the account's numbers and evaluates a spend change. `db` must be privileged. */
export async function checkSpend(db: AnyDb, input: { adAccountId: string; role: UserRole; increase: number; changePct?: number | null; maxChangePct?: number }) {
  const budget = await activeDailyBudget(db, input.adAccountId);
  const [account] = await db.select({ name: adAccounts.name }).from(adAccounts).where(eq(adAccounts.id, input.adAccountId));
  return evaluateGuardrails({
    role: input.role,
    accountName: account?.name ?? "this account",
    currency: budget.currency,
    total: budget.total,
    max: budget.max,
    approvalThreshold: budget.approvalThreshold,
    increase: input.increase,
    changePct: input.changePct,
    maxChangePct: input.maxChangePct,
  });
}

export const KILL_SWITCH = "kill_switch";
export type KillSwitch = { on: boolean; by?: string | null; at?: string | null };

/** The kill switch lives in app_settings so the web app (inline runs) and the worker share it. */
export async function killSwitchState(db: AnyDb): Promise<KillSwitch> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KILL_SWITCH));
  if (!row) return { on: false };
  const value = row.value as { on?: boolean };
  return { on: Boolean(value.on), by: row.updatedBy, at: row.updatedAt.toISOString() };
}

export async function setKillSwitch(db: AnyDb, on: boolean, userId: string) {
  await db
    .insert(appSettings)
    .values({ key: KILL_SWITCH, value: { on }, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded.value`, updatedBy: userId } });
}
