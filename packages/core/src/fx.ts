import type { Redis } from "ioredis";
import { currencyDigits } from "./sync";

/**
 * Exchange rates for mixed-currency views (docs/spec.md → Numbers, dates, money).
 * rates[c] = units of `base` per 1 unit of c. Sources, in order: FX_RATES env
 * (JSON, for tests and pinned rates), a 12-hour Redis cache, then the ECB rates
 * from api.frankfurter.app. Missing currencies stay unconvertible, never guessed.
 */
export type Rates = { base: string; rates: Record<string, number>; source: "env" | "cache" | "ecb" | "none" };

const CACHE_SECONDS = 12 * 3600;

export async function loadRates(
  base: string,
  { redis, fetchImpl = fetch }: { redis?: Redis | null; fetchImpl?: typeof fetch } = {},
): Promise<Rates> {
  const env = process.env.FX_RATES;
  if (env) {
    try {
      return { base, rates: { ...JSON.parse(env), [base]: 1 }, source: "env" };
    } catch {
      // fall through to live rates
    }
  }
  const key = `fx:rates:${base}`;
  const cached = redis ? await redis.get(key).catch(() => null) : null;
  if (cached) return { base, rates: JSON.parse(cached), source: "cache" };
  try {
    const res = await fetchImpl(`https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { rates: Record<string, number> };
    const rates: Record<string, number> = { [base]: 1 };
    for (const [c, perBase] of Object.entries(body.rates)) if (perBase > 0) rates[c] = 1 / perBase;
    await redis?.set(key, JSON.stringify(rates), "EX", CACHE_SECONDS).catch(() => null);
    return { base, rates, source: "ecb" };
  } catch {
    return { base, rates: { [base]: 1 }, source: "none" };
  }
}

/** Converts minor units between currencies; null when there is no rate. */
export function convertMinor(amountMinor: number, from: string, rates: Rates): number | null {
  if (from === rates.base) return amountMinor;
  const rate = rates.rates[from];
  if (!rate) return null;
  const major = amountMinor / 10 ** currencyDigits(from);
  return Math.round(major * rate * 10 ** currencyDigits(rates.base));
}
