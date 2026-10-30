import { expect, test, type Page } from "@playwright/test";
import { ensureConnected, fakeObjects, makeImage, signIn } from "./helpers";

/** A Lumen preset on the fake Lumen US account (Canada market, so it never clashes with the presets spec). */
async function ensurePreset(page: Page) {
  await page.goto("/presets");
  if (await page.getByText("CA · en").count()) return;
  await page.getByRole("button", { name: "New preset" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Brand").selectOption({ label: "Lumen" });
  await dialog.getByLabel("Market").fill("CA");
  await dialog.getByLabel("Ad account").selectOption({ label: "Lumen US · act_200000000000001" });
  await dialog.getByLabel("Facebook page").selectOption({ label: "Lumen page" });
  await dialog.getByLabel("Link").fill("https://lumen.example/ca");
  await dialog.getByRole("button", { name: "Save preset" }).click();
  await expect(page.getByText("Preset CA · en saved.")).toBeVisible();
}

test("the builder autosaves, reviews and creates everything paused (week 3 check)", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "Fahd");
  await ensureConnected(page);
  await ensurePreset(page);

  await page.goto("/launch");
  await page.getByLabel("Preset", { exact: true }).selectOption({ label: "Lumen · CA · en" });
  await page.getByRole("button", { name: "Start launch" }).click();
  await page.waitForURL(/\/launch\/[0-9a-f-]{36}$/);
  const draftUrl = page.url();

  // 1. Destination: new campaign, CBO budget.
  await page.getByLabel("Launch name").fill("E2E glow test");
  await page.getByLabel("Daily budget").fill("40");
  await expect(page.getByText("Draft saved")).toBeVisible();

  // 2. Creatives: two stems, one paired 9:16 + 4:5, one vertical only.
  await page.getByRole("button", { name: "Next: Creatives" }).click();
  await page.getByRole("button", { name: "Upload files" }).click();
  const files = [
    { name: "e2eglow_9x16.png", mimeType: "image/png", buffer: await makeImage(page, 1080, 1920, "A916") },
    { name: "e2eglow_4x5.png", mimeType: "image/png", buffer: await makeImage(page, 1080, 1350, "A45") },
    { name: "e2eshine_9x16.png", mimeType: "image/png", buffer: await makeImage(page, 1080, 1920, "B916") },
  ];
  const upload = page.getByRole("dialog");
  await upload.getByLabel("Choose files").setInputFiles(files);
  await expect(upload.getByText("Ready")).toHaveCount(3, { timeout: 30_000 });
  await upload.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("row").filter({ hasText: "e2eglow" })).toContainText("9:164:5");
  await expect(page.getByRole("row").filter({ hasText: "e2eshine" })).toContainText("No 4:5 for Feed");
  await page.getByLabel("Angle for e2eglow").fill("glow");
  await page.getByLabel("Angle for e2eshine").fill("shine");

  // 3. Copy.
  await page.getByRole("button", { name: "Next: Copy" }).click();
  await page.getByLabel("Primary text 1").fill("Wake up glowing.");
  await page.getByLabel("Headline 1").fill("Glow serum");
  await page.getByLabel("Primary text for e2eshine").fill("Shine all day.");

  // 4. Structure: one ad set per angle → 2 ad sets.
  await page.getByRole("button", { name: "Next: Structure & naming" }).click();
  await page.getByText("One ad set per angle").click();
  await expect(page.getByTestId("launch-summary")).toHaveText(/2 ads · 2 ad sets · \S*40\.00\/day · created paused/);

  // Autosave: a reload keeps every step.
  await expect(page.getByText("Draft saved")).toBeVisible();
  await page.goto(draftUrl);
  await expect(page.getByLabel("Launch name")).toHaveValue("E2E glow test");
  await expect(page.getByTestId("launch-summary")).toHaveText(/2 ads · 2 ad sets/);

  // 5. Review → Create paused.
  await page.getByRole("button", { name: "Review launch" }).click();
  const tree = page.getByRole("tree", { name: "Objects to create" });
  await expect(tree.getByText("Lumen_CA_glow_1")).toBeVisible();
  await expect(tree.getByText("9:16 → Stories, Reels · 4:5 → Feed")).toBeVisible();
  await expect(tree.getByText("No 4:5 version: Feed will use the vertical file.")).toBeVisible();
  await expect(page.getByRole("figure").filter({ hasText: "Feed" })).toBeVisible();
  await page.getByRole("button", { name: "Create paused" }).click();

  await page.waitForURL(/\/launches\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("launch-status")).toHaveText("Done", { timeout: 60_000 });
  await expect(page.getByRole("list", { name: "Launch items" }).getByRole("listitem")).toHaveCount(5);

  const objects = await fakeObjects();
  const created = objects.filter((o) => o.name?.startsWith("Lumen_CA") || o.name?.startsWith("e2e"));
  expect(created.filter((o) => o.type === "campaign")).toHaveLength(1);
  expect(created.filter((o) => o.type === "adset")).toHaveLength(2);
  expect(created.filter((o) => o.type === "ad")).toHaveLength(2);
  expect(created.filter((o) => o.type !== "adcreative").map((o) => o.status)).toEqual(Array(5).fill("PAUSED"));

  // A submitted launch can't be edited: the builder sends you to its log.
  await page.goto(draftUrl);
  await page.waitForURL(/\/launches\//);
});
