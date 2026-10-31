import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Every screen, light and dark, against WCAG 2.2 AA (docs/spec.md → Accessibility).
 * Runs last (file order), so the screens show the data the other specs created.
 */
const SCREENS = ["/dashboard", "/ads", "/ads?level=ads", "/launch", "/creatives", "/copy", "/launches", "/presets", "/approvals", "/settings"];

async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(" ")} — ${n.failureSummary?.split("\n").slice(1).join(" ")}`).join("\n")}`);
}

for (const scheme of ["light", "dark"] as const) {
  test(`every screen passes WCAG 2.2 AA in ${scheme} mode (week 4 check)`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await signIn(page, "Fahd");
    const screens = [...SCREENS];
    // A launch log and a draft, when the launch specs left some behind.
    await page.goto("/launches");
    const log = page.getByRole("link", { name: /E2E/ }).first();
    if (await log.count()) screens.push(new URL((await log.getAttribute("href"))!, page.url()).pathname);
    await page.goto("/launch");
    const draft = page.getByRole("list").getByRole("link").first();
    if (await draft.count()) screens.push(new URL((await draft.getAttribute("href"))!, page.url()).pathname);

    const failures: string[] = [];
    for (const path of screens) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const violations = await audit(page);
      if (violations.length) failures.push(`${path}\n  ${violations.join("\n  ")}`);
    }

    // The campaign editor: campaign, ad set and ad panels.
    await page.goto("/launch");
    const create = page.getByRole("button", { name: "Create campaign" });
    if (await create.count()) {
      await create.click();
      await page.waitForURL(/\/create\//);
      const tree = page.getByRole("navigation", { name: "Campaign structure" });
      for (const [panel, open] of [
        ["campaign", async () => {}],
        ["ad set", () => tree.getByRole("button", { name: /^(?!More for).*ad set 1/ }).first().click()],
        ["ad", () => tree.getByRole("button", { name: /^(?!More for).*ad 1/ }).last().click()],
      ] as const) {
        await open();
        await page.waitForLoadState("networkidle");
        const violations = await audit(page);
        if (violations.length) failures.push(`/create (${panel})\n  ${violations.join("\n  ")}`);
      }
    }
    expect(failures, failures.join("\n\n")).toEqual([]);
  });
}
