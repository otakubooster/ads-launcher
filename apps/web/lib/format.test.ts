import { describe, expect, it } from "vitest";
import {
  EMPTY,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatRoas,
} from "./format";

describe("formatMoney", () => {
  it("reads minor units", () => {
    expect(formatMoney(15_000, "USD")).toBe("$150.00");
    expect(formatMoney(999, "EUR")).toBe("€9.99");
  });
  it("handles zero-decimal currencies", () => {
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
  });
  it("goes compact from 10,000 with a lower-case k", () => {
    expect(formatMoney(999_999, "USD")).toBe("$9,999.99");
    expect(formatMoney(1_240_000, "USD")).toBe("$12.4k");
    expect(formatMoney(125_000_000, "USD")).toBe("$1.3M");
    expect(formatMoney(1_240_000, "USD", { compact: false })).toBe("$12,400.00");
  });
  it("prints an em dash for missing values", () => {
    expect(formatMoney(null, "USD")).toBe(EMPTY);
    expect(formatMoney(Number.NaN, "USD")).toBe(EMPTY);
  });
});

describe("formatNumber", () => {
  it("groups below 10,000 and compacts above", () => {
    expect(formatNumber(9_999)).toBe("9,999");
    expect(formatNumber(12_400)).toBe("12.4k");
    expect(formatNumber(10_000)).toBe("10k");
  });
});

describe("formatPercent and formatRoas", () => {
  it("prints percentages to 1 decimal", () => {
    expect(formatPercent(0.0321)).toBe("3.2%");
    expect(formatPercent(0)).toBe("0.0%");
  });
  it("prints ROAS to 2 decimals with x", () => {
    expect(formatRoas(2.456)).toBe("2.46x");
    expect(formatRoas(undefined)).toBe(EMPTY);
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  it("buckets by size", () => {
    expect(formatRelativeTime(new Date("2026-10-30T11:59:30Z"), now)).toBe("just now");
    expect(formatRelativeTime(new Date("2026-10-30T11:58:00Z"), now)).toBe("2 min ago");
    expect(formatRelativeTime(new Date("2026-10-30T09:00:00Z"), now)).toBe("3 h ago");
    expect(formatRelativeTime(new Date("2026-10-26T12:00:00Z"), now)).toBe("4 d ago");
  });
});
