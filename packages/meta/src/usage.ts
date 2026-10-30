import { LIMITS } from "./config";

/**
 * Parsed rate-limit headers (docs/spec.md → Rate limits and throttling):
 *   X-Ad-Account-Usage         {"acc_id_util_pct": 9.67, "reset_time_duration": 0, "ads_api_access_tier": "standard_access"}
 *   X-Business-Use-Case-Usage  {"<business_id>": [{"type": "ads_management", "call_count": 28, "total_cputime": 25,
 *                               "total_time": 25, "estimated_time_to_regain_access": 0, "ads_api_access_tier": "…"}]}
 *   X-App-Usage                {"call_count": 4, "total_cputime": 2, "total_time": 3}
 * Percentages are 0–100. reset_time_duration is in seconds;
 * estimated_time_to_regain_access is in minutes.
 */
export type UsageSnapshot = {
  adAccount: { utilPct: number; resetSeconds: number; tier: string | null } | null;
  business: {
    businessId: string;
    type: string;
    callCount: number;
    totalCputime: number;
    totalTime: number;
    regainMinutes: number;
    tier: string | null;
  }[];
  app: { callCount: number; totalCputime: number; totalTime: number } | null;
  /** The highest usage value across every header. */
  maxPct: number;
  tier: string | null;
};

type HeaderSource = Headers | Record<string, string | undefined>;

function header(headers: HeaderSource, name: string) {
  if (headers instanceof Headers) return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? (headers[key] ?? null) : null;
}

function json(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Returns null when the response carried no usage headers. */
export function parseUsage(headers: HeaderSource): UsageSnapshot | null {
  const acc = json(header(headers, "x-ad-account-usage")) as Record<string, unknown> | null;
  const buc = json(header(headers, "x-business-use-case-usage")) as Record<string, unknown[]> | null;
  const app = json(header(headers, "x-app-usage")) as Record<string, unknown> | null;
  if (!acc && !buc && !app) return null;

  const adAccount = acc
    ? { utilPct: num(acc.acc_id_util_pct), resetSeconds: num(acc.reset_time_duration), tier: str(acc.ads_api_access_tier) }
    : null;
  const business = Object.entries(buc ?? {}).flatMap(([businessId, entries]) =>
    (Array.isArray(entries) ? entries : []).map((e) => {
      const r = e as Record<string, unknown>;
      return {
        businessId,
        type: str(r.type) ?? "unknown",
        callCount: num(r.call_count),
        totalCputime: num(r.total_cputime),
        totalTime: num(r.total_time),
        regainMinutes: num(r.estimated_time_to_regain_access),
        tier: str(r.ads_api_access_tier),
      };
    }),
  );
  const appUsage = app
    ? { callCount: num(app.call_count), totalCputime: num(app.total_cputime), totalTime: num(app.total_time) }
    : null;

  const maxPct = Math.max(
    0,
    adAccount?.utilPct ?? 0,
    ...business.flatMap((b) => [b.callCount, b.totalCputime, b.totalTime]),
    ...(appUsage ? [appUsage.callCount, appUsage.totalCputime, appUsage.totalTime] : []),
  );
  const tier = adAccount?.tier ?? business.find((b) => b.tier)?.tier ?? null;
  return { adAccount, business, app: appUsage, maxPct, tier };
}

/** How long Meta told us to stay away, if it said. */
export function waitFromUsage(usage: UsageSnapshot | null): number | null {
  if (!usage) return null;
  const waits = [
    (usage.adAccount?.resetSeconds ?? 0) * 1000,
    ...usage.business.map((b) => b.regainMinutes * 60_000),
  ].filter((w) => w > 0);
  return waits.length ? Math.max(...waits) : null;
}

/**
 * At or above 75% on any value, pause the account until Meta's reset or
 * regain time passes (or a default minute when Meta gives neither).
 */
export function pauseUntil(usage: UsageSnapshot | null, now: number): number | null {
  if (!usage || usage.maxPct < LIMITS.pauseAtPct) return null;
  return now + (waitFromUsage(usage) ?? LIMITS.defaultPauseMs);
}
