import { expect, type Page } from "@playwright/test";

export const FAKE_BUSINESS_ID = "100000000000001";
export const FAKE_TOKEN = "EAAFAKEsystemusertoken-e2e-000001";

export async function signIn(page: Page, name: "Fahd" | "Sara Admin" | "Omar Buyer" | "Lina Viewer") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL("**/dashboard");
}

/** Connects the fake Business Manager once; later calls are no-ops. */
export async function ensureConnected(page: Page) {
  await page.goto("/settings");
  if (await page.getByText("Fahd Holdings (fake)").count()) return;
  await page.getByRole("button", { name: "Add connection" }).click();
  await page.getByLabel("Business ID").fill(FAKE_BUSINESS_ID);
  await page.getByLabel("System user token").fill(FAKE_TOKEN);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText(/Connected Fahd Holdings \(fake\): 3 ad accounts/)).toBeVisible({ timeout: 30_000 });
}

/** Pulls campaigns, ad sets, ads and today's insights from the fake Graph API. */
export async function syncNow(page: Page) {
  await page.getByRole("button", { name: "Refresh data" }).click();
  await expect(page.getByText(/Synced 3 accounts/)).toBeVisible({ timeout: 30_000 });
}

export const GRAPH = "http://127.0.0.1:4011";

export async function fakeObjects(): Promise<{ id: string; type: string; name?: string; status?: string; daily_budget?: string }[]> {
  return (await (await fetch(`${GRAPH}/__fake/state`)).json()).objects;
}
