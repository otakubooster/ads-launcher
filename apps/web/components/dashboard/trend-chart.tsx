"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { EMPTY, formatMoney, formatMoneyAxis, formatNumber, formatPercent, formatRoas, moneyAxisDomain } from "@/lib/format";
import { ratios, type Counts } from "@/lib/metrics";
import type { DayPoint } from "@/lib/server/dashboard";

const METRICS = {
  roas: { label: "ROAS", value: (c: Counts) => ratios(c).roas },
  cpa: { label: "CPA", value: (c: Counts) => ratios(c).cpa },
  purchases: { label: "Purchases", value: (c: Counts) => c.purchases },
  ctr: { label: "CTR", value: (c: Counts) => ratios(c).ctr },
  cpm: { label: "CPM", value: (c: Counts) => ratios(c).cpm },
} as const;
type MetricId = keyof typeof METRICS;

const AXIS = { fill: "var(--slate-11)", fontSize: 12 };
const TOOLTIP_STYLE = { background: "var(--slate-1)", border: "1px solid var(--slate-6)", borderRadius: 8, fontSize: 12, color: "var(--slate-12)" };

/**
 * Spend and one metric as two aligned charts with a shared date axis, never a
 * dual-axis chart. The previous period is the dashed line.
 */
export function TrendChart({ series, previousSeries, currency }: { series: DayPoint[]; previousSeries: DayPoint[] | null; currency: string }) {
  const [metric, setMetric] = React.useState<MetricId>("roas");
  const fmt = (v: number | null) => {
    if (v === null || Number.isNaN(v)) return EMPTY;
    if (metric === "roas") return formatRoas(v);
    if (metric === "ctr") return formatPercent(v);
    if (metric === "purchases") return formatNumber(v);
    return formatMoney(Math.round(v), currency);
  };
  const points = series.map((d, i) => {
    const prev = previousSeries?.[i];
    return {
      date: d.date.slice(5).replace("-", "/"),
      spend: d.spend,
      value: METRICS[metric].value(d),
      previous: prev ? METRICS[metric].value(prev) : null,
    };
  });

  return (
    <section aria-labelledby="trend-title" className="rounded-card border border-slate-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="trend-title" className="text-section font-semibold">
          Daily spend and {METRICS[metric].label}
        </h2>
        <div role="group" aria-label="Metric" className="flex gap-1">
          {(Object.keys(METRICS) as MetricId[]).map((m) => (
            <Button key={m} size="sm" variant={m === metric ? "secondary" : "ghost"} aria-pressed={m === metric} onClick={() => setMetric(m)}>
              {METRICS[m].label}
            </Button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-label font-medium text-slate-11">Spend ({currency})</p>
      <div className="h-36" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer={false} data={points} syncId="trend" margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid stroke="var(--slate-4)" vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={64} domain={moneyAxisDomain(currency)} allowDecimals={false} tickFormatter={(v: number) => formatMoneyAxis(v, currency)} />
            <Tooltip cursor={{ fill: "var(--slate-3)" }} contentStyle={TOOLTIP_STYLE} formatter={(v) => [formatMoney(Number(v), currency, { compact: false }), "Spend"]} />
            <Bar dataKey="spend" fill="var(--iris-9)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-label font-medium text-slate-11">{METRICS[metric].label}</p>
        {previousSeries && (
          <ul aria-label="Legend" className="flex items-center gap-4 text-label text-slate-11">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full bg-iris-9" />
              This period
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="w-4 border-t-2 border-dashed border-slate-9" />
              Previous period
            </li>
          </ul>
        )}
      </div>
      <div className="h-32" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart accessibilityLayer={false} data={points} syncId="trend" margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--slate-4)" vertical={false} />
            <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => fmt(v)} />
            <Tooltip
              cursor={{ stroke: "var(--slate-8)" }}
              contentStyle={TOOLTIP_STYLE}
              formatter={(v, name) => [fmt(v === null ? null : Number(v)), name === "previous" ? "Previous period" : "This period"]}
            />
            {previousSeries && (
              <Line dataKey="previous" stroke="var(--slate-9)" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />
            )}
            <Line dataKey="value" stroke="var(--iris-9)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--slate-1)" }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <table className="sr-only">
        <caption>Daily spend and {METRICS[metric].label}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Spend</th>
            <th scope="col">{METRICS[metric].label}</th>
            {previousSeries && <th scope="col">Previous period</th>}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <td>{p.date}</td>
              <td>{formatMoney(p.spend, currency, { compact: false })}</td>
              <td>{fmt(p.value)}</td>
              {previousSeries && <td>{fmt(p.previous)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
