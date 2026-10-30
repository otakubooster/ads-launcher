import { expect, test } from "@playwright/test";
import { ensureConnected, signIn } from "./helpers";

test("owner connects a Business Manager and every asset syncs (week 1 check)", async ({ page }) => {
  await signIn(page, "Fahd");
  await ensureConnected(page);
  await page.reload();
  await expect(page.getByText("3 ad accounts · 3 pages · 3 Instagram · 3 pixels")).toBeVisible();
  for (const permission of ["ads_management", "ads_read", "business_management", "instagram_basic"]) {
    await expect(page.getByRole("list", { name: "Required permissions" }).getByText(permission)).toBeVisible();
  }
  await expect(page.getByText("token ••••0001")).toBeVisible();
});

test("an admin sets a guardrail; a viewer cannot", async ({ page }) => {
  await signIn(page, "Fahd");
  await ensureConnected(page);
  await signIn(page, "Sara Admin");
  await page.goto("/settings");
  const row = page.locator("li", { hasText: "act_200000000000001" });
  await row.getByLabel("Max daily budget (USD)").fill("2500");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Guardrails saved for Lumen US.")).toBeVisible();
  await page.reload();
  await expect(row.getByLabel("Max daily budget (USD)")).toHaveValue("2500.00");

  await signIn(page, "Lina Viewer");
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Add connection" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
});
