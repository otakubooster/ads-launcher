/**
 * Ratios from summed counts, matching the SQL views (docs/spec.md → Metric
 * definitions). Always sum first, then divide; null when the divisor is zero.
 */
export type Counts = {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  video3sPlays: number;
  thruplays: number;
  addToCart: number;
  checkouts: number;
  /** The ad set's optimization event (Ads Manager's "Results"). */
  results: number;
};

export type Ratios = {
  cpa: number | null;
  roas: number | null;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  costPerResult: number | null;
  hookRate: number | null;
  holdRate: number | null;
};

const div = (a: number, b: number) => (b ? a / b : null);

export function ratios(c: Counts): Ratios {
  return {
    cpa: div(c.spend, c.purchases),
    roas: div(c.purchaseValue, c.spend),
    ctr: div(c.clicks, c.impressions),
    cpm: div(c.spend * 1000, c.impressions),
    cpc: div(c.spend, c.clicks),
    costPerResult: div(c.spend, c.results),
    hookRate: div(c.video3sPlays, c.impressions),
    holdRate: div(c.thruplays, c.impressions),
  };
}

export const ZERO: Counts = { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0, video3sPlays: 0, thruplays: 0, addToCart: 0, checkouts: 0, results: 0 };

export function sumCounts(rows: Counts[]): Counts {
  const out = { ...ZERO };
  for (const r of rows) for (const k of Object.keys(out) as (keyof Counts)[]) out[k] += r[k];
  return out;
}

/** Relative change, or null when there's nothing to compare. */
export function delta(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** Whether a rise is good: CPA and CPM should fall, everything else should rise. */
export const GOOD_WHEN_LOWER = new Set(["cpa", "cpm", "cpc", "costPerResult"]);
