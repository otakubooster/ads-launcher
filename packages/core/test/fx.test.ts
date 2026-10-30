import { afterEach, describe, expect, it } from "vitest";
import { convertMinor, loadRates } from "../src";

afterEach(() => {
  delete process.env.FX_RATES;
});

describe("fx", () => {
  it("prefers pinned rates from the environment", async () => {
    process.env.FX_RATES = '{"EUR":1.08,"GBP":1.27}';
    const r = await loadRates("USD", { fetchImpl: () => Promise.reject(new Error("no network")) });
    expect(r.source).toBe("env");
    expect(convertMinor(10_000, "EUR", r)).toBe(10_800);
    expect(convertMinor(10_000, "USD", r)).toBe(10_000);
    expect(convertMinor(10_000, "CHF", r)).toBeNull();
  });

  it("inverts ECB rates and handles zero-decimal currencies", async () => {
    const fetchImpl = (async () => Response.json({ rates: { JPY: 150, EUR: 0.925 } })) as typeof fetch;
    const r = await loadRates("USD", { fetchImpl });
    expect(r.source).toBe("ecb");
    expect(convertMinor(15_000, "JPY", r)).toBe(10_000);
    expect(convertMinor(925, "EUR", r)).toBe(1_000);
  });

  it("falls back to no conversion when rates are unavailable", async () => {
    const r = await loadRates("USD", { fetchImpl: () => Promise.reject(new Error("offline")) });
    expect(r.source).toBe("none");
    expect(convertMinor(100, "EUR", r)).toBeNull();
  });
});
