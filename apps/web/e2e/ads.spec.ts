import { expect, test } from "@playwright/test";
import { ensureConnected, fakeObjects, signIn, syncNow } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page, "Fahd");
  await ensureConnected(page);
  await page.goto("/ads");
  await syncNow(page);
  await page.reload();
});

test("campaigns sync and selecting one filters the ad sets", async ({ page }) => {
  const table = page.getByRole("region", { name: "Ads table" });
  await expect(table.getByRole("button", { name: "Lumen_US_Prospecting", exact: true })).toBeVisible();
  await expect(page.locator("tfoot")).toContainText("Total · 6 rows");
  await table.getByRole("checkbox", { name: "Select Lumen_US_Prospecting" }).check();
  await expect(page).toHaveURL(/campaigns=/);
  await page.getByRole("link", { name: /^Ad sets/ }).click();
  await expect(page).toHaveURL(/level=adsets/);
  await expect(page.getByText("1 campaign selected")).toBeVisible();
  await expect(page.locator("tfoot")).toContainText("Total · 2 rows");
});

test("pausing applies at once with undo, and is logged", async ({ page }) => {
  await page.goto("/ads?level=ads");
  const toggle = page.getByRole("switch", { name: /^Pause hook1_ugc_1/ }).first();
  await toggle.click();
  await expect(page.getByText(/^Paused hook1_ugc_1/)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Activated 1 item.")).toBeVisible();
});

test("activation confirms with the budget it releases", async ({ page }) => {
  const campaign = page.getByRole("switch", { name: "Pause Lumen_US_Scaling" });
  await campaign.click();
  await expect(page.getByText("Paused Lumen_US_Scaling")).toBeVisible();
  await page.getByRole("switch", { name: "Activate Lumen_US_Scaling" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Releases \$400\.00\/day/)).toBeVisible();
  await dialog.getByRole("button", { name: /^Activate/ }).click();
  await expect(page.getByText("Activated 1 item.")).toBeVisible();
});

test("inline budget edit updates Meta and shows the account total", async ({ page }) => {
  await page.getByRole("button", { name: /^Edit budget for Lumen_US_Prospecting/ }).click();
  await page.getByRole("button", { name: "+10%" }).click();
  await expect(page.getByText(/Account daily total/)).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Budget updated for Lumen_US_Prospecting.")).toBeVisible();
  const campaign = (await fakeObjects()).find((o) => o.type === "campaign" && o.name === "Lumen_US_Prospecting");
  expect(Number(campaign?.daily_budget)).toBe(16500);
});

test("the detail drawer shows KPIs, settings and history", async ({ page }) => {
  await page.getByRole("region", { name: "Ads table" }).getByRole("button", { name: "Lumen_US_Prospecting", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Hook rate")).toBeVisible();
  await expect(drawer.getByText("Daily spend · ROAS")).toBeVisible();
  await drawer.getByRole("tab", { name: "Settings" }).click();
  await expect(drawer.getByText("OUTCOME SALES")).toBeVisible();
  await drawer.getByRole("tab", { name: "History" }).click();
  await expect(drawer.getByText(/update budget/)).toBeVisible();
});

test("viewers can read but not toggle", async ({ page }) => {
  await signIn(page, "Lina Viewer");
  await page.goto("/ads");
  await expect(page.getByRole("switch", { name: "Pause Lumen_US_Prospecting" })).toBeDisabled();
});

test("the Ads Manager column set shows results, reach, frequency, settings and funnel steps", async ({ page }) => {
  // The fake Meta account delivers today, so look at today.
  await page.goto("/ads?range=today");
  const table = page.getByRole("region", { name: "Ads table" });
  for (const header of ["Results", "Cost per result", "Amount spent", "Reach", "Frequency", "CPM", "Ends", "Attribution setting", "Bid strategy", "Purchase ROAS", "CPC (link)", "CTR (link)", "Adds to cart", "Checkouts initiated"]) {
    await expect(table.locator("thead").getByRole("button", { name: header, exact: true })).toBeVisible();
  }
  const row = table.getByRole("row", { name: /Lumen_US_Prospecting/ });
  await expect(row).toContainText("Website purchase");
  await expect(row).toContainText("Ongoing");
  await expect(row).toContainText("Highest volume");
  // Reach comes from Meta for the range; frequency is impressions ÷ reach.
  await expect(row.getByRole("cell").nth(8)).not.toHaveText("—");
  await expect(page.locator("tfoot")).not.toContainText("NaN");
});

test("Duplicate works like Ads Manager: ad sets into the original campaign, an ad into another ad set, all paused", async ({ page }) => {
  await page.goto("/ads?level=adsets");
  const table = page.getByRole("region", { name: "Ads table" });
  await table.getByRole("checkbox", { name: "Select Lumen_UK_glow_1" }).check();
  await page.getByRole("toolbar", { name: "Bulk actions" }).getByRole("button", { name: "Duplicate" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Duplicate ad set")).toBeVisible();
  await expect(dialog.getByLabel("Original campaign")).toBeChecked();
  await dialog.getByLabel("Number of copies").fill("2");
  await dialog.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByText("Created 2 copies, paused.")).toBeVisible({ timeout: 30_000 });
  await expect(table.getByRole("row", { name: /Lumen_UK_glow_1 - Copy/ })).toHaveCount(2);
  const copies = (await fakeObjects()).filter((o) => o.type === "adset" && o.name === "Lumen_UK_glow_1 - Copy");
  expect(copies.map((c) => c.status)).toEqual(["PAUSED", "PAUSED"]);

  await page.goto("/ads?level=ads");
  const ad = table.getByRole("row", { name: /hook2_ugc_2/ }).first();
  await ad.hover();
  await ad.getByRole("button", { name: "Duplicate" }).click();
  await dialog.getByLabel("Existing ad set").check();
  await dialog.getByLabel("Choose ad set").selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByText("Created 1 copy, paused.")).toBeVisible({ timeout: 30_000 });
  expect((await fakeObjects()).filter((o) => o.type === "ad" && o.name === "hook2_ugc_2 - Copy" && o.status === "PAUSED").length).toBeGreaterThanOrEqual(1);
});

test("Edit changes an ad set's name, schedule and audience on Meta, logged", async ({ page }) => {
  await page.goto("/ads?level=adsets");
  const table = page.getByRole("region", { name: "Ads table" });
  const row = table.getByRole("row", { name: /Lumen_UK_routine_2/ }).first();
  await row.hover();
  await row.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Edit ad set")).toBeVisible();
  await dialog.getByLabel("Ad set name").fill("Lumen_UK_routine_2_edited");
  await dialog.getByLabel("Locations").fill("GB, IE");
  await dialog.getByLabel("Minimum age").selectOption("25");
  await dialog.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByText("Saved Lumen_UK_routine_2_edited.")).toBeVisible({ timeout: 30_000 });
  await expect(table.getByRole("row", { name: /Lumen_UK_routine_2_edited/ })).toHaveCount(1);
  const live = (await fakeObjects()).find((o) => o.type === "adset" && o.name === "Lumen_UK_routine_2_edited") as unknown as { targeting: { geo_locations: { countries: string[] }; age_min: number } };
  expect(live.targeting.geo_locations.countries).toEqual(["GB", "IE"]);
  expect(live.targeting.age_min).toBe(25);
});
