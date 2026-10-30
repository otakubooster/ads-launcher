import { adAccounts } from "@fahd/db/schema";
import { eq } from "drizzle-orm";
import { clientForAdAccount } from "./meta-client";
import type { AnyDb } from "./types";

export type ReachLevel = "account" | "campaign" | "adset" | "ad";

/**
 * Reach for one date range, straight from Meta. Reach counts unique people, so it
 * can't be summed from daily rows the way spend can: Meta has to count it for the
 * exact range and level. Returns Meta object id → reach (the account's own id for
 * level "account").
 */
export async function fetchReach(db: AnyDb, adAccountId: string, level: ReachLevel, range: { since: string; until: string }) {
  const [account] = await db.select({ metaId: adAccounts.metaId }).from(adAccounts).where(eq(adAccounts.id, adAccountId));
  if (!account) return {};
  const { client, metaAccountId } = await clientForAdAccount(db, adAccountId);
  const idField = level === "account" ? "account_id" : `${level}_id`;
  const out: Record<string, number> = {};
  const rows = client.paginate<Record<string, string>>(
    `${metaAccountId}/insights`,
    { level, fields: `${idField},reach`, time_range: range, use_unified_attribution_setting: true, limit: 500 },
    { accountId: metaAccountId },
  );
  for await (const r of rows) {
    const id = level === "account" ? account.metaId : r[idField];
    if (id && r.reach) out[id] = Number(r.reach);
  }
  return out;
}
