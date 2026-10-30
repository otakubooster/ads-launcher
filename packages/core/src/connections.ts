import { adAccounts, changeLog, metaAssets, metaConnections } from "@fahd/db/schema";
import {
  MetaApiError,
  createMetaClient,
  getTokenPermissions,
  listBusinessAdAccounts,
  listInstagramAccounts,
  listOwnedPages,
  listPixels,
  missingPermissions,
  type MetaClient,
} from "@fahd/meta";
import { and, eq, lt, sql } from "drizzle-orm";
import { decryptToken } from "@fahd/shared";
import { appSecret, clientForConnection } from "./meta-client";
import type { AnyDb } from "./types";

export type TokenCheck = {
  businessName: string;
  granted: string[];
  missing: string[];
};

/** Checks a token can reach the Business Manager and lists missing permissions. */
export async function checkToken(token: string, businessId: string): Promise<TokenCheck> {
  const client = createMetaClient({ accessToken: token, appSecret: appSecret() });
  const [grants, business] = await Promise.all([
    getTokenPermissions(client),
    client.get<{ id: string; name: string }>(businessId, { fields: "id,name" }),
  ]);
  return {
    businessName: business.name,
    granted: grants.filter((g) => g.status === "granted").map((g) => g.permission),
    missing: missingPermissions(grants),
  };
}

export type SyncSummary = { adAccounts: number; pages: number; instagram: number; pixels: number };

/**
 * Upserts the connection's ad accounts (never touching guardrails) and its pages,
 * Instagram accounts and pixels, then removes assets Meta no longer lists.
 * `db` must be privileged.
 */
export async function syncConnectionAssets(db: AnyDb, connectionId: string, client?: MetaClient): Promise<SyncSummary> {
  const [connection] = await db
    .select({ businessId: metaConnections.businessId })
    .from(metaConnections)
    .where(eq(metaConnections.id, connectionId));
  if (!connection) throw new Error("Meta connection not found");
  const meta = client ?? (await clientForConnection(db, connectionId));
  const started = new Date();

  const accounts = await listBusinessAdAccounts(meta, connection.businessId);
  const accountRows = accounts.length
    ? await db
        .insert(adAccounts)
        .values(
          accounts.map((a) => ({
            metaId: a.id,
            connectionId,
            name: a.name,
            currency: a.currency,
            timezone: a.timezone_name,
            accountStatus: a.account_status,
          })),
        )
        .onConflictDoUpdate({
          target: adAccounts.metaId,
          set: {
            connectionId,
            name: sql`excluded.name`,
            currency: sql`excluded.currency`,
            timezone: sql`excluded.timezone`,
            accountStatus: sql`excluded.account_status`,
          },
        })
        .returning({ id: adAccounts.id, metaId: adAccounts.metaId })
    : [];

  const assets: (typeof metaAssets.$inferInsert)[] = [];
  for (const page of await listOwnedPages(meta, connection.businessId)) {
    assets.push({ connectionId, kind: "page", metaId: page.id, name: page.name });
  }
  for (const account of accountRows) {
    for (const ig of await listInstagramAccounts(meta, account.metaId)) {
      assets.push({ connectionId, adAccountId: account.id, kind: "instagram", metaId: ig.id, name: ig.username });
    }
    for (const pixel of await listPixels(meta, account.metaId)) {
      assets.push({ connectionId, adAccountId: account.id, kind: "pixel", metaId: pixel.id, name: pixel.name });
    }
  }
  if (assets.length) {
    await db
      .insert(metaAssets)
      .values(assets.map((a) => ({ ...a, syncedAt: started })))
      .onConflictDoUpdate({
        target: [metaAssets.connectionId, metaAssets.kind, metaAssets.metaId, metaAssets.adAccountId],
        set: { name: sql`excluded.name`, syncedAt: sql`excluded.synced_at` },
      });
  }
  await db.delete(metaAssets).where(and(eq(metaAssets.connectionId, connectionId), lt(metaAssets.syncedAt, started)));

  const summary = {
    adAccounts: accountRows.length,
    pages: assets.filter((a) => a.kind === "page").length,
    instagram: assets.filter((a) => a.kind === "instagram").length,
    pixels: assets.filter((a) => a.kind === "pixel").length,
  };
  await db.insert(changeLog).values({
    source: "system",
    entityLevel: "meta_connection",
    entityId: connectionId,
    action: "sync_assets",
    after: summary,
  });
  return summary;
}

/** Marks a connection broken after an auth error so every job for it stops. */
export async function markConnectionBroken(db: AnyDb, connectionId: string, error: MetaApiError) {
  await db.update(metaConnections).set({ status: "broken" }).where(eq(metaConnections.id, connectionId));
  await db.insert(changeLog).values({
    source: "system",
    entityLevel: "meta_connection",
    entityId: connectionId,
    action: "connection_broken",
    metaResponse: { code: error.code, subcode: error.subcode, message: error.message },
  });
}

/** Re-checks a stored token; updates scopes, status and last_verified_at. `db` must be privileged. */
export async function verifyConnection(db: AnyDb, connectionId: string): Promise<TokenCheck> {
  const [row] = await db
    .select({ businessId: metaConnections.businessId, ciphertext: metaConnections.tokenCiphertext, iv: metaConnections.tokenIv })
    .from(metaConnections)
    .where(eq(metaConnections.id, connectionId));
  if (!row) throw new Error("Meta connection not found");
  try {
    const check = await checkToken(decryptToken(row.ciphertext, row.iv), row.businessId);
    await db
      .update(metaConnections)
      .set({
        businessName: check.businessName,
        scopes: check.granted,
        status: check.missing.length ? "unverified" : "active",
        lastVerifiedAt: new Date(),
      })
      .where(eq(metaConnections.id, connectionId));
    return check;
  } catch (e) {
    if (e instanceof MetaApiError && e.kind === "auth") await markConnectionBroken(db, connectionId, e);
    throw e;
  }
}
