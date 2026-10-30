import { adAccounts, metaAdsets, metaAds, metaCampaigns } from "@fahd/db/schema";
import { MetaApiError, setDailyBudget, setStatus } from "@fahd/meta";
import { and, eq, isNull, sql } from "drizzle-orm";
import { clientForAdAccount } from "./meta-client";
import type { AnyDb } from "./types";

export type ObjectLevel = "campaign" | "adset" | "ad";
const TABLES = { campaign: metaCampaigns, adset: metaAdsets, ad: metaAds } as const;

export type MetaChange = {
  level: ObjectLevel;
  id: string;
  metaId: string;
  adAccountId: string;
  name: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  metaResponse: unknown;
};

async function loadObject(db: AnyDb, level: ObjectLevel, id: string) {
  const table = TABLES[level];
  const [row] = await db
    .select({ id: table.id, metaId: table.metaId, adAccountId: table.adAccountId, name: table.name, status: table.status })
    .from(table)
    .where(eq(table.id, id));
  if (!row) throw new Error(`${level} not found`);
  return row;
}

/**
 * Pauses or activates on Meta, then updates the mirror. Callers check roles and
 * guardrails first and write change_log with the result. `db` must be privileged.
 */
export async function changeStatus(db: AnyDb, level: ObjectLevel, id: string, status: "ACTIVE" | "PAUSED"): Promise<MetaChange> {
  const obj = await loadObject(db, level, id);
  const { client, metaAccountId } = await clientForAdAccount(db, obj.adAccountId);
  const metaResponse = await setStatus(client, obj.metaId, status, metaAccountId);
  const table = TABLES[level];
  await db.update(table).set({ status, effectiveStatus: status }).where(eq(table.id, id));
  return { level, id, metaId: obj.metaId, adAccountId: obj.adAccountId, name: obj.name, before: { status: obj.status }, after: { status }, metaResponse };
}

export async function changeDailyBudget(db: AnyDb, level: "campaign" | "adset", id: string, dailyBudget: number): Promise<MetaChange> {
  const table = TABLES[level];
  const [row] = await db
    .select({ id: table.id, metaId: table.metaId, adAccountId: table.adAccountId, name: table.name, dailyBudget: table.dailyBudget })
    .from(table)
    .where(eq(table.id, id));
  if (!row) throw new Error(`${level} not found`);
  if (row.dailyBudget === null) {
    throw new MetaApiError({ kind: "guard", message: `This ${level === "adset" ? "ad set" : level} has no daily budget to change` });
  }
  const { client, metaAccountId } = await clientForAdAccount(db, row.adAccountId);
  const metaResponse = await setDailyBudget(client, row.metaId, dailyBudget, metaAccountId);
  await db.update(table).set({ dailyBudget }).where(eq(table.id, id));
  return {
    level,
    id,
    metaId: row.metaId,
    adAccountId: row.adAccountId,
    name: row.name,
    before: { daily_budget: row.dailyBudget },
    after: { daily_budget: dailyBudget },
    metaResponse,
  };
}

/**
 * The account's total active daily budget: active campaign budgets (CBO) plus
 * active ad set budgets in active campaigns without one (ABO).
 */
export async function activeDailyBudget(db: AnyDb, adAccountId: string) {
  const [cbo] = await db
    .select({ total: sql<number>`coalesce(sum(${metaCampaigns.dailyBudget}), 0)::bigint` })
    .from(metaCampaigns)
    .where(and(eq(metaCampaigns.adAccountId, adAccountId), eq(metaCampaigns.status, "ACTIVE")));
  const [abo] = await db
    .select({ total: sql<number>`coalesce(sum(${metaAdsets.dailyBudget}), 0)::bigint` })
    .from(metaAdsets)
    .innerJoin(metaCampaigns, eq(metaCampaigns.id, metaAdsets.campaignId))
    .where(
      and(
        eq(metaAdsets.adAccountId, adAccountId),
        eq(metaAdsets.status, "ACTIVE"),
        eq(metaCampaigns.status, "ACTIVE"),
        isNull(metaCampaigns.dailyBudget),
      ),
    );
  const [account] = await db
    .select({ max: adAccounts.maxDailyBudget, threshold: adAccounts.approvalThreshold, currency: adAccounts.currency })
    .from(adAccounts)
    .where(eq(adAccounts.id, adAccountId));
  return {
    total: Number(cbo?.total ?? 0) + Number(abo?.total ?? 0),
    max: account?.max ?? null,
    approvalThreshold: account?.threshold ?? null,
    currency: account?.currency ?? "USD",
  };
}

/** The daily budget that goes live if this object is activated (its own, or its parent's). */
export async function budgetReleasedBy(db: AnyDb, level: ObjectLevel, id: string) {
  if (level === "campaign") {
    const [c] = await db.select({ b: metaCampaigns.dailyBudget }).from(metaCampaigns).where(eq(metaCampaigns.id, id));
    if (c?.b) return c.b;
    const [s] = await db
      .select({ total: sql<number>`coalesce(sum(${metaAdsets.dailyBudget}), 0)::bigint` })
      .from(metaAdsets)
      .where(and(eq(metaAdsets.campaignId, id), eq(metaAdsets.status, "ACTIVE")));
    return Number(s?.total ?? 0);
  }
  if (level === "adset") {
    const [s] = await db
      .select({ b: metaAdsets.dailyBudget, campaignBudget: metaCampaigns.dailyBudget })
      .from(metaAdsets)
      .innerJoin(metaCampaigns, eq(metaCampaigns.id, metaAdsets.campaignId))
      .where(eq(metaAdsets.id, id));
    return s?.b ?? 0;
  }
  return 0;
}
