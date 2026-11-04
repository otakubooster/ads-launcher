import "server-only";
import { adAccounts } from "@fahd/db/schema";
import { asUser } from "./db";

export type HistoryGap = { since: string; accounts: number };

/** Accounts in scope whose stored insights start after `since` (a range reaching further back needs "Load history"). */
export async function historyGap(userId: string, accountIds: string[], since: string): Promise<HistoryGap | null> {
  const rows = await asUser(userId, (tx) => tx.select({ id: adAccounts.id, from: adAccounts.insightsSyncedSince, status: adAccounts.accountStatus }).from(adAccounts));
  const scoped = rows.filter((r) => r.status === 1 && (accountIds.length === 0 || accountIds.includes(r.id)));
  const missing = scoped.filter((r) => !r.from || String(r.from) > since);
  return missing.length ? { since, accounts: missing.length } : null;
}
