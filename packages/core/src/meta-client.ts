import { adAccounts, apiUsage, metaConnections } from "@fahd/db/schema";
import { createMetaClient, type MetaClient, type UsageEvent } from "@fahd/meta";
import { decryptToken } from "@fahd/shared";
import { eq } from "drizzle-orm";
import type { AnyDb } from "./types";

/** Writes one api_usage row per response that carried usage headers. */
export function usageRecorder(db: AnyDb) {
  const ids = new Map<string, string | null>();
  return async ({ accountId, usage, at }: UsageEvent) => {
    if (!accountId) return;
    if (!ids.has(accountId)) {
      const [row] = await db.select({ id: adAccounts.id }).from(adAccounts).where(eq(adAccounts.metaId, accountId));
      ids.set(accountId, row?.id ?? null);
    }
    const adAccountId = ids.get(accountId);
    if (!adAccountId) return;
    const buc = usage.business[0];
    await db.insert(apiUsage).values({
      adAccountId,
      recordedAt: at,
      accUtilPct: usage.maxPct,
      callCount: buc?.callCount ?? usage.app?.callCount ?? null,
      totalCputime: buc?.totalCputime ?? usage.app?.totalCputime ?? null,
      totalTime: buc?.totalTime ?? usage.app?.totalTime ?? null,
      tier: usage.tier,
    });
  };
}

export function appSecret() {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new Error("META_APP_SECRET is not set");
  return secret;
}

/** A Meta client for a stored connection. `db` must be privileged: it reads the ciphertext. */
export async function clientForConnection(db: AnyDb, connectionId: string): Promise<MetaClient> {
  const [row] = await db
    .select({ ciphertext: metaConnections.tokenCiphertext, iv: metaConnections.tokenIv })
    .from(metaConnections)
    .where(eq(metaConnections.id, connectionId));
  if (!row) throw new Error("Meta connection not found");
  return createMetaClient({
    accessToken: decryptToken(row.ciphertext, row.iv),
    appSecret: appSecret(),
    onUsage: usageRecorder(db),
  });
}

/** A Meta client for the connection that owns an ad account. */
export async function clientForAdAccount(db: AnyDb, adAccountId: string) {
  const [row] = await db
    .select({ connectionId: adAccounts.connectionId, metaId: adAccounts.metaId })
    .from(adAccounts)
    .where(eq(adAccounts.id, adAccountId));
  if (!row) throw new Error("Ad account not found");
  return { client: await clientForConnection(db, row.connectionId), metaAccountId: row.metaId };
}
