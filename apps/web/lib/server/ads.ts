import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { DateRange } from "@/lib/date-range";
import type { Counts } from "@/lib/metrics";
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
  coalesce(${alias}.thruplays, 0)::float8 as "${alias}_thruplays"`);

function metricsCte(key: "ad_id" | "adset_id" | "campaign_id", range: DateRange): SQL {
  return sql`select ${sql.raw(key === "ad_id" ? "i.ad_id" : `a.${key}`)} as id,
      sum(i.spend) spend, sum(i.impressions) impressions, sum(i.clicks) clicks, sum(i.purchases) purchases,
      sum(i.purchase_value) purchase_value, sum(i.video_3s_plays) video_3s_plays, sum(i.thruplays) thruplays
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
            o.daily_budget::float8, o.lifetime_budget::float8, null as budget_from, ${counts("m")}, ${counts("p")}
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
