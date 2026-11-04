import { DATE_PRESETS, customRangeParam, parseCustomRange, previousPeriod, resolvePreset, todayIso, type DatePresetId, type DateRange } from "./date-range";

/**
 * Scope and date range live in the URL (?range=last_7d or ?range=2026-10-01..2026-10-15,
 * &compare=0, &accounts=id,id) so server pages can read them and links keep them.
 */
export type Filters = { preset: DatePresetId | "custom"; custom?: DateRange | null; compare: boolean; accountIds: string[] };

export const FILTER_KEYS = ["range", "compare", "accounts"] as const;
export const DEFAULT_FILTERS: { preset: DatePresetId; compare: boolean; accountIds: string[] } = { preset: "last_7d", compare: true, accountIds: [] };

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function get(source: ParamSource, key: string) {
  if (source instanceof URLSearchParams) return source.get(key) ?? undefined;
  const v = source[key];
  return Array.isArray(v) ? v[0] : v;
}

export function parseFilters(source: ParamSource): Filters {
  const range = get(source, "range");
  const accounts = get(source, "accounts");
  const custom = parseCustomRange(range);
  if (custom) return { preset: "custom", custom, compare: get(source, "compare") !== "0", accountIds: accounts ? accounts.split(",").filter((id) => /^[0-9a-f-]{36}$/.test(id)) : [] };
  return {
    preset: DATE_PRESETS.some((p) => p.id === range) ? (range as DatePresetId) : DEFAULT_FILTERS.preset,
    compare: get(source, "compare") !== "0",
    accountIds: accounts ? accounts.split(",").filter((id) => /^[0-9a-f-]{36}$/.test(id)) : [],
  };
}

/** Writes filters into params, leaving defaults out so URLs stay short. */
export function writeFilters(params: URLSearchParams, f: Filters) {
  const next = new URLSearchParams(params);
  if (f.preset === "custom" && f.custom) next.set("range", customRangeParam(f.custom));
  else if (f.preset === DEFAULT_FILTERS.preset || f.preset === "custom") next.delete("range");
  else next.set("range", f.preset);
  if (f.compare) next.delete("compare");
  else next.set("compare", "0");
  if (f.accountIds.length) next.set("accounts", f.accountIds.join(","));
  else next.delete("accounts");
  return next;
}

/** Only the filter params, for carrying across navigation. */
export function filterQuery(params: URLSearchParams) {
  const kept = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const v = params.get(key);
    if (v) kept.set(key, v);
  }
  const s = kept.toString();
  return s ? `?${s}` : "";
}

export function resolveRanges(f: Filters, today = todayIso()): { range: DateRange; previous: DateRange | null; today: string } {
  const preset: DatePresetId = f.preset === "custom" ? DEFAULT_FILTERS.preset : f.preset;
  const range = f.preset === "custom" && f.custom ? f.custom : resolvePreset(preset, today);
  return { range, previous: f.compare ? previousPeriod(range) : null, today };
}
