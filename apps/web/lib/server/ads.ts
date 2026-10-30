import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { DateRange } from "@/lib/date-range";
import type { Counts } from "@/lib/metrics";
import { attributionLabel, bidStrategyLabel, resultType } from "@fahd/shared/meta-options";
import { asUser } from "./db";

export type Level = "campaign" | "adset" | "ad";

export type AdsRow = Counts & {
  id: string;
  metaId: string;
  level: Level;
  name: string;
  status: string;
  effectiveStatus: string;
  learning: string | null;
  adAccountId: string;
  accountName: string;
  currency: string;
  campaignId: string | null;
  campaignName: string | null;
  adsetName: string | null;
  thumbnailUrl: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  /** Where the budget lives when it isn't on this row. */
  budgetFrom: "campaign" | "adset" | null;
  /** What "Results" counts here, e.g. "Website purchase"; "Multiple" across ad sets. */
  resultLabel: string | null;
  /** Ad set end_time / campaign stop_time; null means ongoing. */
  endsAt: string | null;
  attribution: string | null;
  bidStrategy: string | null;
  /** Unique people for the range, from Meta (attachReach); null until fetched. */
  reach: number | null;
  prev: Counts | null;
};

export type AdsQuery = {
  level: Level;
  range: DateRange;
  previous: DateRange | null;
  accountIds: string[];
  campaignIds: string[];
  adsetIds: string[];
};

const counts = (alias: string) => sql.raw(`
  coalesce(${alias}.spend, 0)::float8 as "${alias}_spend",
  coalesce(${alias}.impressions, 0)::float8 as "${alias}_impressions",
  coalesce(${alias}.clicks, 0)::float8 as "${alias}_clicks",
  coalesce(${alias}.purchases, 0)::float8 as "${alias}_purchases",
  coalesce(${alias}.purchase_value, 0)::float8 as "${alias}_purchase_value",
  coalesce(${alias}.video_3s_plays, 0)::float8 as "${alias}_video_3s_plays",
  coalesce(${alias}.thruplays, 0)::float8 as "${alias}_thruplays",
  coalesce(${alias}.add_to_cart, 0)::float8 as "${alias}_add_to_cart",
  coalesce(${alias}.checkouts, 0)::float8 as "${alias}_checkouts",
  coalesce(${alias}.results, 0)::float8 as "${alias}_results"`);

