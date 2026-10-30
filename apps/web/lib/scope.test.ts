import { describe, expect, it } from "vitest";
import { groupByBrand, scopeLabel, type ScopeAccount } from "./scope";

const accounts: ScopeAccount[] = [
  { id: "act_1", name: "Main", brand: "Lumen", market: "US" },
  { id: "act_2", name: "Scale", brand: "Lumen", market: "UK" },
  { id: "act_3", name: "Main", brand: "Arbor", market: "FR" },
];

describe("scopeLabel", () => {
  it("names the selection", () => {
    expect(scopeLabel(accounts, [])).toBe("All accounts");
    expect(scopeLabel(accounts, ["act_2"])).toBe("Lumen ▸ UK ▸ Scale");
    expect(scopeLabel(accounts, ["act_1", "act_2"])).toBe("Lumen ▸ 2 accounts");
    expect(scopeLabel(accounts, ["act_1", "act_3"])).toBe("2 accounts");
  });
});

describe("groupByBrand", () => {
  it("groups and sorts brands", () => {
    expect(groupByBrand(accounts).map(([brand, list]) => [brand, list.length])).toEqual([
      ["Arbor", 1],
      ["Lumen", 2],
    ]);
  });
});
