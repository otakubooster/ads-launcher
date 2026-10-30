import "server-only";
import { addDays, convertMinor, loadRates, todayIn, type Rates } from "@fahd/core";
import { sql } from "drizzle-orm";
import { resolveRanges, type Filters } from "@/lib/filters";
import { ZERO, ratios, sumCounts, type Counts } from "@/lib/metrics";
import { asUser } from "./db";
import { getQueues } from "./queue";

export type DayPoint = Counts & { date: string };

export type Alert = {
  id: string;
  tone: "negative" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
};

export type DashboardData = {
  currency: string;
  fxSource: Rates["source"];
  excluded: { name: string; currency: string }[];
  current: Counts;
  previous: Counts | null;
  series: DayPoint[];
  previousSeries: DayPoint[] | null;
  spark: DayPoint[];
  top: { id: string; name: string; thumbnailUrl: string | null; spend: number; roas: number | null; hookRate: number | null; accountName: string }[];
  alerts: Alert[];
  accounts: { id: string; name: string; currency: string; status: number; todaySpend: number; todayCpa: number | null; todayRoas: number | null; activeAds: number }[];
  hasAccounts: boolean;
};

const UUID = /^[0-9a-f-]{36}$/;
const scope = (column: string, ids: string[]) => {
  const valid = ids.filter((id) => UUID.test(id));
  return valid.length ? sql`and ${sql.raw(column)} = any(${`{${valid.join(",")}}`}::uuid[])` : sql``;
};

function daysBetween(since: string, until: string) {
  const out: string[] = [];
  for (let d = since; d <= until; d = addDays(d, 1)) out.push(d);
  return out;
}

type Raw = { ad_account_id: string; date: string } & Record<"spend" | "impressions" | "clicks" | "purchases" | "purchase_value" | "video_3s_plays" | "thruplays", number>;

