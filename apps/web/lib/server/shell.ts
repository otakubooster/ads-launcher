import "server-only";
import { adAccounts, apiUsage, brands, metaCampaigns, presets } from "@fahd/db/schema";
import { eq, gt, max, sql } from "drizzle-orm";
import type { ScopeAccount } from "@/lib/scope";
import { asUser } from "./db";

export type ShellData = {
  accounts: ScopeAccount[];
  lastSyncedAt: string | null;
  /** Highest Meta usage across accounts in the last hour, 0–100, or null with no readings. */
  usagePct: number | null;
};

export async function loadShellData(userId: string): Promise<ShellData> {
  return asUser(userId, async (tx) => {
    const rows = await tx
      .select({
        id: adAccounts.id,
        name: adAccounts.name,
        brand: brands.name,
        market: presets.market,
      })
      .from(adAccounts)
      .leftJoin(presets, eq(presets.adAccountId, adAccounts.id))
      .leftJoin(brands, eq(brands.id, presets.brandId))
      .orderBy(adAccounts.name);
    const seen = new Set<string>();
    const accounts = rows
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .map((r) => ({ id: r.id, name: r.name, brand: r.brand ?? "Unassigned", market: r.market ?? "—" }));

    const [synced] = await tx.select({ at: max(metaCampaigns.syncedAt) }).from(metaCampaigns);
    const [usage] = await tx
      .select({ pct: sql<number | null>`max(${apiUsage.accUtilPct})::float` })
      .from(apiUsage)
      .where(gt(apiUsage.recordedAt, sql`now() - interval '1 hour'`));
    return { accounts, lastSyncedAt: synced?.at?.toISOString() ?? null, usagePct: usage?.pct ?? null };
  });
}
