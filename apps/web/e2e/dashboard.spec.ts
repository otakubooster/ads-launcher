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
