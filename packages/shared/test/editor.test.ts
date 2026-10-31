import { describe, expect, it } from "vitest";
import { duplicateAd, duplicateAdset, editorHasErrors, editorToPlan, newAd, newEditorDoc, validateEditor, type EditorDefaults } from "../src/editor";

const d: EditorDefaults = { brand: "Lumen", market: "US", date: "2026-11-01", pageId: "300", instagramUserId: null, pixelId: "500", event: "PURCHASE", link: "https://lumen.test", cta: "SHOP_NOW", urlTags: "utm_source=fb", features: {} };
const files = { f1: { ratio: "9:16", kind: "image" as const }, f2: { ratio: "4:5", kind: "image" as const } };

function ready() {
  const doc = newEditorDoc(d);
  doc.campaign.budget = 5000;
  const ad = doc.adsets[0]!.ads[0]!;
  ad.creativeIds = ["f1", "f2"];
  ad.primaryTexts = ["Glow by morning."];
  return doc;
}

describe("editor", () => {
  it("flags what Ads Manager would before publishing", () => {
    const doc = newEditorDoc(d);
    const issues = validateEditor(doc, files);
    expect(issues.map((i) => i.message)).toEqual(expect.arrayContaining(["Set the campaign budget.", "Add an image or video.", "Write the primary text."]));
    expect(editorHasErrors(validateEditor(ready(), files))).toBe(false);
  });

  it("needs a goal amount for cost cap and an end date for lifetime budgets", () => {
    const doc = ready();
    doc.campaign.bidStrategy = "COST_CAP";
    doc.campaign.budgetType = "lifetime";
    const messages = validateEditor(doc, files).map((i) => i.message);
    expect(messages).toContain("Set the cost per result goal.");
    expect(messages).toContain("A lifetime budget needs an end date.");
  });

  it("duplicates ad sets and ads with new keys and '- Copy' names", () => {
    const doc = ready();
    const set = duplicateAdset(doc.adsets[0]!);
    expect(set.key).not.toBe(doc.adsets[0]!.key);
    expect(set.name).toBe("Lumen US ad set 1 - Copy");
    expect(set.ads[0]!.key).not.toBe(doc.adsets[0]!.ads[0]!.key);
    expect(duplicateAd(doc.adsets[0]!.ads[0]!).name).toBe("Lumen US ad 1 - Copy");
  });

  it("turns into the runner's plan with every object's settings", () => {
    const doc = ready();
    doc.adsets[0]!.ads.push({ ...newAd(d, 2), creativeIds: ["f1"], primaryTexts: ["Two"] });
    const plan = editorToPlan(doc, files);
    expect(plan.totals).toEqual({ ads: 2, adsets: 1, dailyBudget: 5000 });
    expect(plan.campaign.settings?.campaignBudget).toBe(true);
    expect(plan.adsets[0]!.settings?.countries).toEqual(["US"]);
    expect(plan.adsets[0]!.ads[0]!.creative?.pageId).toBe("300");
    expect(plan.adsets[0]!.ads[0]!.placements.map((p) => p.placements)).toEqual(["Stories, Reels", "Feed"]);
  });
});
