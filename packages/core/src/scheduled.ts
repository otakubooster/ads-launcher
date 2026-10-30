import { metaConnections } from "@fahd/db/schema";
import { MetaApiError } from "@fahd/meta";
import { ne } from "drizzle-orm";
import { markConnectionBroken, syncConnectionAssets } from "./connections";
import { addDays, todayIn } from "./dates";
import { killSwitchState } from "./guardrails";
import { syncAccountObjects, syncInsights, syncableAccounts } from "./sync";
import type { AnyDb } from "./types";

export type ScheduledSyncResult = { skipped?: string; accounts: number; failed: { adAccountId: string; error: string }[]; assets?: number; days?: number };

/**
 * The worker's schedule for hosts without one (Vercel): an external cron calls this
 * every 15 minutes ("quick": objects plus yesterday's and today's insights) and once a
 * day ("daily": also pages, Instagram accounts and pixels, and the last 7 days of
 * insights, which Meta keeps adjusting). Account by account, never in parallel.
 */
export async function scheduledSync(db: AnyDb, mode: "quick" | "daily" | "backfill" = "quick", backfillDays = 30): Promise<ScheduledSyncResult> {
  if ((await killSwitchState(db)).on) return { skipped: "kill switch on", accounts: 0, failed: [] };
  const result: ScheduledSyncResult = { accounts: 0, failed: [] };

  if (mode === "daily") {
    const connections = await db.select({ id: metaConnections.id }).from(metaConnections).where(ne(metaConnections.status, "broken"));
    result.assets = 0;
    for (const c of connections) {
      try {
        await syncConnectionAssets(db, c.id);
        result.assets++;
      } catch (e) {
        if (e instanceof MetaApiError && e.kind === "auth") await markConnectionBroken(db, c.id, e);
      }
    }
  }

  for (const a of await syncableAccounts(db)) {
    const today = todayIn(a.timezone);
    try {
      await syncAccountObjects(db, a.id);
      if (mode === "backfill") {
        // Re-pull history (e.g. after new metrics were added) in 10-day windows.
        for (let end = today; end > addDays(today, -backfillDays); end = addDays(end, -10)) {
          await syncInsights(db, a.id, { since: addDays(end, -9), until: end });
        }
        result.days = backfillDays;
      } else {
        await syncInsights(db, a.id, { since: addDays(today, mode === "daily" ? -7 : -1), until: today });
      }
      result.accounts++;
    } catch (e) {
      if (e instanceof MetaApiError && e.kind === "auth") await markConnectionBroken(db, a.connectionId, e);
      result.failed.push({ adAccountId: a.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
