import { Delta } from "@/components/table/detail-drawer";
import { cn } from "@/lib/utils";

/** Stat tile: value, change vs the previous period, 14-day sparkline (docs/spec.md → Dashboard). */
export function KpiCard({
  label,
  metric,
  value,
  current,
  previous,
  spark,
}: {
  label: string;
  metric: string;
  value: string;
  current: number | null;
  previous: number | null;
  spark: (number | null)[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-card border border-slate-6 p-4">
      <dt className="text-label font-medium text-slate-11">{label}</dt>
      <dd className="flex items-baseline gap-2">
        <span className="truncate text-kpi font-semibold tabular-nums">{value}</span>
        <Delta metric={metric} current={current} previous={previous} />
      </dd>
      <Sparkline values={spark} label={`${label}, last 14 days`} />
    </div>
  );
}

function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <div className="mt-2 h-7" aria-hidden />;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const w = 100;
  const h = 28;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => (max === min ? h / 2 : h - 2 - ((v - min) / (max - min)) * (h - 4));
  let line = "";
  values.forEach((v, i) => {
    if (v === null) return;
    line += `${line && values[i - 1] !== null ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`;
  });
  const firstIdx = values.findIndex((v) => v !== null);
  const lastIdx = values.length - 1 - [...values].reverse().findIndex((v) => v !== null);
  const area = `${line}L${x(lastIdx)},${h}L${x(firstIdx)},${h}Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label} className={cn("mt-2 h-7 w-full overflow-visible")}>
      <path d={area} fill="var(--iris-9)" fillOpacity={0.1} />
      <path d={line} fill="none" stroke="var(--iris-9)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
