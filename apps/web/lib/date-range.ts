/**
 * Date ranges are inclusive ISO dates (YYYY-MM-DD), the shape Meta's
 * `time_range` takes. "Today" is resolved in the ad account's time zone.
 */
export type DateRange = { since: string; until: string };

export type DatePresetId =
  | "today"
  | "yesterday"
  | "last_3d"
  | "last_7d"
  | "last_14d"
  | "last_28d"
  | "last_30d"
  | "last_90d"
  | "this_month"
  | "last_month";

export const DATE_PRESETS: { id: DatePresetId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last_3d", label: "Last 3 days" },
  { id: "last_7d", label: "Last 7 days" },
  { id: "last_14d", label: "Last 14 days" },
  { id: "last_28d", label: "Last 28 days" },
  { id: "last_30d", label: "Last 30 days" },
  { id: "last_90d", label: "Last 90 days" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
];

const DAY_MS = 86_400_000;

function toUtc(iso: string) {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number) {
  return toIso(new Date(toUtc(iso).getTime() + days * DAY_MS));
}

export function todayIso(timeZone?: string, now: Date = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Matches Ads Manager: "Last N days" ends yesterday. */
export function resolvePreset(id: DatePresetId, today: string): DateRange {
  const yesterday = addDays(today, -1);
  const monthStart = `${today.slice(0, 8)}01`;
  switch (id) {
    case "today":
      return { since: today, until: today };
    case "yesterday":
      return { since: yesterday, until: yesterday };
    case "last_3d":
      return { since: addDays(today, -3), until: yesterday };
    case "last_7d":
      return { since: addDays(today, -7), until: yesterday };
    case "last_14d":
      return { since: addDays(today, -14), until: yesterday };
    case "last_28d":
      return { since: addDays(today, -28), until: yesterday };
    case "last_30d":
      return { since: addDays(today, -30), until: yesterday };
    case "last_90d":
      return { since: addDays(today, -90), until: yesterday };
    case "this_month":
      return { since: monthStart, until: today };
    case "last_month": {
      const until = addDays(monthStart, -1);
      return { since: `${until.slice(0, 8)}01`, until };
    }
  }
}

export function dayCount(range: DateRange) {
  return Math.round((toUtc(range.until).getTime() - toUtc(range.since).getTime()) / DAY_MS) + 1;
}

/** The same number of days, ending the day before `range` starts. */
export function previousPeriod(range: DateRange): DateRange {
  const until = addDays(range.since, -1);
  return { since: addDays(until, -(dayCount(range) - 1)), until };
}

/** "Oct 23 – Oct 29"; adds years only when the range leaves the current year. */
export function formatRange(range: DateRange, today: string) {
  const year = today.slice(0, 4);
  const showYear = range.since.slice(0, 4) !== year || range.until.slice(0, 4) !== year;
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: showYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
  const since = fmt.format(toUtc(range.since));
  if (range.since === range.until) return since;
  return `${since} – ${fmt.format(toUtc(range.until))}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Meta keeps insights for 37 months; a custom range can't start earlier. */
export const MAX_LOOKBACK_DAYS = 37 * 30;

/** A custom range from the URL ("2026-10-01..2026-10-15"), or null when it isn't one. */
export function parseCustomRange(value: string | undefined | null): DateRange | null {
  const [since, until] = (value ?? "").split("..");
  if (!since || !until || !ISO.test(since) || !ISO.test(until) || since > until) return null;
  if (Number.isNaN(toUtc(since).getTime()) || Number.isNaN(toUtc(until).getTime())) return null;
  return { since, until };
}

export function customRangeParam(range: DateRange) {
  return `${range.since}..${range.until}`;
}
