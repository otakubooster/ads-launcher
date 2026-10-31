import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT, buildPlan, planHasErrors, type LaunchDraft, type PlanContext } from "../src";

const ANGLES = ["glow", "routine", "results", "gift"];
const HOOKS = ["h1", "h2", "h3", "h4", "h5"];

function draft20(): { draft: LaunchDraft; ctx: PlanContext } {
  const creatives: PlanContext["creatives"] = {};
  const groups = ANGLES.flatMap((angle) =>
    HOOKS.map((hook) => {
      const key = `${angle}-${hook}`;
      creatives[`${key}-916`] = { ratio: "9:16", kind: "video", fileName: `${key}_9x16.mp4` };
      creatives[`${key}-45`] = { ratio: "4:5", kind: "video", fileName: `${key}_4x5.mp4` };
      return { key, creativeIds: [`${key}-916`, `${key}-45`], angle, hook, format: "ugc" };
    }),
  );
  const draft: LaunchDraft = {
    ...EMPTY_DRAFT,
    destination: { mode: "new_campaign", budgetType: "adset", dailyBudget: 5000, countries: ["US"] },
    creatives: { groups },
    copy: { primaryTexts: ["Wake up glowing."], headlines: ["Glow serum"], descriptions: [], cta: "SHOP_NOW", link: "https://lumen.example/us", overrides: {} },
  };
  return { draft, ctx: { brand: "Lumen", market: "US", date: "2026-10-30", currency: "USD", creatives } };
}

describe("buildPlan", () => {
  it("builds 20 ads across 4 ad sets by angle with template names (week 3 shape)", () => {
    const { draft, ctx } = draft20();
    const plan = buildPlan(draft, ctx);
    expect(plan.campaign).toMatchObject({ source: "new", name: "Lumen_US_2026-10-30", dailyBudget: null });
    expect(plan.adsets.map((a) => a.name)).toEqual(["Lumen_US_glow_1", "Lumen_US_routine_2", "Lumen_US_results_3", "Lumen_US_gift_4"]);
    expect(plan.totals).toEqual({ ads: 20, adsets: 4, dailyBudget: 20000 });
    expect(plan.adsets[0]!.ads.map((a) => a.name)).toEqual(["h1_ugc_1", "h2_ugc_2", "h3_ugc_3", "h4_ugc_4", "h5_ugc_5"]);
    expect(plan.adsets[0]!.ads[0]!.placements).toEqual([
      { creativeId: "glow-h1-916", ratio: "9:16", placements: "Stories, Reels" },
      { creativeId: "glow-h1-45", ratio: "4:5", placements: "Feed" },
    ]);
    expect(planHasErrors(plan)).toBe(false);
  });

  it("supports one ad set per creative, all in one, and N per ad set", () => {
    const { draft, ctx } = draft20();
    expect(buildPlan({ ...draft, structure: { ...draft.structure, grouping: "per_creative" } }, ctx).totals.adsets).toBe(20);
    expect(buildPlan({ ...draft, structure: { ...draft.structure, grouping: "all_in_one" } }, ctx).totals.adsets).toBe(1);
    expect(buildPlan({ ...draft, structure: { ...draft.structure, grouping: "n_per_adset", perAdset: 6 } }, ctx).adsets.map((a) => a.ads.length)).toEqual([6, 6, 6, 2]);
  });

  it("uses one campaign budget with CBO", () => {
    const { draft, ctx } = draft20();
    const plan = buildPlan({ ...draft, destination: { ...draft.destination, budgetType: "campaign" } }, ctx);
    expect(plan.campaign.dailyBudget).toBe(5000);
    expect(plan.adsets.every((a) => a.dailyBudget === null)).toBe(true);
    expect(plan.totals.dailyBudget).toBe(5000);
  });

  it("applies per-creative copy overrides", () => {
    const { draft, ctx } = draft20();
    const plan = buildPlan({ ...draft, copy: { ...draft.copy, overrides: { "glow-h2": { primaryTexts: ["Override text"] } } } }, ctx);
    expect(plan.adsets[0]!.ads[1]!.copy.primaryTexts).toEqual(["Override text"]);
    expect(plan.adsets[0]!.ads[0]!.copy.primaryTexts).toEqual(["Wake up glowing."]);
  });

  it("flags missing pieces and unpaired files", () => {
    const { draft, ctx } = draft20();
    const one = { ...draft, creatives: { groups: [{ key: "solo", creativeIds: ["glow-h1-916"] }] }, copy: { ...draft.copy, link: "", primaryTexts: [""] }, destination: { ...draft.destination, dailyBudget: 0 } };
    const plan = buildPlan(one, ctx);
    expect(plan.issues.map((i) => i.message)).toEqual(["Add a link.", "Set a daily budget."]);
    expect(plan.adsets[0]!.ads[0]!.issues.map((i) => i.message)).toEqual(["Primary text is empty.", "No 4:5 version: Feed will use the vertical file."]);
    expect(planHasErrors(plan)).toBe(true);
  });

  it("puts every creative into each chosen existing ad set", () => {
    const { draft, ctx } = draft20();
    const plan = buildPlan(
      { ...draft, destination: { ...draft.destination, mode: "existing_adset", dailyBudget: 0 }, creatives: { groups: draft.creatives.groups.slice(0, 2) } },
      { ...ctx, existingAdsets: [{ id: "a", metaId: "111", name: "Winners" }, { id: "b", metaId: "222", name: "Broad" }] },
    );
    expect(plan.adsets.map((a) => [a.name, a.source, a.ads.length])).toEqual([
      ["Winners", "existing", 2],
      ["Broad", "existing", 2],
    ]);
    expect(planHasErrors(plan)).toBe(false);
  });
});

describe("Meta's 50 ads per ad set", () => {
  it("is an error for an all-in-one launch of 60, and fine split 30 per ad set", async () => {
    const { buildPlan, planHasErrors, EMPTY_DRAFT } = await import("../src/launch-plan");
    const creatives: Record<string, { ratio: string; kind: "image"; fileName: string }> = {};
    const groups = Array.from({ length: 60 }, (_, i) => {
      creatives[`c${i}`] = { ratio: "4:5", kind: "image", fileName: `img${i}_4x5.jpg` };
      return { key: `img${i}`, creativeIds: [`c${i}`] };
    });
    const draft = { ...EMPTY_DRAFT, destination: { ...EMPTY_DRAFT.destination, dailyBudget: 10000 }, creatives: { groups }, copy: { ...EMPTY_DRAFT.copy, primaryTexts: ["Hi"], link: "https://x.test" } };
    const ctx = { brand: "B", market: "US", date: "2026-10-31", currency: "USD", creatives };
    const allInOne = buildPlan({ ...draft, structure: { ...draft.structure, grouping: "all_in_one" } }, ctx);
    expect(planHasErrors(allInOne)).toBe(true);
    const split = buildPlan({ ...draft, structure: { ...draft.structure, grouping: "n_per_adset", perAdset: 30 } }, ctx);
    expect(split.adsets).toHaveLength(2);
    expect(planHasErrors(split)).toBe(false);
  });
});
