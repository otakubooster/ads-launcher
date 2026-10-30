import { expect, test } from "@playwright/test";
import { ensureConnected, signIn, syncNow } from "./helpers";

test("a preset passes Test preset; naming, ad set templates and copy work (week 3 check)", async ({ page }) => {
  await signIn(page, "Fahd");
  await ensureConnected(page);
  const row = page.locator("li", { hasText: "act_200000000000001" });
  await row.getByRole("switch", { name: "Launches enabled for Lumen US" }).click();
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Guardrails saved for Lumen US.")).toBeVisible();

  await page.goto("/presets");
  await page.getByRole("button", { name: "New preset" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Brand").selectOption({ label: "Lumen" });
  await dialog.getByLabel("Market").fill("US");
  await dialog.getByLabel("Ad account").selectOption({ label: "Lumen US · act_200000000000001" });
  await dialog.getByLabel("Facebook page").selectOption({ label: "Lumen page" });
  await dialog.getByLabel("Link").fill("https://lumen.example/us");
  await dialog.getByRole("switch", { name: "Visual touch-ups" }).click();
  await dialog.getByRole("button", { name: "Save preset" }).click();
  await expect(page.getByText("Preset US · en saved.")).toBeVisible();

  const card = page.getByRole("listitem").filter({ hasText: "US · en" });
  await expect(card.getByText("1 creative features on")).toBeVisible();
  await card.getByRole("button", { name: "Test preset" }).click();
  const results = card.getByRole("list", { name: "Test results" });
  for (const line of ["Token permissions", "Ad account", "Launch access", "Facebook page", "Instagram account", "Pixel"]) {
    await expect(results.getByText(line, { exact: true })).toBeVisible();
  }
  await expect(results.locator(".text-red-11")).toHaveCount(0);

  await page.getByRole("tab", { name: "Naming templates" }).click();
  await page.getByLabel("New campaign naming pattern").fill("{brand}_{market}_{date}");
  await expect(page.getByText("Example: Lumen_US_2026-10-30").first()).toBeVisible();
  await page.getByRole("button", { name: "Add template" }).first().click();
  await expect(page.getByText("Naming template saved.")).toBeVisible();

  await page.goto("/ads");
  await syncNow(page);
  await page.goto("/presets");
  await page.getByRole("tab", { name: "Ad set templates" }).click();
  await page.getByRole("button", { name: "Clone from a live ad set" }).click();
  await page.getByRole("dialog").getByRole("option", { name: /Lumen_US_glow_1/ }).click();
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText('Saved ad set template "Lumen_US_glow_1".')).toBeVisible();
  await expect(page.getByText("Offsite conversions")).toBeVisible();

  await page.goto("/copy");
  await page.getByRole("button", { name: "New copy set" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name").fill("Glow launch");
  await sheet.getByLabel("Primary text 1", { exact: true }).fill("Wake up glowing.");
  await sheet.getByRole("button", { name: "Add primary text" }).click();
  await sheet.getByLabel("Primary text 2", { exact: true }).fill("One drop, visible glow by morning.");
  await sheet.getByLabel("Headline 1", { exact: true }).fill("Glow serum");
  await sheet.getByRole("button", { name: "Save copy set" }).click();
  await expect(page.getByText('Saved "Glow launch".')).toBeVisible();
  await expect(page.getByRole("row", { name: /Glow launch/ })).toContainText("2 · 1 · 0");
});