export async function loadDashboard(userId: string, filters: Filters): Promise<DashboardData> {
  const { range, previous } = resolveRanges(filters);
  const sparkSince = addDays(range.until, -13);
  const since = [range.since, previous?.since ?? range.since, sparkSince].sort()[0]!;
  const reporting = process.env.REPORTING_CURRENCY ?? "USD";

  const data = await asUser(userId, async (tx) => {
    const accounts = (await tx.execute(sql`
      select a.id, a.name, a.currency, a.timezone, a.account_status as status, a.max_daily_budget::float8 as max,
        (select count(*) from meta_ads m where m.ad_account_id = a.id and m.effective_status = 'ACTIVE')::int as active_ads,
        (select count(*) from meta_ads m where m.ad_account_id = a.id and m.effective_status = 'DISAPPROVED' and m.status <> 'DELETED')::int as rejected,
        coalesce((select sum(c.daily_budget) from meta_campaigns c where c.ad_account_id = a.id and c.status = 'ACTIVE'), 0)::float8
          + coalesce((select sum(s.daily_budget) from meta_adsets s join meta_campaigns c on c.id = s.campaign_id
              where s.ad_account_id = a.id and s.status = 'ACTIVE' and c.status = 'ACTIVE' and c.daily_budget is null), 0)::float8 as active_budget
      from ad_accounts a where true ${scope("a.id", filters.accountIds)} order by a.name`)) as unknown as {
      id: string; name: string; currency: string; timezone: string; status: number; max: number | null; active_ads: number; rejected: number; active_budget: number;
    }[];
    const daily = (await tx.execute(sql`
      select ad_account_id, date::text, spend::float8, impressions::float8, clicks::float8, purchases::float8,
        purchase_value::float8, video_3s_plays::float8, thruplays::float8
      from account_insights_daily
      where date between ${since}::date and greatest(${range.until}::date, current_date + 1) ${scope("ad_account_id", filters.accountIds)}`)) as unknown as Raw[];
    const top = (await tx.execute(sql`
      select (array_agg(a.id order by a.created_at))[1] as id, (array_agg(a.name order by a.created_at))[1] as name,
        (array_agg(a.thumbnail_url) filter (where a.thumbnail_url is not null))[1] as thumbnail_url,
        acc.name as account_name, acc.currency,
        sum(i.spend)::float8 spend, sum(i.purchase_value)::float8 value, sum(i.video_3s_plays)::float8 plays, sum(i.impressions)::float8 impressions
      from insights_daily i join meta_ads a on a.id = i.ad_id join ad_accounts acc on acc.id = a.ad_account_id
      where i.date between ${range.since}::date and ${range.until}::date ${scope("a.ad_account_id", filters.accountIds)}
      group by coalesce(a.creative_id, a.id::text), acc.name, acc.currency
      order by sum(i.spend) desc limit 40`)) as unknown as { id: string; name: string; thumbnail_url: string | null; account_name: string; currency: string; spend: number; value: number; plays: number; impressions: number }[];
    const connections = (await tx.execute(sql`select business_name, status from meta_connections where status <> 'active'`)) as unknown as { business_name: string; status: string }[];
    const launches = (await tx.execute(sql`
      select id, name, status from launches where status in ('failed', 'partial') and created_at > now() - interval '7 days' order by created_at desc limit 5`)) as unknown as { id: string; name: string; status: string }[];
    const [pending] = (await tx.execute(sql`select count(*)::int as n from approval_requests where status = 'pending'`)) as unknown as { n: number }[];
    const [kill] = (await tx.execute(sql`select (value->>'on')::boolean as on from app_settings where key = 'kill_switch'`)) as unknown as { on: boolean }[];
    return { accounts, daily, top, connections, launches, pendingApprovals: pending?.n ?? 0, killSwitchOn: Boolean(kill?.on) };
  });

  const rates = await loadRates(reporting, { redis: getQueues()?.connection });
  const currencyOf = new Map(data.accounts.map((a) => [a.id, a.currency]));
  const excluded = new Map<string, { name: string; currency: string }>();
  const money = (accountId: string, minor: number) => {
    const v = convertMinor(minor, currencyOf.get(accountId) ?? reporting, rates);
    if (v === null) {
      const a = data.accounts.find((x) => x.id === accountId);
      if (a) excluded.set(a.id, { name: a.name, currency: a.currency });
    }
    return v;
  };

  const byDate = new Map<string, Counts>();
  for (const r of data.daily) {
    const spend = money(r.ad_account_id, r.spend);
    const value = money(r.ad_account_id, r.purchase_value);
    if (spend === null || value === null) continue;
    const day = byDate.get(r.date) ?? { ...ZERO };
    day.spend += spend;
    day.purchaseValue += value;
    day.impressions += r.impressions;
    day.clicks += r.clicks;
    day.purchases += r.purchases;
    day.video3sPlays += r.video_3s_plays;
    day.thruplays += r.thruplays;
    byDate.set(r.date, day);
  }
  const seriesFor = (since: string, until: string) => daysBetween(since, until).map((date) => ({ date, ...(byDate.get(date) ?? ZERO) }));
  const series = seriesFor(range.since, range.until);
  const previousSeries = previous ? seriesFor(previous.since, previous.until) : null;

  const top = data.top
    .map((t) => ({
      id: t.id,
      name: t.name,
      thumbnailUrl: t.thumbnail_url,
      accountName: t.account_name,
      spend: convertMinor(t.spend, t.currency, rates),
      roas: t.spend ? t.value / t.spend : null,
      hookRate: t.impressions ? t.plays / t.impressions : null,
    }))
    .filter((t): t is typeof t & { spend: number } => t.spend !== null)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8);

  const alerts: Alert[] = [];
  if (data.killSwitchOn) {
    alerts.push({ id: "kill-switch", tone: "negative", title: "Kill switch is on", detail: "Queues and launches are stopped. An owner can turn it off in Settings.", href: "/settings#kill-switch" });
  }
  if (data.pendingApprovals > 0) {
    alerts.push({
      id: "approvals",
      tone: "warning",
      title: `${data.pendingApprovals} ${data.pendingApprovals === 1 ? "change waits" : "changes wait"} for approval`,
      detail: "Buyers' spend increases above an account's approval threshold.",
      href: "/approvals",
    });
  }
  for (const c of data.connections) {
    alerts.push({
      id: `conn-${c.business_name}`,
      tone: "negative",
      title: c.status === "broken" ? "Meta token stopped working" : "Meta permissions missing",
      detail: `${c.business_name}: ${c.status === "broken" ? "replace the token in Settings. Syncs and launches are stopped." : "re-verify after regenerating the token with every permission."}`,
      href: "/settings#meta",
    });
  }
  for (const a of data.accounts) {
    if (a.status !== 1) alerts.push({ id: `acct-${a.id}`, tone: "negative", title: `${a.name} is not active`, detail: "Meta reports an account issue. Check billing and Account Quality.", href: "/settings#accounts" });
    if (a.rejected > 0) alerts.push({ id: `rej-${a.id}`, tone: "negative", title: `${a.rejected} rejected ${a.rejected === 1 ? "ad" : "ads"} in ${a.name}`, detail: "Review Meta's feedback and resubmit.", href: `/ads?level=ads&accounts=${a.id}` });
    if (a.max && a.active_budget >= a.max * 0.9) {
      alerts.push({ id: `guard-${a.id}`, tone: "warning", title: `${a.name} is near its spend limit`, detail: `Active daily budget is at ${Math.round((a.active_budget / a.max) * 100)}% of the account maximum.`, href: "/settings#accounts" });
    }
  }
  for (const l of data.launches) {
    alerts.push({ id: `launch-${l.id}`, tone: "warning", title: `Launch ${l.status === "failed" ? "failed" : "finished with errors"}: ${l.name}`, detail: "Open the launch log to see what failed and retry.", href: `/launches/${l.id}` });
  }

  const accounts = data.accounts.map((a) => {
    const today = todayIn(a.timezone);
    const rows = data.daily.filter((r) => r.ad_account_id === a.id && r.date === today);
    const c = sumCounts(rows.map((r) => ({ spend: r.spend, impressions: r.impressions, clicks: r.clicks, purchases: r.purchases, purchaseValue: r.purchase_value, video3sPlays: r.video_3s_plays, thruplays: r.thruplays })));
    const rr = ratios(c);
    return { id: a.id, name: a.name, currency: a.currency, status: a.status, todaySpend: c.spend, todayCpa: rr.cpa, todayRoas: rr.roas, activeAds: a.active_ads };
  });

  return {
    currency: reporting,
    fxSource: rates.source,
    excluded: [...excluded.values()],
    current: sumCounts(series),
    previous: previousSeries ? sumCounts(previousSeries) : null,
    series,
    previousSeries,
    spark: seriesFor(sparkSince, range.until),
    top,
    alerts,
    accounts,
    hasAccounts: data.accounts.length > 0,
  };
}
