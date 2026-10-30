import "server-only";
import { fetchReach, type ReachLevel } from "@fahd/core";
import { unstable_cache } from "next/cache";
import type { DateRange } from "@/lib/date-range";
import type { AdsRow, Level } from "./ads";
import { getDb } from "./db";

/** Meta counts reach per request; cache each account × level × range for 15 minutes. */
const cachedReach = unstable_cache(
  async (adAccountId: string, level: ReachLevel, since: string, until: string) => {
    try {
      return await fetchReach(getDb(), adAccountId, level, { since, until });
    } catch (e) {
      // Reach is a nice-to-have: a Meta hiccup shows "—", never a broken page.
      console.error("reach unavailable", e instanceof Error ? e.message : e);
      return {} as Record<string, number>;
    }
  },
  ["meta-reach"],
  { revalidate: 900 },
);

/**
 * Fills each row's reach for the range, and returns the total: unique people per ad
 * account, added across accounts (Meta can't de-duplicate across accounts).
 */
export async function attachReach(rows: AdsRow[], level: Level, range: DateRange): Promise<{ rows: AdsRow[]; totalReach: number | null }> {
  // Only accounts with delivery in the range: others have no reach to fetch.
  const accounts = [...new Set(rows.filter((r) => r.impressions > 0).map((r) => r.adAccountId))];
  if (accounts.length === 0) return { rows, totalReach: null };
  const results = await Promise.all(
    accounts.map(async (id) => ({
      id,
      byObject: await cachedReach(id, level, range.since, range.until),
      account: await cachedReach(id, "account", range.since, range.until),
    })),
  );
  const reach: Record<string, number> = Object.assign({}, ...results.map((r) => r.byObject));
  const totals = results.map((r) => Object.values(r.account)[0]).filter((n): n is number => typeof n === "number");
  return {
    rows: rows.map((r) => ({ ...r, reach: reach[r.metaId] ?? (r.impressions > 0 ? null : 0) })),
    totalReach: totals.length ? totals.reduce((a, b) => a + b, 0) : null,
  };
}
