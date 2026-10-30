import { expect, test } from "@playwright/test";
import { ensureConnected, signIn } from "./helpers";

test("the scheduled sync link needs its key and syncs every account", async ({ page, request }) => {
  await signIn(page, "Fahd");
  await ensureConnected(page);
  expect((await request.get("/api/cron/sync")).status()).toBe(401);
  expect((await request.get("/api/cron/sync?key=wrong-key-0000000000000")).status()).toBe(401);
  const quick = await request.get("/api/cron/sync?key=e2e-cron-secret-0000000000");
  expect(quick.status()).toBe(200);
  expect(await quick.json()).toMatchObject({ mode: "quick", accounts: 3, failed: [] });
  const daily = await request.get("/api/cron/sync?mode=daily", { headers: { authorization: "Bearer e2e-cron-secret-0000000000" } });
  expect(await daily.json()).toMatchObject({ mode: "daily", accounts: 3, assets: 1 });
});
