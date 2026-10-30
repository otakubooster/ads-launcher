import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page, "Fahd");
});

test("signed-out visitors land on sign-in", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("root redirects to the dashboard inside the shell", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(8);
});

test("command palette opens with the keyboard and navigates", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").fill("presets");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/presets$/);
});

test("G then A goes to Ads", async ({ page }) => {
  await page.goto("/dashboard");
  await page.locator("main").click();
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect(page).toHaveURL(/\/ads$/);
});

test("sidebar collapse persists across reloads", async ({ page }) => {
  await page.goto("/ads");
  const aside = page.locator("aside");
  await expect(aside).toHaveAttribute("data-sidebar", "responsive");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.reload();
  await expect(aside).toHaveAttribute("data-sidebar", "collapsed");
  await expect.poll(() => aside.evaluate((e) => e.getBoundingClientRect().width)).toBe(64);
});

test("follows the system dark theme", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await context.close();
});
