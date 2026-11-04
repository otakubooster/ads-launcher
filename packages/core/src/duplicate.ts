import { metaAdsets, metaAds, metaCampaigns } from "@fahd/db/schema";
import { eq } from "drizzle-orm";
import type { MetaClient } from "@fahd/meta";
import { clientForAdAccount } from "./meta-client";
import type { ObjectLevel } from "./objects";
import { syncAccountObjects } from "./sync";
import type { AnyDb } from "./types";

const TABLES = { campaign: metaCampaigns, adset: metaAdsets, ad: metaAds } as const;

export type DuplicateInput = {
  level: ObjectLevel;
  /** Mirror uuid of the campaign, ad set or ad to copy. */
  id: string;
  copies: number;
  /**
   * Where copies go, as a mirror uuid: a campaign for ad sets, an ad set for ads.
   * Omitted: the original parent, as Ads Manager's "Original campaign / ad set".
   */
  destinationId?: string | null;
};

export type DuplicateResult = {
  name: string;
  metaId: string;
  adAccountId: string;
  /** Meta's response per copy, for change_log. */
  copies: { copiedId: string; response: unknown }[];
};

/**
 * Ads Manager's Duplicate through Meta's /copies: campaigns and ad sets copy with
 * everything inside them, ads copy into an ad set. Copies are always PAUSED and get
 * " - Copy" on the name; the account is re-synced so they appear in the table.
 * `db` must be privileged; the caller checks the member's role and logs each copy.
 */
export async function duplicateObject(db: AnyDb, input: DuplicateInput): Promise<DuplicateResult> {
  const table = TABLES[input.level];
  const [obj] = await db.select({ metaId: table.metaId, name: table.name, adAccountId: table.adAccountId }).from(table).where(eq(table.id, input.id));
  if (!obj) throw new Error(`${input.level} not found`);

  let destinationMetaId: string | undefined;
  if (input.destinationId && input.level !== "campaign") {
    const parent = input.level === "adset" ? metaCampaigns : metaAdsets;
    const [dest] = await db.select({ metaId: parent.metaId, adAccountId: parent.adAccountId }).from(parent).where(eq(parent.id, input.destinationId));
    if (!dest) throw new Error("Destination not found");
    if (dest.adAccountId !== obj.adAccountId) throw new Error("Copies stay in the same ad account");
    destinationMetaId = dest.metaId;
  }

  const { client, metaAccountId } = await clientForAdAccount(db, obj.adAccountId);
  const copies: DuplicateResult["copies"] = [];
  for (let i = 0; i < Math.min(Math.max(1, input.copies), 10); i++) {
    const res = await copyTree(client, metaAccountId, input.level, obj.metaId, destinationMetaId);
    copies.push({ copiedId: res.id, response: res.response });
  }
  await syncAccountObjects(db, obj.adAccountId);
  return { name: obj.name, metaId: obj.metaId, adAccountId: obj.adAccountId, copies };
}

export type NewParent = { id: string; metaId: string; name: string; adAccountId: string; response: unknown };

/**
 * Ads Manager's "New campaign" (duplicating ad sets) or "New ad set" (duplicating ads):
 * copies the original's parent without its contents (deep_copy false), paused, and
 * names it. The copies then go into it with duplicateObject({ destinationId }).
 */
export async function createDuplicateParent(db: AnyDb, input: { level: "adset" | "ad"; sourceId: string; name: string }): Promise<NewParent> {
  const name = input.name.trim();
  if (!name) throw new Error("Name the new " + (input.level === "adset" ? "campaign" : "ad set"));
  const child = input.level === "adset" ? metaAdsets : metaAds;
  const [src] = await db
    .select({ adAccountId: child.adAccountId, parentId: input.level === "adset" ? metaAdsets.campaignId : metaAds.adsetId })
    .from(child)
    .where(eq(child.id, input.sourceId));
  if (!src) throw new Error(`${input.level} not found`);
  const parentTable = input.level === "adset" ? metaCampaigns : metaAdsets;
  const [parent] = await db.select({ metaId: parentTable.metaId }).from(parentTable).where(eq(parentTable.id, src.parentId));
  if (!parent) throw new Error("Original parent not found");

  const { client, metaAccountId } = await clientForAdAccount(db, src.adAccountId);
  const opts = { accountId: metaAccountId };
  const res = await client.post<Record<string, unknown>>(
    `${parent.metaId}/copies`,
    { status_option: "PAUSED", deep_copy: false, rename_options: { rename_strategy: "ONLY_TOP_LEVEL_RENAME", rename_suffix: " - Copy" } },
    opts,
  );
  const metaId = String(res.copied_campaign_id ?? res.copied_adset_id ?? "");
  if (!metaId) throw new Error("Meta didn't return the new " + (input.level === "adset" ? "campaign" : "ad set"));
  await client.post(metaId, { name }, opts);
  await syncAccountObjects(db, src.adAccountId);
  const [row] = await db.select({ id: parentTable.id }).from(parentTable).where(eq(parentTable.metaId, metaId));
  if (!row) throw new Error("The new parent didn't sync");
  return { id: row.id, metaId, name, adAccountId: src.adAccountId, response: res };
}

