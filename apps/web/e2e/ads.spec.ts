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
