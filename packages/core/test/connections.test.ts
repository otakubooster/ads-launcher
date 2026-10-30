import { randomBytes } from "node:crypto";
import { adAccounts, apiUsage, metaAssets, metaConnections } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { FAKE_BUSINESS_ID, createFakeGraph } from "@fahd/meta/testing";
import { encryptToken } from "@fahd/shared";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkToken, syncConnectionAssets } from "../src";

const fake = createFakeGraph();
const TOKEN = "EAAFAKEsystemusertoken-for-core-tests";
let db: Awaited<ReturnType<typeof createTestDb>>;
let connectionId: string;

beforeAll(async () => {
  process.env.META_GRAPH_HOST = await fake.listen();
  process.env.META_APP_SECRET = "test-secret";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  db = await createTestDb({ minimal: true });
  const enc = encryptToken(TOKEN);
  [{ id: connectionId }] = (await db
    .insert(metaConnections)
    .values({ businessId: FAKE_BUSINESS_ID, businessName: "x", tokenCiphertext: enc.ciphertext, tokenIv: enc.iv, tokenLast4: enc.last4 })
    .returning({ id: metaConnections.id })) as [{ id: string }];
});
afterAll(() => fake.close());

describe("checkToken", () => {
  it("names the business and finds no missing permissions on the fake", async () => {
    expect(await checkToken(TOKEN, FAKE_BUSINESS_ID)).toMatchObject({ businessName: "Fahd Holdings (fake)", missing: [] });
  });
});

describe("syncConnectionAssets", () => {
  it("stores ad accounts, pages, Instagram accounts and pixels (week 1 check)", async () => {
    expect(await syncConnectionAssets(db, connectionId)).toEqual({ adAccounts: 3, pages: 3, instagram: 3, pixels: 3 });
    expect((await db.select({ n: count() }).from(metaAssets))[0]!.n).toBe(9);
    expect((await db.select({ n: count() }).from(apiUsage))[0]!.n).toBeGreaterThan(0);
  });

  it("is idempotent and keeps guardrails the user set", async () => {
    await db.update(adAccounts).set({ maxDailyBudget: 123_00 }).where(eq(adAccounts.metaId, "act_200000000000001"));
    await syncConnectionAssets(db, connectionId);
    expect((await db.select({ n: count() }).from(adAccounts))[0]!.n).toBe(3);
    expect((await db.select({ n: count() }).from(metaAssets))[0]!.n).toBe(9);
    const [acc] = await db.select().from(adAccounts).where(eq(adAccounts.metaId, "act_200000000000001"));
    expect(acc!.maxDailyBudget).toBe(123_00);
  });
});
