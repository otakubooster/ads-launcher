import { expect, type Page } from "@playwright/test";

export const FAKE_BUSINESS_ID = "100000000000001";
export const FAKE_TOKEN = "EAAFAKEsystemusertoken-e2e-000001";

export async function signIn(page: Page, name: "Fahd" | "Sara Admin" | "Omar Buyer" | "Lina Viewer") {
  await page.context().clearCookies();
  // The first sign-in after a code change can land while next dev is still compiling the
  // server action and bounce back to /login; try again rather than hang.
  for (let attempt = 1; ; attempt++) {
    await page.goto("/login");
    await page.getByRole("button", { name: new RegExp(name) }).click();
    try {
      await page.waitForURL("**/dashboard", { timeout: attempt < 3 ? 20_000 : 60_000 });
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
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

/** A real PNG drawn on a canvas in the browser. */
export async function makeImage(page: Page, width: number, height: number, label: string) {
  const dataUrl = await page.evaluate(
    async ([w, h, text]) => {
      const canvas = new OffscreenCanvas(w as number, h as number);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#5b5bd6";
      ctx.fillRect(0, 0, w as number, h as number);
      ctx.fillStyle = "#fff";
      ctx.font = "120px sans-serif";
      ctx.fillText(String(text), 80, 300);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      return await new Promise<string>((r) => {
        const fr = new FileReader();
        fr.onload = () => r(String(fr.result));
        fr.readAsDataURL(blob);
      });
    },
    [width, height, label] as const,
  );
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}
