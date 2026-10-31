import { adAccounts, changeLog, insightsDaily, metaAdsets, metaAds, metaCampaigns, metaConnections } from "@fahd/db/schema";
import type { MetaClient } from "@fahd/meta";
import { resultType } from "@fahd/shared/meta-options";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { clientForAdAccount } from "./meta-client";
import type { AnyDb } from "./types";

const CAMPAIGN_FIELDS = "id,name,status,effective_status,objective,bid_strategy,daily_budget,lifetime_budget,stop_time";
const ADSET_FIELDS =
  "id,name,status,effective_status,campaign_id,optimization_goal,bid_strategy,daily_budget,lifetime_budget,billing_event,targeting,learning_stage_info,promoted_object,attribution_spec,start_time,end_time,bid_amount,bid_constraints";
const AD_FIELDS = "id,name,status,effective_status,campaign_id,adset_id,creative{id,thumbnail_url},ad_review_feedback";
const INSIGHT_FIELDS =
  "ad_id,adset_id,campaign_id,spend,impressions,inline_link_clicks,actions,action_values,video_thruplay_watched_actions";

type GraphObject = Record<string, unknown> & { id: string; name: string; status: string; effective_status: string };
type Action = { action_type: string; value: string };
export type GraphInsight = {
  ad_id: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  inline_link_clicks?: string;
  actions?: Action[];
  action_values?: Action[];
  video_thruplay_watched_actions?: Action[];
};

const toMinorBudget = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

