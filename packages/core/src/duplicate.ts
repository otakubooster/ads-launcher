import { metaAdsets, metaAds, metaCampaigns } from "@fahd/db/schema";
import { eq } from "drizzle-orm";
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
  const params = {
    status_option: "PAUSED",
    rename_options: { rename_strategy: "ONLY_TOP_LEVEL_RENAME", rename_suffix: " - Copy" },
    ...(input.level === "ad" ? {} : { deep_copy: true }),
    ...(input.level === "adset" && destinationMetaId ? { campaign_id: destinationMetaId } : {}),
    ...(input.level === "ad" && destinationMetaId ? { adset_id: destinationMetaId } : {}),
  };
  const copies: DuplicateResult["copies"] = [];
  for (let i = 0; i < Math.min(Math.max(1, input.copies), 10); i++) {
    const res = await client.post<Record<string, unknown>>(`${obj.metaId}/copies`, params, { accountId: metaAccountId });
    const copiedId = String(res.copied_campaign_id ?? res.copied_adset_id ?? res.copied_ad_id ?? "");
    copies.push({ copiedId, response: res });
  }
  await syncAccountObjects(db, obj.adAccountId);
  return { name: obj.name, metaId: obj.metaId, adAccountId: obj.adAccountId, copies };
}
