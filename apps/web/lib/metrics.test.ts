import { describe, expect, it } from "vitest";
import { delivery } from "./delivery";
import { delta, ratios, sumCounts } from "./metrics";

describe("ratios", () => {
  it("divides summed counts and returns null on zero", () => {
    const a = { spend: 10000, impressions: 1000, clicks: 10, purchases: 2, purchaseValue: 30000, video3sPlays: 300, thruplays: 100 };
    const b = { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0, video3sPlays: 0, thruplays: 0 };
    expect(ratios(sumCounts([a, b]))).toEqual({ cpa: 5000, roas: 3, ctr: 0.01, cpm: 10000, hookRate: 0.3, holdRate: 0.1 });
    expect(ratios(b)).toEqual({ cpa: null, roas: null, ctr: null, cpm: null, hookRate: null, holdRate: null });
  });
  it("computes deltas", () => {
    expect(delta(120, 100)).toBeCloseTo(0.2);
    expect(delta(1, 0)).toBeNull();
  });
});

describe("delivery", () => {
  it.each([
    ["ACTIVE", "ACTIVE", null, "Active"],
    ["ACTIVE", "ACTIVE", "LEARNING", "Learning"],
    ["ACTIVE", "ACTIVE", "FAIL", "Learning limited"],
    ["ACTIVE", "ADSET_PAUSED", null, "Paused"],
    ["ACTIVE", "IN_PROCESS", null, "In review"],
    ["ACTIVE", "DISAPPROVED", null, "Rejected"],
    ["ACTIVE", "WITH_ISSUES", null, "Not delivering"],
  ])("%s / %s / %s → %s", (status, effective, learning, label) => {
    expect(delivery(status, effective, learning).label).toBe(label);
  });
});