async function collect<T>(it: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

export type ObjectSyncSummary = { campaigns: number; adsets: number; ads: number; removed: number };

/**
 * Mirrors one ad account's campaigns, ad sets and ads. Objects Meta no longer
 * lists are marked DELETED, not dropped, so their insights stay. `db` must be privileged.
 */
export async function syncAccountObjects(db: AnyDb, adAccountId: string, client?: MetaClient): Promise<ObjectSyncSummary> {
  const { client: meta, metaAccountId } = client
    ? { client, metaAccountId: (await db.select({ m: adAccounts.metaId }).from(adAccounts).where(eq(adAccounts.id, adAccountId)))[0]!.m }
    : await clientForAdAccount(db, adAccountId);
  const syncedAt = new Date();
  const opts = { accountId: metaAccountId };

  const campaigns = await collect(meta.paginate<GraphObject>(`${metaAccountId}/campaigns`, { fields: CAMPAIGN_FIELDS, limit: 200 }, opts));
  const adsets = await collect(meta.paginate<GraphObject>(`${metaAccountId}/adsets`, { fields: ADSET_FIELDS, limit: 200 }, opts));
  const ads = await collect(meta.paginate<GraphObject>(`${metaAccountId}/ads`, { fields: AD_FIELDS, limit: 200 }, opts));

  const campaignIds = new Map<string, string>();
  if (campaigns.length) {
    const rows = await db
      .insert(metaCampaigns)
      .values(
        campaigns.map((c) => ({
          metaId: c.id,
          adAccountId,
          name: c.name,
          status: c.status,
          effectiveStatus: c.effective_status,
          objective: (c.objective as string) ?? null,
          bidStrategy: (c.bid_strategy as string) ?? null,
          dailyBudget: toMinorBudget(c.daily_budget),
          lifetimeBudget: toMinorBudget(c.lifetime_budget),
          raw: c,
          syncedAt,
        })),
      )
      .onConflictDoUpdate({
        target: metaCampaigns.metaId,
        set: {
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          effectiveStatus: sql`excluded.effective_status`,
          objective: sql`excluded.objective`,
          bidStrategy: sql`excluded.bid_strategy`,
          dailyBudget: sql`excluded.daily_budget`,
          lifetimeBudget: sql`excluded.lifetime_budget`,
          raw: sql`excluded.raw`,
          syncedAt: sql`excluded.synced_at`,
        },
      })
      .returning({ id: metaCampaigns.id, metaId: metaCampaigns.metaId });
    for (const r of rows) campaignIds.set(r.metaId, r.id);
  }

  const adsetIds = new Map<string, string>();
  const adsetRows = adsets.filter((a) => campaignIds.has(String(a.campaign_id)));
  if (adsetRows.length) {
    const rows = await db
      .insert(metaAdsets)
      .values(
        adsetRows.map((a) => ({
          metaId: a.id,
          adAccountId,
          campaignId: campaignIds.get(String(a.campaign_id))!,
          name: a.name,
          status: a.status,
          effectiveStatus: a.effective_status,
          optimizationGoal: (a.optimization_goal as string) ?? null,
          bidStrategy: (a.bid_strategy as string) ?? null,
          dailyBudget: toMinorBudget(a.daily_budget),
          lifetimeBudget: toMinorBudget(a.lifetime_budget),
          raw: a,
          syncedAt,
        })),
      )
      .onConflictDoUpdate({
        target: metaAdsets.metaId,
        set: {
          campaignId: sql`excluded.campaign_id`,
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          effectiveStatus: sql`excluded.effective_status`,
          optimizationGoal: sql`excluded.optimization_goal`,
          bidStrategy: sql`excluded.bid_strategy`,
          dailyBudget: sql`excluded.daily_budget`,
          lifetimeBudget: sql`excluded.lifetime_budget`,
          raw: sql`excluded.raw`,
          syncedAt: sql`excluded.synced_at`,
        },
      })
      .returning({ id: metaAdsets.id, metaId: metaAdsets.metaId });
    for (const r of rows) adsetIds.set(r.metaId, r.id);
  }

  const adRows = ads.filter((a) => adsetIds.has(String(a.adset_id)));
  if (adRows.length) {
    await db
      .insert(metaAds)
      .values(
        adRows.map((a) => {
          const creative = (a.creative ?? {}) as { id?: string; thumbnail_url?: string };
          return {
            metaId: a.id,
            adAccountId,
            campaignId: campaignIds.get(String(a.campaign_id))!,
            adsetId: adsetIds.get(String(a.adset_id))!,
            name: a.name,
            status: a.status,
            effectiveStatus: a.effective_status,
            creativeId: creative.id ?? null,
            thumbnailUrl: creative.thumbnail_url ?? null,
            raw: a,
            syncedAt,
          };
        }),
      )
      .onConflictDoUpdate({
        target: metaAds.metaId,
        set: {
          campaignId: sql`excluded.campaign_id`,
          adsetId: sql`excluded.adset_id`,
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          effectiveStatus: sql`excluded.effective_status`,
          creativeId: sql`excluded.creative_id`,
          thumbnailUrl: sql`excluded.thumbnail_url`,
          raw: sql`excluded.raw`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }

  // Anything Meta stopped listing has been deleted or archived there.
  let removed = 0;
  for (const table of [metaCampaigns, metaAdsets, metaAds]) {
    const gone = await db
      .update(table)
      .set({ effectiveStatus: "DELETED", status: "DELETED", syncedAt })
      .where(and(eq(table.adAccountId, adAccountId), lt(table.syncedAt, syncedAt), sql`${table.status} <> 'DELETED'`))
      .returning({ id: table.id });
    removed += gone.length;
  }

  await db.insert(changeLog).values({
    source: "system",
    entityLevel: "ad_account",
    entityId: metaAccountId,
    action: "sync_objects",
    after: { campaigns: campaignIds.size, adsets: adsetIds.size, ads: adRows.length, removed },
  });
  return { campaigns: campaignIds.size, adsets: adsetIds.size, ads: adRows.length, removed };
}

/**
 * Meta reports one event under several names depending on the account and source
 * (pixel, app, offline, "omni" totals). Ads Manager shows the largest, so read all.
 */
const ACTION_ALIASES: Record<string, string[]> = {
  purchase: ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"],
  add_to_cart: ["add_to_cart", "omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart", "onsite_web_add_to_cart"],
  initiate_checkout: ["initiate_checkout", "omni_initiated_checkout", "offsite_conversion.fb_pixel_initiate_checkout", "onsite_web_initiate_checkout"],
  add_payment_info: ["add_payment_info", "omni_add_payment_info", "offsite_conversion.fb_pixel_add_payment_info"],
  complete_registration: ["complete_registration", "omni_complete_registration", "offsite_conversion.fb_pixel_complete_registration"],
  view_content: ["view_content", "omni_view_content", "offsite_conversion.fb_pixel_view_content"],
  search: ["search", "omni_search", "offsite_conversion.fb_pixel_search"],
  lead: ["lead", "offsite_conversion.fb_pixel_lead"],
  add_to_wishlist: ["add_to_wishlist", "omni_add_to_wishlist", "offsite_conversion.fb_pixel_add_to_wishlist"],
};

/** The event's count (or value) under whichever name Meta used. */
function eventValue(list: Action[] | undefined, type: string) {
  return Math.max(0, ...(ACTION_ALIASES[type] ?? [type]).map((t) => actionValue(list, t)));
}

function actionValue(list: Action[] | undefined, type: string) {
  const v = list?.find((a) => a.action_type === type)?.value;
  return v ? Number(v) : 0;
}

/** Meta reports spend in major units ("12.34"); store minor units. */
export function toMinor(major: string | undefined, digits: number) {
  return major ? Math.round(Number(major) * 10 ** digits) : 0;
}

export function currencyDigits(currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Maps Graph insight rows to insights_daily rows (docs/spec.md → Metric definitions). */
/**
 * One insights_daily row per ad per day. `resultActions` maps a Meta ad id to the action
 * its ad set optimizes for (resultType()); purchases when missing.
 */
export function mapInsights(rows: GraphInsight[], adIds: Map<string, string>, currency: string, resultActions: Map<string, string> = new Map()) {
  const digits = currencyDigits(currency);
  return rows
    .filter((r) => adIds.has(r.ad_id))
    .map((r) => ({
      adId: adIds.get(r.ad_id)!,
      date: r.date_start,
      spend: toMinor(r.spend, digits),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.inline_link_clicks ?? 0),
      purchases: Math.round(eventValue(r.actions, "purchase")),
      purchaseValue: toMinor(String(eventValue(r.action_values, "purchase")), digits),
      video3sPlays: actionValue(r.actions, "video_view"),
      thruplays: actionValue(r.video_thruplay_watched_actions, "video_view"),
      addToCart: Math.round(eventValue(r.actions, "add_to_cart")),
      checkouts: Math.round(eventValue(r.actions, "initiate_checkout")),
      results: Math.round(resultCount(r, resultActions.get(r.ad_id) ?? "purchase")),
      actions: Object.fromEntries((r.actions ?? []).map((a) => [a.action_type, Number(a.value)])),
    }));
}

function resultCount(r: GraphInsight, action: string) {
  if (action === "link_click") return Number(r.inline_link_clicks ?? actionValue(r.actions, "link_click"));
  if (action === "video_thruplay") return actionValue(r.video_thruplay_watched_actions, "video_view");
  return eventValue(r.actions, action);
}

async function storeInsights(db: AnyDb, adAccountId: string, rows: GraphInsight[]) {
  const [account] = await db.select({ currency: adAccounts.currency }).from(adAccounts).where(eq(adAccounts.id, adAccountId));
  const metaIds = [...new Set(rows.map((r) => r.ad_id))];
  if (!account || metaIds.length === 0) return 0;
  const ads = await db
    .select({ id: metaAds.id, metaId: metaAds.metaId, goal: metaAdsets.optimizationGoal, adset: metaAdsets.raw })
    .from(metaAds)
    .innerJoin(metaAdsets, eq(metaAdsets.id, metaAds.adsetId))
    .where(inArray(metaAds.metaId, metaIds));
  const results = new Map(ads.map((a) => [a.metaId, resultType(a.goal, (a.adset as { promoted_object?: never }).promoted_object).action]));
  const mapped = mapInsights(rows, new Map(ads.map((a) => [a.metaId, a.id])), account.currency, results);
  for (let i = 0; i < mapped.length; i += 500) {
    await db
      .insert(insightsDaily)
      .values(mapped.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [insightsDaily.adId, insightsDaily.date],
        set: {
          spend: sql`excluded.spend`,
          impressions: sql`excluded.impressions`,
          clicks: sql`excluded.clicks`,
          purchases: sql`excluded.purchases`,
          purchaseValue: sql`excluded.purchase_value`,
          video3sPlays: sql`excluded.video_3s_plays`,
          thruplays: sql`excluded.thruplays`,
          addToCart: sql`excluded.add_to_cart`,
          checkouts: sql`excluded.checkouts`,
          results: sql`excluded.results`,
          actions: sql`excluded.actions`,
        },
      });
  }
  return mapped.length;
}

const insightParams = (since: string, until: string) => ({
  level: "ad",
  time_increment: 1,
  time_range: { since, until },
  fields: INSIGHT_FIELDS,
  // Each ad set's own attribution setting, as Ads Manager reports it.
  use_unified_attribution_setting: true,
  limit: 500,
});

/** Synchronous insights for a short range (today every 15 minutes). */
export async function syncInsights(db: AnyDb, adAccountId: string, range: { since: string; until: string }, client?: MetaClient) {
  const { client: meta, metaAccountId } = client
    ? { client, metaAccountId: (await db.select({ m: adAccounts.metaId }).from(adAccounts).where(eq(adAccounts.id, adAccountId)))[0]!.m }
    : await clientForAdAccount(db, adAccountId);
  const rows = await collect(meta.paginate<GraphInsight>(`${metaAccountId}/insights`, insightParams(range.since, range.until), { accountId: metaAccountId }));
  return storeInsights(db, adAccountId, rows);
}

/** Async report run for the nightly 28-day backfill; polls until Meta finishes. */
export async function backfillInsights(
  db: AnyDb,
  adAccountId: string,
  range: { since: string; until: string },
  { client, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), pollMs = 5_000, maxPolls = 120 }: { client?: MetaClient; sleep?: (ms: number) => Promise<void>; pollMs?: number; maxPolls?: number } = {},
) {
  const { client: meta, metaAccountId } = client
    ? { client, metaAccountId: (await db.select({ m: adAccounts.metaId }).from(adAccounts).where(eq(adAccounts.id, adAccountId)))[0]!.m }
    : await clientForAdAccount(db, adAccountId);
  const opts = { accountId: metaAccountId };
  const { report_run_id: runId } = await meta.post<{ report_run_id: string }>(`${metaAccountId}/insights`, insightParams(range.since, range.until), opts);
  for (let i = 0; ; i++) {
    const run = await meta.get<{ async_status: string; async_percent_completion: number }>(runId, {}, opts);
    if (run.async_status === "Job Completed") break;
    if (run.async_status === "Job Failed" || run.async_status === "Job Skipped") throw new Error(`Meta report ${runId}: ${run.async_status}`);
    if (i >= maxPolls) throw new Error(`Meta report ${runId} did not finish in time`);
    await sleep(pollMs);
  }
  const rows = await collect(meta.paginate<GraphInsight>(`${runId}/insights`, { limit: 500 }, opts));
  return storeInsights(db, adAccountId, rows);
}

/** Accounts with a working connection, for the scheduler. */
export async function syncableAccounts(db: AnyDb) {
  return db
    .select({ id: adAccounts.id, metaId: adAccounts.metaId, timezone: adAccounts.timezone, connectionId: adAccounts.connectionId })
    .from(adAccounts)
    .innerJoin(metaConnections, eq(metaConnections.id, adAccounts.connectionId))
    .where(and(eq(adAccounts.accountStatus, 1), ne(metaConnections.status, "broken")));
}
