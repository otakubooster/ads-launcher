import { expect, test } from "@playwright/test";
import { ensureConnected, signIn, syncNow } from "./helpers";

test("dashboard shows KPIs, alerts and top creatives that open the ad drawer", async ({ page }) => {
  await signIn(page, "Fahd");
  await ensureConnected(page);
  await page.goto("/dashboard?range=today");
  await syncNow(page);
  await page.reload();
  for (const label of ["Spend", "Purchases", "CPA", "ROAS", "CTR", "CPM"]) {
    await expect(page.locator("dt", { hasText: new RegExp(`^${label}$`) })).toBeVisible();
  }
  await expect(page.getByText("All money in USD at current exchange rates.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
  await expect(page.getByText(/rejected ads? in/).first()).toBeVisible();
  await page.getByRole("button", { name: "CPA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Daily spend and CPA" })).toBeVisible();
  await page.getByRole("heading", { name: "Top creatives by spend" }).locator("..").locator("..").getByRole("link").nth(1).click();
  await expect(page).toHaveURL(/level=ads.*open=/);
  await expect(page.getByRole("dialog").getByText("Hook rate")).toBeVisible();
});

test("a custom date range like Ads Manager, and Load history for days not synced yet", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "Fahd");
  await ensureConnected(page);
  await page.goto("/ads");
  await page.getByRole("button", { name: /^Date range:/ }).click();
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Start date").fill(day(-10));
  await page.getByLabel("End date").fill(day(-3));
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page).toHaveURL(new RegExp(`range=${day(-10)}\\.\\.${day(-3)}`));
  await expect(page.getByRole("button", { name: /^Date range: Custom/ })).toBeVisible();

  // A range long before the stored days offers to load them from Meta.
  await page.goto(`/dashboard?range=${day(-120)}..${day(-100)}&compare=0`);
  const banner = page.getByRole("status").filter({ hasText: "aren't loaded yet" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Load history" }).click();
  await expect(page.getByText(/History loaded from Meta|Loaded part of the history/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("status").filter({ hasText: "aren't loaded yet" })).toHaveCount(0, { timeout: 30_000 });
});
