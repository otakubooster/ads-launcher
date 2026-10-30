import { describe, expect, it } from "vitest";
import { addDays, dayCount, formatRange, previousPeriod, resolvePreset, todayIso } from "./date-range";

const today = "2026-10-30";

describe("resolvePreset", () => {
  it("ends 'last N days' yesterday, like Ads Manager", () => {
    expect(resolvePreset("last_7d", today)).toEqual({ since: "2026-10-23", until: "2026-10-29" });
    expect(dayCount(resolvePreset("last_28d", today))).toBe(28);
  });
  it("resolves month presets", () => {
    expect(resolvePreset("this_month", today)).toEqual({ since: "2026-10-01", until: today });
    expect(resolvePreset("last_month", today)).toEqual({ since: "2026-09-01", until: "2026-09-30" });
    expect(resolvePreset("last_month", "2026-03-15")).toEqual({ since: "2026-02-01", until: "2026-02-28" });
  });
});

describe("previousPeriod", () => {
  it("returns the same length just before", () => {
    expect(previousPeriod({ since: "2026-10-23", until: "2026-10-29" })).toEqual({
      since: "2026-10-16",
      until: "2026-10-22",
    });
    expect(previousPeriod({ since: today, until: today })).toEqual({ since: "2026-10-29", until: "2026-10-29" });
  });
});

describe("formatRange", () => {
  it("drops the year inside the current year", () => {
    expect(formatRange({ since: "2026-10-23", until: "2026-10-29" }, today)).toBe("Oct 23 – Oct 29");
    expect(formatRange({ since: today, until: today }, today)).toBe("Oct 30");
  });
  it("shows years across a year boundary", () => {
    expect(formatRange({ since: "2025-12-28", until: "2026-01-03" }, "2026-01-04")).toBe(
      "Dec 28, 2025 – Jan 3, 2026",
    );
  });
});

describe("todayIso and addDays", () => {
  it("resolves today in a time zone", () => {
    const now = new Date("2026-10-30T02:00:00Z");
    expect(todayIso("UTC", now)).toBe("2026-10-30");
    expect(todayIso("America/Los_Angeles", now)).toBe("2026-10-29");
  });
  it("crosses month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});
