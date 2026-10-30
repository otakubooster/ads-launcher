import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EMPTY, formatMoney, formatNumber, formatPercent, formatRoas } from "@/lib/format";
import { filterQuery, parseFilters } from "@/lib/filters";
import { accountStatus } from "@/lib/meta-labels";
import { ratios } from "@/lib/metrics";
import { requireSession } from "@/lib/server/auth";
import { loadDashboard, type Alert } from "@/lib/server/dashboard";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

const ALERT_ICON = { negative: OctagonAlert, warning: TriangleAlert, info: Info } as const;
const ALERT_COLOR = { negative: "text-red-11", warning: "text-amber-11", info: "text-blue-11" } as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const params = await searchParams;
  const filters = parseFilters(params);
  const d = await loadDashboard(session.userId, filters);
  const query = filterQuery(new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))));

  if (!d.hasAccounts) {
    return (
      <>
        <PageHeader title="Dashboard" description="Spend, purchases and ROAS across every brand and market." />
        <EmptyState
          icon={BarChart3}
          title="No data yet"
          description="Connect a Business Manager to see spend, purchases and ROAS across every ad account."
          action={
            <Button variant="primary" asChild>
              <Link href="/settings">Connect Meta</Link>
            </Button>
          }
        />
      </>
    );
  }

  const cur = ratios(d.current);
  const prev = d.previous ? ratios(d.previous) : null;
  const money = (v: number | null) => (v === null ? EMPTY : formatMoney(Math.round(v), d.currency));
  const spark = (pick: (r: ReturnType<typeof ratios>, c: (typeof d.spark)[number]) => number | null) => d.spark.map((day) => pick(ratios(day), day));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`All money in ${d.currency}${d.fxSource === "env" || d.fxSource === "cache" || d.fxSource === "ecb" ? " at current exchange rates" : ""}.`}
      />
      {d.excluded.length > 0 && (
        <p role="status" className="mb-4 rounded-control border border-amber-6 bg-amber-2 px-3 py-2 text-ui text-amber-11">
          {d.excluded.map((a) => `${a.name} (${a.currency})`).join(", ")} {d.excluded.length === 1 ? "isn't" : "aren't"} included: no exchange rate to {d.currency} is
          available.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Spend" metric="spend" value={formatMoney(d.current.spend, d.currency)} current={d.current.spend} previous={d.previous?.spend ?? null} spark={spark((_, c) => c.spend)} />
        <KpiCard label="Purchases" metric="purchases" value={formatNumber(d.current.purchases)} current={d.current.purchases} previous={d.previous?.purchases ?? null} spark={spark((_, c) => c.purchases)} />
        <KpiCard label="CPA" metric="cpa" value={money(cur.cpa)} current={cur.cpa} previous={prev?.cpa ?? null} spark={spark((r) => r.cpa)} />
        <KpiCard label="ROAS" metric="roas" value={formatRoas(cur.roas)} current={cur.roas} previous={prev?.roas ?? null} spark={spark((r) => r.roas)} />
        <KpiCard label="CTR" metric="ctr" value={formatPercent(cur.ctr)} current={cur.ctr} previous={prev?.ctr ?? null} spark={spark((r) => r.ctr)} />
        <KpiCard label="CPM" metric="cpm" value={money(cur.cpm)} current={cur.cpm} previous={prev?.cpm ?? null} spark={spark((r) => r.cpm)} />
      </dl>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <TrendChart series={d.series} previousSeries={d.previousSeries} currency={d.currency} />
        <Alerts alerts={d.alerts} />
      </div>

      <section aria-labelledby="top-title" className="mt-3 rounded-card border border-slate-6 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="top-title" className="text-section font-semibold">
            Top creatives by spend
          </h2>
          <Link href={`/ads${query ? `${query}&` : "?"}level=ads`} className="text-ui font-medium text-iris-11 hover:underline">
            All ads
          </Link>
        </div>
        {d.top.length === 0 ? (
          <p className="mt-3 text-body text-slate-11">No spend in this period.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            {d.top.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/ads${query ? `${query}&` : "?"}level=ads&open=${t.id}`}
                  className="group block overflow-hidden rounded-card border border-slate-6 hover:border-slate-8"
                >
                  <div className="aspect-[4/5] bg-slate-3">
                    {t.thumbnailUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <div className="grid gap-0.5 px-2.5 py-2">
                    <p className="truncate text-ui font-medium group-hover:underline">{t.name}</p>
                    <p className="truncate text-label text-slate-11">{t.accountName}</p>
                    <p className="flex justify-between text-label tabular-nums">
                      <span>{formatMoney(t.spend, d.currency)}</span>
                      <span>{formatRoas(t.roas)}</span>
                    </p>
                    <p className="text-label text-slate-11 tabular-nums">Hook {formatPercent(t.hookRate)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="accounts-title" className="mt-3 overflow-x-auto rounded-card border border-slate-6">
        <h2 id="accounts-title" className="px-4 pt-4 text-section font-semibold">
          Accounts today
        </h2>
        <table className="mt-2 w-full min-w-[640px] text-ui">
          <thead>
            <tr className="text-label text-slate-11">
              <th scope="col" className="h-9 border-b border-slate-6 px-4 text-left font-medium">Account</th>
              <th scope="col" className="border-b border-slate-6 px-4 text-left font-medium">Status</th>
              <th scope="col" className="border-b border-slate-6 px-4 text-right font-medium">Spend today</th>
              <th scope="col" className="border-b border-slate-6 px-4 text-right font-medium">CPA</th>
              <th scope="col" className="border-b border-slate-6 px-4 text-right font-medium">ROAS</th>
              <th scope="col" className="border-b border-slate-6 px-4 text-right font-medium">Active ads</th>
            </tr>
          </thead>
          <tbody>
            {d.accounts.map((a) => {
              const status = accountStatus(a.status);
              return (
                <tr key={a.id} className="h-10 hover:bg-slate-3">
                  <td className="border-b border-slate-6 px-4 font-medium">
                    <Link href={`/ads?accounts=${a.id}`} className="hover:underline">
                      {a.name}
                    </Link>
                  </td>
                  <td className="border-b border-slate-6 px-4">
                    <StatusDot tone={status.tone} label={status.label} />
                  </td>
                  <td className="border-b border-slate-6 px-4 text-right tabular-nums">{formatMoney(a.todaySpend, a.currency, { compact: false })}</td>
                  <td className="border-b border-slate-6 px-4 text-right tabular-nums">{a.todayCpa === null ? EMPTY : formatMoney(Math.round(a.todayCpa), a.currency)}</td>
                  <td className="border-b border-slate-6 px-4 text-right tabular-nums">{formatRoas(a.todayRoas)}</td>
                  <td className="border-b border-slate-6 px-4 text-right tabular-nums">{formatNumber(a.activeAds)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Alerts({ alerts }: { alerts: Alert[] }) {
  return (
    <section aria-labelledby="alerts-title" className="rounded-card border border-slate-6 p-4">
      <h2 id="alerts-title" className="text-section font-semibold">
        Alerts
      </h2>
      {alerts.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-body text-slate-11">
          <CircleCheck className="size-4 text-grass-11" />
          Nothing needs attention.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-6">
          {alerts.map((a) => {
            const Icon = ALERT_ICON[a.tone];
            return (
              <li key={a.id}>
                <Link href={a.href} className="-mx-2 flex gap-2.5 rounded-control px-2 py-2.5 hover:bg-slate-3">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", ALERT_COLOR[a.tone])} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-ui font-medium">{a.title}</span>
                    <span className="block text-ui text-slate-11">{a.detail}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