function metricsCte(key: "ad_id" | "adset_id" | "campaign_id", range: DateRange): SQL {
  return sql`select ${sql.raw(key === "ad_id" ? "i.ad_id" : `a.${key}`)} as id,
      sum(i.spend) spend, sum(i.impressions) impressions, sum(i.clicks) clicks, sum(i.purchases) purchases,
      sum(i.purchase_value) purchase_value, sum(i.video_3s_plays) video_3s_plays, sum(i.thruplays) thruplays,
      sum(i.add_to_cart) add_to_cart, sum(i.checkouts) checkouts, sum(i.results) results
    from insights_daily i join meta_ads a on a.id = i.ad_id
    where i.date between ${range.since}::date and ${range.until}::date
    group by 1`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `and col = any('{…}'::uuid[])`. Drizzle would spread a JS array into ($1, $2…), so pass one literal. */
const anyOf = (column: string, ids: string[]) => {
  const valid = ids.filter((id) => UUID.test(id));
  return valid.length ? sql`and ${sql.raw(column)} = any(${`{${valid.join(",")}}`}::uuid[])` : sql``;
};

function readCounts(r: Record<string, unknown>, alias: string): Counts {
  const n = (k: string) => Number(r[`${alias}_${k}`] ?? 0);
  return {
    spend: n("spend"),
    impressions: n("impressions"),
    clicks: n("clicks"),
    purchases: n("purchases"),
    purchaseValue: n("purchase_value"),
    video3sPlays: n("video_3s_plays"),
    thruplays: n("thruplays"),
    addToCart: n("add_to_cart"),
    checkouts: n("checkouts"),
    results: n("results"),
  };
}

/** Per-ad-set settings that drive Results, Attribution setting and Bid strategy. */
const adsetInfo = (s: string, bid: string) =>
  `jsonb_build_object('goal', ${s}.optimization_goal, 'po', ${s}.raw->'promoted_object', 'attr', ${s}.raw->'attribution_spec', 'bid', ${bid})`;

type AdsetInfo = { goal: string | null; po: { custom_event_type?: string; custom_conversion_id?: string } | null; attr: { event_type: string; window_days: number }[] | null; bid: string | null };

/** One label when every ad set agrees, "Multiple" when they don't. */
function common(values: (string | null)[]) {
  const set = new Set(values.filter((v): v is string => v !== null));
  return set.size === 0 ? null : set.size === 1 ? [...set][0]! : "Multiple";
}

function settings(r: Record<string, unknown>) {
  const info = (r.info as AdsetInfo[] | null) ?? [];
  return {
    resultLabel: common(info.map((i) => resultType(i.goal, i.po).label)) ?? "Website purchase",
    endsAt: (r.ends_at as string | null) ?? null,
    attribution: common(info.map((i) => attributionLabel(i.attr))),
    bidStrategy: bidStrategyLabel((r.own_bid as string | null) ?? null) ?? common(info.map((i) => bidStrategyLabel(i.bid))),
  };
}

/** Rows for one level of the Ads table, with totals for the range (and the previous one). */
export async function loadAdsRows(userId: string, q: AdsQuery): Promise<AdsRow[]> {
  const key = q.level === "campaign" ? "campaign_id" : q.level === "adset" ? "adset_id" : "ad_id";
  const prevRange = q.previous ?? { since: "1900-01-01", until: "1900-01-01" };

  const query =
    q.level === "campaign"
      ? sql`with m as (${metricsCte(key, q.range)}), p as (${metricsCte(key, prevRange)})
          select o.id, o.meta_id, o.name, o.status, o.effective_status, null as learning, o.ad_account_id,
            acc.name as account_name, acc.currency, o.id as campaign_id, null as campaign_name, null as adset_name, null as thumbnail_url,
            o.daily_budget::float8, o.lifetime_budget::float8, null as budget_from,
            o.raw->>'stop_time' as ends_at, o.bid_strategy as own_bid,
            (select jsonb_agg(${sql.raw(adsetInfo("s", "coalesce(s.bid_strategy, o.bid_strategy)"))}) from meta_adsets s where s.campaign_id = o.id and s.status <> 'DELETED') as info,
            ${counts("m")}, ${counts("p")}
          from meta_campaigns o join ad_accounts acc on acc.id = o.ad_account_id
          left join m on m.id = o.id left join p on p.id = o.id
          where o.status <> 'DELETED' ${anyOf("o.ad_account_id", q.accountIds)}
          order by m.spend desc nulls last, o.name`
      : q.level === "adset"
        ? sql`with m as (${metricsCte(key, q.range)}), p as (${metricsCte(key, prevRange)})
          select o.id, o.meta_id, o.name, o.status, o.effective_status, o.raw->'learning_stage_info'->>'status' as learning, o.ad_account_id,
            acc.name as account_name, acc.currency, c.id as campaign_id, c.name as campaign_name, null as adset_name, null as thumbnail_url,
            coalesce(o.daily_budget, c.daily_budget)::float8 as daily_budget, o.lifetime_budget::float8,
            case when o.daily_budget is null and c.daily_budget is not null then 'campaign' end as budget_from,
            o.raw->>'end_time' as ends_at, coalesce(o.bid_strategy, c.bid_strategy) as own_bid,
            jsonb_build_array(${sql.raw(adsetInfo("o", "coalesce(o.bid_strategy, c.bid_strategy)"))}) as info,
            ${counts("m")}, ${counts("p")}
          from meta_adsets o join ad_accounts acc on acc.id = o.ad_account_id join meta_campaigns c on c.id = o.campaign_id
          left join m on m.id = o.id left join p on p.id = o.id
          where o.status <> 'DELETED' ${anyOf("o.ad_account_id", q.accountIds)} ${anyOf("o.campaign_id", q.campaignIds)}
          order by m.spend desc nulls last, o.name`
        : sql`with m as (${metricsCte(key, q.range)}), p as (${metricsCte(key, prevRange)})
          select o.id, o.meta_id, o.name, o.status, o.effective_status, s.raw->'learning_stage_info'->>'status' as learning, o.ad_account_id,
            acc.name as account_name, acc.currency, c.id as campaign_id, c.name as campaign_name, s.name as adset_name, o.thumbnail_url,
            coalesce(s.daily_budget, c.daily_budget)::float8 as daily_budget, null::float8 as lifetime_budget,
            case when s.daily_budget is not null then 'adset' when c.daily_budget is not null then 'campaign' end as budget_from,
            s.raw->>'end_time' as ends_at, coalesce(s.bid_strategy, c.bid_strategy) as own_bid,
            jsonb_build_array(${sql.raw(adsetInfo("s", "coalesce(s.bid_strategy, c.bid_strategy)"))}) as info,
            ${counts("m")}, ${counts("p")}
          from meta_ads o join ad_accounts acc on acc.id = o.ad_account_id
          join meta_adsets s on s.id = o.adset_id join meta_campaigns c on c.id = o.campaign_id
          left join m on m.id = o.id left join p on p.id = o.id
          where o.status <> 'DELETED' ${anyOf("o.ad_account_id", q.accountIds)} ${anyOf("o.campaign_id", q.campaignIds)} ${anyOf("o.adset_id", q.adsetIds)}
          order by m.spend desc nulls last, o.name`;

  const result = await asUser(userId, (tx) => tx.execute(query));
  return (result as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    metaId: String(r.meta_id),
    level: q.level,
    name: String(r.name),
    status: String(r.status),
    effectiveStatus: String(r.effective_status),
    learning: (r.learning as string | null) ?? null,
    adAccountId: String(r.ad_account_id),
    accountName: String(r.account_name),
    currency: String(r.currency),
    campaignId: (r.campaign_id as string | null) ?? null,
    campaignName: (r.campaign_name as string | null) ?? null,
    adsetName: (r.adset_name as string | null) ?? null,
    thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
    dailyBudget: r.daily_budget === null ? null : Number(r.daily_budget),
    lifetimeBudget: r.lifetime_budget === null ? null : Number(r.lifetime_budget),
    budgetFrom: (r.budget_from as AdsRow["budgetFrom"]) ?? null,
    ...settings(r),
    reach: null,
    ...readCounts(r, "m"),
    prev: q.previous ? readCounts(r, "p") : null,
  }));
}

/** Per-account active daily budget totals and limits, for the budget editor. */
export async function loadAccountBudgets(userId: string, accountIds: string[]) {
  const rows = (await asUser(userId, (tx) =>
    tx.execute(sql`
      select acc.id, acc.currency, acc.max_daily_budget::float8 as max, acc.approval_threshold::float8 as threshold,
        coalesce((select sum(c.daily_budget) from meta_campaigns c where c.ad_account_id = acc.id and c.status = 'ACTIVE'), 0)::float8
        + coalesce((select sum(s.daily_budget) from meta_adsets s join meta_campaigns c on c.id = s.campaign_id
            where s.ad_account_id = acc.id and s.status = 'ACTIVE' and c.status = 'ACTIVE' and c.daily_budget is null), 0)::float8 as total
      from ad_accounts acc where true ${anyOf("acc.id", accountIds)}`),
  )) as unknown as { id: string; currency: string; max: number | null; threshold: number | null; total: number }[];
  return Object.fromEntries(rows.map((r) => [r.id, { currency: r.currency, max: r.max, threshold: r.threshold, total: r.total }]));
}

export type AccountBudgets = Awaited<ReturnType<typeof loadAccountBudgets>>;
