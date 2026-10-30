/** Shown wherever a value is missing. */
export const EMPTY = "—";

const LOCALE = "en-US";
const COMPACT_FROM = 10_000;

type Maybe = number | null | undefined;

function isNum(v: Maybe): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Intl writes 12.4K; the spec's style is 12.4k. M and B stay upper case.
function lowerThousands(s: string) {
  return s.replace("K", "k");
}

export function currencyDigits(currency: string) {
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

/** Money arrives in the currency's minor unit (cents); compact above 10,000. */
export function formatMoney(minor: Maybe, currency: string, { compact = true } = {}) {
  if (!isNum(minor)) return EMPTY;
  const digits = currencyDigits(currency);
  const value = minor / 10 ** digits;
  const useCompact = compact && Math.abs(value) >= COMPACT_FROM;
  const out = new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    notation: useCompact ? "compact" : "standard",
    minimumFractionDigits: useCompact ? 0 : digits,
    maximumFractionDigits: useCompact ? 1 : digits,
  }).format(value);
  return useCompact ? lowerThousands(out) : out;
}

export function formatNumber(value: Maybe, { compact = true, decimals = 0 } = {}) {
  if (!isNum(value)) return EMPTY;
  const useCompact = compact && Math.abs(value) >= COMPACT_FROM;
  const out = new Intl.NumberFormat(LOCALE, {
    notation: useCompact ? "compact" : "standard",
    maximumFractionDigits: useCompact ? 1 : decimals,
    minimumFractionDigits: useCompact ? 0 : decimals,
  }).format(value);
  return useCompact ? lowerThousands(out) : out;
}

/** Takes a ratio (0.0321) and prints 3.2%. */
export function formatPercent(ratio: Maybe) {
  if (!isNum(ratio)) return EMPTY;
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio);
}

export function formatRoas(value: Maybe) {
  if (!isNum(value)) return EMPTY;
  return `${new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}x`;
}

/** "just now", "2 min ago", "3 h ago", "4 d ago". */
export function formatRelativeTime(then: Date, now: Date = new Date()) {
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
