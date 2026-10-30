import { expect, test, type Page } from "@playwright/test";
import { ensureConnected, fakeObjects, signIn, syncNow } from "./helpers";

// Arbor FR (EUR): Prospecting €150 + Scaling €400 = €550/day active. Other specs leave it alone.
const ACCOUNT = "act_200000000000003";

async function setGuardrails(page: Page, max: string, threshold: string) {
  await page.goto("/settings");
  const row = page.locator("li", { hasText: ACCOUNT });
  await row.getByLabel("Max daily budget (EUR)").fill(max);
  await row.getByLabel("Approval above (EUR)").fill(threshold);
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Guardrails saved for Arbor FR.")).toBeVisible();
}

async function editBudget(page: Page, name: string, value: string) {
  await page.goto("/ads");
  await page.getByRole("button", { name: new RegExp(`^Edit budget for ${name}`) }).click();
  await page.getByLabel("Daily budget in EUR").fill(value);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

const budgetOf = async (name: string) => Number((await fakeObjects()).find((o) => o.type === "campaign" && o.name === name)?.daily_budget);

test.describe.configure({ mode: "serial" });

test("the account maximum blocks anyone; a buyer's raise above the threshold waits for approval (week 4 check)", async ({ page }) => {
  await signIn(page, "Fahd");
  await ensureConnected(page);
  await page.goto("/ads");
  await syncNow(page);
  // The fake Graph server can outlive a run; start from €150.
  if ((await budgetOf("Arbor_FR_Prospecting")) !== 15000) {
    await editBudget(page, "Arbor_FR_Prospecting", "150");
    await expect(page.getByText("Budget updated for Arbor_FR_Prospecting.")).toBeVisible();
  }

  await signIn(page, "Sara Admin");
  await setGuardrails(page, "600", "20");

  // Owner: €150 → €300 would take the account to €700/day.
  await signIn(page, "Fahd");
  await editBudget(page, "Arbor_FR_Prospecting", "300");
  await expect(page.getByText("Above the account's daily budget limit")).toBeVisible();
  expect(await budgetOf("Arbor_FR_Prospecting")).toBe(15000);

  // Buyer: a 33% cut is too big a step.
  await signIn(page, "Omar Buyer");
  await editBudget(page, "Arbor_FR_Prospecting", "100");
  await expect(page.getByText("Change too large")).toBeVisible();

  // Buyer: +€30/day is within the max but above the €20 threshold.
  await editBudget(page, "Arbor_FR_Prospecting", "180");
  await expect(page.getByText(/^Sent for approval/)).toBeVisible();
  expect(await budgetOf("Arbor_FR_Prospecting")).toBe(15000);

  await signIn(page, "Sara Admin");
  await page.getByRole("link", { name: "1 to approve" }).click();
  await expect(page).toHaveURL(/\/approvals$/);
  await page.getByRole("button", { name: /^Approve: Budget for Arbor_FR_Prospecting/ }).click();
  await expect(page.getByText("Approved and applied: Arbor_FR_Prospecting.")).toBeVisible();
  expect(await budgetOf("Arbor_FR_Prospecting")).toBe(18000);
  await expect(page.getByRole("row", { name: /Arbor_FR_Prospecting/ }).first()).toContainText("Approved");

  await setGuardrails(page, "", "");
  await signIn(page, "Fahd");
  await editBudget(page, "Arbor_FR_Prospecting", "150");
  await expect(page.getByText("Budget updated for Arbor_FR_Prospecting.")).toBeVisible();
});

test("the kill switch stops queues and launches, and every page says so (week 4 check)", async ({ page }) => {
  await signIn(page, "Sara Admin");
  await page.goto("/settings#kill-switch");
  await expect(page.getByText("Only owners can flip it.")).toBeVisible();

  await signIn(page, "Fahd");
  await page.goto("/settings#kill-switch");
  const started = Date.now();
  await page.getByRole("button", { name: "Stop everything" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Stop everything" }).click();
  await expect(page.getByText("Kill switch on. Queues and launches are stopped.")).toBeVisible();
  expect(Date.now() - started).toBeLessThan(5_000);

  await page.goto("/ads");
  await expect(page.getByRole("alert").filter({ hasText: "Kill switch is on" })).toBeVisible();
  // Activating is refused; pausing still works.
  await page.getByRole("switch", { name: "Pause Arbor_FR_Scaling" }).click();
  await expect(page.getByText("Paused Arbor_FR_Scaling")).toBeVisible();
  await page.getByRole("switch", { name: "Activate Arbor_FR_Scaling" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Activate/ }).click();
  await expect(page.getByText("The kill switch is on", { exact: true })).toBeVisible();

  await page.goto("/settings#kill-switch");
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("Kill switch off. Queues resume.")).toBeVisible();
  await page.goto("/ads");
  await expect(page.getByRole("alert").filter({ hasText: "Kill switch is on" })).toHaveCount(0);
  await page.getByRole("switch", { name: "Activate Arbor_FR_Scaling" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Activate/ }).click();
  await expect(page.getByText("Activated 1 item.")).toBeVisible();
});
