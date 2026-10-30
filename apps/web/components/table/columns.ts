import { delivery, type Delivery } from "@/lib/delivery";
import { EMPTY, currencyDigits, formatMoney, formatNumber, formatPercent, formatRoas } from "@/lib/format";
import { ratios, type Ratios } from "@/lib/metrics";
import type { AdsRow } from "@/lib/server/ads";

export type TableRow = AdsRow & Ratios & { delivery: Delivery; prevRatios: Ratios | null };

export function toTableRows(rows: AdsRow[]): TableRow[] {
  return rows.map((r) => ({
    ...r,
    ...ratios(r),
    delivery: delivery(r.status, r.effectiveStatus, r.learning),
    prevRatios: r.prev ? ratios(r.prev) : null,
  }));
}

export type ColumnId =
  | "delivery"
  | "budget"
  | "account"
  | "parent"
  | "spend"
  | "impressions"
  | "clicks"
  | "cpm"
  | "ctr"
  | "purchases"
  | "purchaseValue"
  | "cpa"
  | "roas"
  | "hookRate"
  | "holdRate";

type ColumnDef = {
  label: string;
  align: "left" | "right";
  width: number;
  /** Sort value. */
  value: (r: TableRow) => number | string | null;
  /** Display text. */
  format: (r: TableRow) => string;
};

const money = (key: "spend" | "purchaseValue" | "cpa" | "cpm") => (r: TableRow) => {
  const v = r[key];
  return v === null ? EMPTY : formatMoney(Math.round(v), r.currency);
};

export const COLUMNS: Record<ColumnId, ColumnDef> = {
  delivery: { label: "Delivery", align: "left", width: 148, value: (r) => r.delivery.label, format: (r) => r.delivery.label },
  budget: {
    label: "Budget",
    align: "right",
    width: 132,
    value: (r) => r.dailyBudget ?? r.lifetimeBudget ?? -1,
    format: (r) =>
      r.budgetFrom === "campaign"
        ? "Campaign budget"
        : r.budgetFrom === "adset"
          ? "Ad set budget"
          : r.dailyBudget !== null
            ? `${formatMoney(r.dailyBudget, r.currency, { compact: false })}/day`
            : r.lifetimeBudget !== null
              ? `${formatMoney(r.lifetimeBudget, r.currency)} total`
              : EMPTY,
  },
  account: { label: "Account", align: "left", width: 140, value: (r) => r.accountName, format: (r) => r.accountName },
  parent: {
    label: "Parent",
    align: "left",
    width: 200,
    value: (r) => r.adsetName ?? r.campaignName ?? "",
    format: (r) => [r.campaignName, r.adsetName].filter(Boolean).join(" ▸ ") || EMPTY,
  },
  spend: { label: "Spend", align: "right", width: 112, value: (r) => r.spend, format: money("spend") },
  impressions: { label: "Impressions", align: "right", width: 112, value: (r) => r.impressions, format: (r) => formatNumber(r.impressions) },
  clicks: { label: "Link clicks", align: "right", width: 104, value: (r) => r.clicks, format: (r) => formatNumber(r.clicks) },
  cpm: { label: "CPM", align: "right", width: 96, value: (r) => r.cpm, format: money("cpm") },
  ctr: { label: "CTR (link)", align: "right", width: 96, value: (r) => r.ctr, format: (r) => formatPercent(r.ctr) },
  purchases: { label: "Purchases", align: "right", width: 100, value: (r) => r.purchases, format: (r) => formatNumber(r.purchases) },
  purchaseValue: { label: "Purchase value", align: "right", width: 124, value: (r) => r.purchaseValue, format: money("purchaseValue") },
  cpa: { label: "CPA", align: "right", width: 96, value: (r) => r.cpa, format: money("cpa") },
  roas: { label: "ROAS", align: "right", width: 88, value: (r) => r.roas, format: (r) => formatRoas(r.roas) },
  hookRate: { label: "Hook rate", align: "right", width: 96, value: (r) => r.hookRate, format: (r) => formatPercent(r.hookRate) },
  holdRate: { label: "Hold rate", align: "right", width: 96, value: (r) => r.holdRate, format: (r) => formatPercent(r.holdRate) },
};

export const ALL_COLUMNS = Object.keys(COLUMNS) as ColumnId[];

/** Column presets (docs/spec.md → Ads toolbar). */
export const PRESETS: Record<"performance" | "creative" | "delivery", ColumnId[]> = {
  performance: ["delivery", "budget", "spend", "impressions", "cpm", "ctr", "purchases", "cpa", "roas"],
  creative: ["delivery", "spend", "hookRate", "holdRate", "ctr", "purchases", "cpa", "roas"],
  delivery: ["delivery", "budget", "account", "parent", "spend", "impressions", "cpm"],
};

export const PRESET_LABELS = { performance: "Performance", creative: "Creative", delivery: "Delivery", custom: "Custom" } as const;
export type PresetId = keyof typeof PRESET_LABELS;

/** CSV of the visible columns, values unformatted except money in major units. */
export function toCsv(rows: TableRow[], columns: ColumnId[]) {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Name", "Level", "Meta ID", "Currency", ...columns.map((c) => COLUMNS[c].label)];
  const lines = rows.map((r) => {
    const digits = currencyDigits(r.currency);
    const major = (minor: number) => (minor / 10 ** digits).toFixed(digits);
    return [
      r.name,
      r.level,
      r.metaId,
      r.currency,
      ...columns.map((c) => {
        const v = COLUMNS[c].value(r);
        if (typeof v === "number" && ["spend", "purchaseValue", "cpa", "cpm"].includes(c)) return major(v);
        if (c === "budget") return r.dailyBudget !== null ? major(r.dailyBudget) : "";
        return typeof v === "number" && v < 0 ? "" : v;
      }),
    ]
      .map(escape)
      .join(",");
  });
  return [header.map(escape).join(","), ...lines].join("\n");
}