const COPY = { status_option: "PAUSED" } as const;
const RENAME = { rename_options: { rename_strategy: "ONLY_TOP_LEVEL_RENAME", rename_suffix: " - Copy" } } as const;
const LIVE = (o: { status?: string }) => o.status !== "DELETED" && o.status !== "ARCHIVED";

/**
 * Meta's /copies refuses more than 2 objects per request ("Copy request is too large"),
 * so the tree is copied one object at a time: the top object without its contents,
 * then its ad sets, then their ads, children batched 50 per /batch call. Only the
 * top object gets " - Copy"; everything is PAUSED.
 */
async function copyTree(client: MetaClient, accountId: string, level: "campaign" | "adset" | "ad", metaId: string, destinationMetaId?: string) {
  const opts = { accountId };
  if (level === "ad") {
    const res = await client.post<{ copied_ad_id: string }>(`${metaId}/copies`, { ...COPY, ...RENAME, ...(destinationMetaId ? { adset_id: destinationMetaId } : {}) }, opts);
    return { id: res.copied_ad_id, response: res };
  }
  if (level === "adset") {
    const res = await client.post<{ copied_adset_id: string }>(`${metaId}/copies`, { ...COPY, ...RENAME, deep_copy: false, ...(destinationMetaId ? { campaign_id: destinationMetaId } : {}) }, opts);
    const ads = await copyChildren(client, accountId, metaId, "ads", res.copied_adset_id);
    return { id: res.copied_adset_id, response: { ...res, ads } };
  }
  const res = await client.post<{ copied_campaign_id: string }>(`${metaId}/copies`, { ...COPY, ...RENAME, deep_copy: false }, opts);
  const sets = await copyChildren(client, accountId, metaId, "adsets", res.copied_campaign_id);
  const ads: unknown[] = [];
  for (const set of sets) if (set.sourceId && set.copiedId) ads.push(...(await copyChildren(client, accountId, set.sourceId, "ads", set.copiedId)));
  return { id: res.copied_campaign_id, response: { ...res, adsets: sets, ads } };
}

/** Copies a parent's live ad sets or ads into `intoMetaId`, 50 per batch; failures are reported, not thrown. */
async function copyChildren(client: MetaClient, accountId: string, parentMetaId: string, edge: "adsets" | "ads", intoMetaId: string) {
  const children: { id: string; status?: string }[] = [];
  for await (const c of client.paginate<{ id: string; status?: string }>(`${parentMetaId}/${edge}`, { fields: "id,status", limit: 200 }, { accountId })) if (LIVE(c)) children.push(c);
  const out: { sourceId: string; copiedId: string | null; error?: string }[] = [];
  for (let i = 0; i < children.length; i += 50) {
    const slice = children.slice(i, i + 50);
    const results = await client.batch<Record<string, string>>(
      slice.map((c) => ({
        method: "POST" as const,
        relativeUrl: `${c.id}/copies`,
        // Children keep their names, as in Ads Manager.
        params: { ...COPY, rename_options: { rename_strategy: "NO_RENAME" }, ...(edge === "adsets" ? { deep_copy: false, campaign_id: intoMetaId } : { adset_id: intoMetaId }) },
      })),
      { accountId },
    );
    results.forEach((r, j) =>
      out.push(r.ok ? { sourceId: slice[j]!.id, copiedId: String(r.body.copied_adset_id ?? r.body.copied_ad_id ?? "") || null } : { sourceId: slice[j]!.id, copiedId: null, error: r.error.message }),
    );
  }
  return out;
}
