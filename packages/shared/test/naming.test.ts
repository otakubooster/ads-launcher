import { describe, expect, it } from "vitest";
import { exampleName, renderName, unknownTokens } from "../src";

describe("naming templates", () => {
  it("fills tokens", () => {
    expect(renderName("{brand}_{market}_{date}", { brand: "Lumen", market: "US", date: "2026-10-30" })).toBe("Lumen_US_2026-10-30");
    expect(renderName("{hook}_{format}_{n}", { hook: "morning routine", format: "ugc", n: 3 })).toBe("morning-routine_ugc_3");
  });

  it("collapses separators around empty tokens", () => {
    expect(renderName("{brand}_{angle}_{hook}_{n}", { brand: "Lumen", n: 2 })).toBe("Lumen_2");
    expect(renderName("{angle}_{n}", { n: 1 })).toBe("1");
  });

  it("leaves unknown tokens and reports them", () => {
    expect(renderName("{brand}_{audience}", { brand: "Lumen" })).toBe("Lumen_{audience}");
    expect(unknownTokens("{brand}_{audience}_{n}")).toEqual(["audience"]);
  });

  it("gives a live example and caps length at 400", () => {
    expect(exampleName("{brand}_{market}_{angle}_{n}")).toBe("Lumen_US_glow_1");
    expect(renderName("x".repeat(500), {})).toHaveLength(400);
  });
});
