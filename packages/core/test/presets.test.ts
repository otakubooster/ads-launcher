import { randomBytes } from "node:crypto";
import { adAccounts, brands, metaAdsets, metaConnections, presets } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { FAKE_BUSINESS_ID, createFakeGraph } from "@fahd/meta/testing";
import { encryptToken } from "@fahd/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloneAdsetTemplate, syncAccountObjects, syncConnectionAssets, testPreset } from "../src";

const fake = createFakeGraph();
let db: Awaited<ReturnType<typeof createTestDb>>;
let accountId: string;
let presetId: string;

beforeAll(async () => {
  process.env.META_GRAPH_HOST = await fake.listen();
  process.env.META_APP_SECRET = "s";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  db = await createTestDb({ minimal: true });
  const enc = encryptToken("EAAFAKEpreset-tests-token-00000");
  const [conn] = await db
    .insert(metaConnections)
    .values({ businessId: FAKE_BUSINESS_ID, businessName: "x", tokenCiphertext: enc.ciphertext, tokenIv: enc.iv, tokenLast4: enc.last4 })
    .returning({ id: metaConnections.id });
  await syncConnectionAssets(db, conn!.id);
  const [acc] = await db.update(adAccounts).set({ launchEnabled: true }).where(eq(adAccounts.metaId, "act_200000000000001")).returning();
  accountId = acc!.id;
  const [brand] = await db.select().from(brands).limit(1);
  const [p] = await db
    .insert(presets)
    .values({ brandId: brand!.id, market: "US", language: "en", adAccountId: accountId, pageId: "300000000000001", instagramUserId: "400000000000001", pixelId: "500000000000001", linkUrl: "https://lumen.example/us" })
    .returning();
  presetId = p!.id;
});
afterAll(() => fake.close());

describe("testPreset", () => {
  it("passes every line for a correct preset (week 3 check)", async () => {
    const lines = await testPreset(db, presetId, { checkLink: false });
    expect(lines.map((l) => [l.label, l.ok])).toEqual([
      ["Token permissions", true],
      ["Ad account", true],
      ["Launch access", true],
      ["Facebook page", true],
      ["Instagram account", true],
      ["Pixel", true],
    ]);
  });

  it("names what's wrong", async () => {
    await db.update(presets).set({ pixelId: "500000000000002" }).where(eq(presets.id, presetId));
    await db.update(adAccounts).set({ launchEnabled: false }).where(eq(adAccounts.id, accountId));
    const lines = await testPreset(db, presetId, { checkLink: false });
    expect(lines.find((l) => l.label === "Pixel")).toMatchObject({ ok: false, detail: expect.stringContaining("isn't shared with Lumen US") });
    expect(lines.find((l) => l.label === "Launch access")).toMatchObject({ ok: false });
  });
});

describe("cloneAdsetTemplate", () => {
  it("saves a live ad set's settings", async () => {
    await syncAccountObjects(db, accountId);
    const [adset] = await db.select().from(metaAdsets).where(eq(metaAdsets.adAccountId, accountId)).limit(1);
    const t = await cloneAdsetTemplate(db, adset!.id, "Broad US");
    expect(t).toMatchObject({ name: "Broad US", sourceAdsetId: adset!.metaId });
    expect(t.spec).toMatchObject({ optimizationGoal: "OFFSITE_CONVERSIONS", billingEvent: "IMPRESSIONS", targeting: { geo_locations: { countries: ["US"] } } });
  });
});
