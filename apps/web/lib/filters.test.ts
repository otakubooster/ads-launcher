import { describe, expect, it } from "vitest";
import { filterQuery, parseFilters, resolveRanges, writeFilters } from "./filters";

const A = "11111111-1111-4111-8111-111111111111";

describe("filters in the URL", () => {
  it("parses with defaults and ignores junk", () => {
    expect(parseFilters(new URLSearchParams(""))).toEqual({ preset: "last_7d", compare: true, accountIds: [] });
    expect(parseFilters({ range: "last_28d", compare: "0", accounts: `${A},nope` })).toEqual({
      preset: "last_28d",
      compare: false,
      accountIds: [A],
    });
    expect(parseFilters({ range: "forever" }).preset).toBe("last_7d");
  });

  it("writes only non-default values and keeps other params", () => {
    const p = writeFilters(new URLSearchParams("level=ads"), { preset: "last_7d", compare: false, accountIds: [A] });
    expect(p.toString()).toBe(`level=ads&compare=0&accounts=${A}`);
    expect(filterQuery(p)).toBe(`?compare=0&accounts=${A}`);
  });

  it("resolves the range and previous period", () => {
    expect(resolveRanges({ preset: "last_7d", compare: true, accountIds: [] }, "2026-10-30")).toEqual({
      range: { since: "2026-10-23", until: "2026-10-29" },
      previous: { since: "2026-10-16", until: "2026-10-22" },
      today: "2026-10-30",
    });
  });
});
