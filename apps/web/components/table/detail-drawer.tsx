"use client";

import * as React from "react";
import { History, X } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import type { EntityDetail } from "@/app/(app)/ads/actions";
import { loadDetailAction } from "@/app/(app)/ads/actions";
import { StatusDot } from "@/components/ui/badge";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DateRange } from "@/lib/date-range";
import { EMPTY, formatMoney, formatNumber, formatPercent, formatRelativeTime, formatRoas } from "@/lib/format";
import { GOOD_WHEN_LOWER, delta, type Ratios } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { TableRow } from "./columns";

const LEVEL_LABEL = { campaign: "Campaign", adset: "Ad set", ad: "Ad" } as const;

export function DetailDrawer({
  row,
  range,
  canEdit,
  onClose,
  onToggle,
}: {
  row: TableRow | null;
  range: DateRange;
  canEdit: boolean;
  onClose: () => void;
  onToggle: (row: TableRow, on: boolean) => void;
}) {
  const [detail, setDetail] = React.useState<{ id: string; data: EntityDetail | null; error?: string } | null>(null);

  React.useEffect(() => {
    if (!row) return;
    let cancelled = false;
    void loadDetailAction(row.level, row.id, range).then((res) => {
      if (cancelled) return;
      setDetail({ id: row.id, data: res.ok ? (res.data ?? null) : null, error: res.ok ? undefined : res.error.detail });
    });
    return () => {
      cancelled = true;
    };
  }, [row, range]);

  const data = detail && row && detail.id === row.id ? detail : null;

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" aria-describedby={undefined} className="w-[480px]">
        {row && (
          <>
            <header className="flex items-start gap-3 border-b border-slate-6 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-label text-slate-11">
                  {LEVEL_LABEL[row.level]} · {row.accountName}
                </p>
                <SheetTitle className="mt-0.5 truncate text-section font-semibold">{row.name}</SheetTitle>
                <div className="mt-2 flex items-center gap-3 text-ui">
                  <Switch
                    checked={row.status === "ACTIVE"}
                    disabled={!canEdit}
                    aria-label={row.status === "ACTIVE" ? "Pause" : "Activate"}
                    onCheckedChange={(on) => onToggle(row, on)}
                  />
                  <StatusDot tone={row.delivery.tone} label={row.delivery.label} />
                </div>
              </div>
              <SheetClose aria-label="Close" className="inline-flex size-8 items-center justify-center rounded-control text-slate-11 hover:bg-slate-3 hover:text-slate-12">
                <X className="size-4" />
              </SheetClose>
            </header>
            <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="px-5">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="creative">Creative</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <TabsContent value="overview" className="grid gap-5">
                  <Kpis row={row} />
                  <section aria-label="Daily spend and ROAS">
                    <h3 className="mb-2 text-label font-medium text-slate-11">Daily spend · ROAS</h3>
                    {!data ? <Skeleton className="h-48 w-full" /> : <DailyChart data={data.data?.daily ?? []} currency={row.currency} />}
                  </section>
                </TabsContent>
                <TabsContent value="creative">
                  {row.level === "ad" && row.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.thumbnailUrl} alt={`Creative for ${row.name}`} className="max-h-96 rounded-card border border-slate-6 object-contain" />
                  ) : (
                    <p className="text-body text-slate-11">
                      {row.level === "ad" ? "No thumbnail from Meta yet." : "Open an ad to see its creative and placement previews."}
                    </p>
                  )}
                </TabsContent>
                <TabsContent value="settings">
                  {!data ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-ui">
                      <dt className="text-slate-11">Budget</dt>
                      <dd className="tabular-nums">
                        {row.dailyBudget !== null ? `${formatMoney(row.dailyBudget, row.currency, { compact: false })}/day` : EMPTY}
                        {row.budgetFrom && <span className="text-slate-11"> ({row.budgetFrom === "campaign" ? "campaign" : "ad set"} budget)</span>}
                      </dd>
                      {data.data?.settings.map((s) => (
                        <React.Fragment key={s.label}>
                          <dt className="text-slate-11">{s.label}</dt>
                          <dd className={cn("min-w-0 break-words", s.label === "Meta ID" && "font-mono text-label")}>{s.value}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  )}
                </TabsContent>
                <TabsContent value="history">
                  {!data ? (
                    <Skeleton className="h-40 w-full" />
                  ) : data.data?.history.length ? (
                    <ol className="grid gap-3">
                      {data.data.history.map((h) => (
                        <li key={h.id} className="grid gap-0.5 text-ui">
                          <p>
                            <span className="font-medium">{h.action.replace(/_/g, " ")}</span>
                            <span className="text-slate-11"> · {h.actor ?? (h.source === "system" ? "System" : "Unknown")} · {formatRelativeTime(new Date(h.at))}</span>
                          </p>
                          {(h.before !== null || h.after !== null) && (
                            <p className="font-mono text-label text-slate-11">
                              {JSON.stringify(h.before)} → {JSON.stringify(h.after)}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="flex items-center gap-2 text-body text-slate-11">
                      <History className="size-4" />
                      No changes made from the app yet.
                    </p>
                  )}
                </TabsContent>
                {data?.error && <p role="alert" className="mt-3 text-ui text-red-11">{data.error}</p>}
              </div>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Kpis({ row }: { row: TableRow }) {
  const prev = row.prev;
  const pr = row.prevRatios;
  const items: { key: keyof Ratios | "spend" | "purchases"; label: string; value: string; current: number | null; previous: number | null }[] = [
    { key: "spend", label: "Spend", value: formatMoney(row.spend, row.currency), current: row.spend, previous: prev?.spend ?? null },
    { key: "purchases", label: "Purchases", value: formatNumber(row.purchases), current: row.purchases, previous: prev?.purchases ?? null },
    { key: "cpa", label: "CPA", value: row.cpa === null ? EMPTY : formatMoney(Math.round(row.cpa), row.currency), current: row.cpa, previous: pr?.cpa ?? null },
    { key: "roas", label: "ROAS", value: formatRoas(row.roas), current: row.roas, previous: pr?.roas ?? null },
    { key: "ctr", label: "CTR", value: formatPercent(row.ctr), current: row.ctr, previous: pr?.ctr ?? null },
    { key: "cpm", label: "CPM", value: row.cpm === null ? EMPTY : formatMoney(Math.round(row.cpm), row.currency), current: row.cpm, previous: pr?.cpm ?? null },
    { key: "hookRate", label: "Hook rate", value: formatPercent(row.hookRate), current: row.hookRate, previous: pr?.hookRate ?? null },
    { key: "holdRate", label: "Hold rate", value: formatPercent(row.holdRate), current: row.holdRate, previous: pr?.holdRate ?? null },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-slate-6 bg-slate-6">
      {items.map((k) => (
        <div key={k.key} className="bg-slate-1 px-3 py-2.5 dark:bg-slate-2">
          <dt className="text-label text-slate-11">{k.label}</dt>
          <dd className="mt-0.5 flex items-baseline gap-2">
            <span className="text-section font-semibold tabular-nums">{k.value}</span>
            <Delta metric={k.key} current={k.current} previous={k.previous} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Delta({ metric, current, previous }: { metric: string; current: number | null; previous: number | null }) {
  const d = delta(current, previous);
  if (d === null) return null;
  const up = d > 0;
  const good = GOOD_WHEN_LOWER.has(metric) ? !up : up;
  return (
    <span className={cn("text-label tabular-nums", Math.abs(d) < 0.0005 ? "text-slate-11" : good ? "text-grass-11" : "text-red-11")}>
      {up ? "▲" : "▼"} {formatPercent(Math.abs(d))}
    </span>
  );
}

function DailyChart({ data, currency }: { data: EntityDetail["daily"]; currency: string }) {
  if (data.length === 0) return <p className="text-body text-slate-11">No delivery in this period.</p>;
  const points = data.map((d) => ({ date: d.date.slice(5), spend: d.spend, roas: d.spend ? d.purchaseValue / d.spend : null }));
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--slate-4)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "var(--slate-11)", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="spend" hide />
          <YAxis yAxisId="roas" orientation="right" hide />
          <ChartTooltip
            cursor={{ fill: "var(--slate-3)" }}
            contentStyle={{ background: "var(--slate-1)", border: "1px solid var(--slate-6)", borderRadius: 8, fontSize: 12 }}
            formatter={(value, name) => (name === "spend" ? [formatMoney(Number(value), currency), "Spend"] : [formatRoas(Number(value)), "ROAS"])}
          />
          <Bar yAxisId="spend" dataKey="spend" fill="var(--slate-7)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          <Line yAxisId="roas" dataKey="roas" stroke="var(--iris-9)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
