import { randomBytes } from "node:crypto";
import { adAccounts, metaAdsets, metaAds, metaCampaigns, metaConnections } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { FAKE_BUSINESS_ID, createFakeGraph } from "@fahd/meta/testing";
import { encryptToken } from "@fahd/shared";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientForAdAccount, createDuplicateParent, duplicateObject, syncAccountObjects, syncConnectionAssets } from "../src";

const fake = createFakeGraph();
let db: Awaited<ReturnType<typeof createTestDb>>;
let accountId: string;

beforeAll(async () => {
  process.env.META_GRAPH_HOST = await fake.listen();
  process.env.META_APP_SECRET = "s";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  db = await createTestDb({ minimal: true });
  const enc = encryptToken("EAAFAKEduplicate-tests-token-000");
  const [conn] = await db.insert(metaConnections).values({ businessId: FAKE_BUSINESS_ID, businessName: "x", tokenCiphertext: enc.ciphertext, tokenIv: enc.iv, tokenLast4: enc.last4 }).returning();
  await syncConnectionAssets(db, conn!.id);
  accountId = (await db.select().from(adAccounts).where(eq(adAccounts.metaId, "act_200000000000001")))[0]!.id;
  await syncAccountObjects(db, accountId);
});
afterAll(() => fake.close());

describe("duplicateObject", () => {
  it("copies an ad set with its ads, paused, into the original campaign", async () => {
    const [set] = await db.select().from(metaAdsets).where(eq(metaAdsets.name, "Lumen_US_glow_1"));
    const result = await duplicateObject(db, { level: "adset", id: set!.id, copies: 2 });
    expect(result.copies).toHaveLength(2);
    const copies = await db.select().from(metaAdsets).where(eq(metaAdsets.name, "Lumen_US_glow_1 - Copy"));
    expect(copies).toHaveLength(2);
    expect(copies.every((c) => c.status === "PAUSED" && c.campaignId === set!.campaignId)).toBe(true);
    const ads = await db.select().from(metaAds).where(eq(metaAds.adsetId, copies[0]!.id));
    expect(ads).toHaveLength(3);
  });

  it("copies an ad into another ad set of the same account", async () => {
    const [ad] = await db.select().from(metaAds).where(like(metaAds.name, "hook1%")).limit(1);
    const [target] = await db.select().from(metaAdsets).where(eq(metaAdsets.name, "Lumen_US_routine_4"));
    await duplicateObject(db, { level: "ad", id: ad!.id, copies: 1, destinationId: target!.id });
    const moved = await db.select().from(metaAds).where(and(eq(metaAds.adsetId, target!.id), eq(metaAds.name, `${ad!.name} - Copy`)));
    expect(moved).toHaveLength(1);
    expect(moved[0]!.status).toBe("PAUSED");
  });

  it("copies a campaign with everything in it", async () => {
    const [campaign] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.name, "Lumen_US_Prospecting"));
    await duplicateObject(db, { level: "campaign", id: campaign!.id, copies: 1 });
    const [copy] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.name, "Lumen_US_Prospecting - Copy"));
    expect(copy!.status).toBe("PAUSED");
    expect((await db.select().from(metaAdsets).where(eq(metaAdsets.campaignId, copy!.id))).length).toBeGreaterThan(0);
  });

  it("duplicates ad sets into a new campaign with the original's settings", async () => {
    const [set] = await db.select().from(metaAdsets).where(eq(metaAdsets.name, "Lumen_US_routine_2"));
    const [original] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.id, set!.campaignId));
    const parent = await createDuplicateParent(db, { level: "adset", sourceId: set!.id, name: "Lumen US Test Campaign" });
    const [created] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.id, parent.id));
    expect(created).toMatchObject({ name: "Lumen US Test Campaign", status: "PAUSED", objective: original!.objective, dailyBudget: original!.dailyBudget });
    // Empty until the copies go in.
    expect(await db.select().from(metaAdsets).where(eq(metaAdsets.campaignId, parent.id))).toHaveLength(0);
    await duplicateObject(db, { level: "adset", id: set!.id, copies: 1, destinationId: parent.id });
    const inside = await db.select().from(metaAdsets).where(eq(metaAdsets.campaignId, parent.id));
    expect(inside.map((s) => [s.name, s.status])).toEqual([["Lumen_US_routine_2 - Copy", "PAUSED"]]);
    expect((await db.select().from(metaAds).where(eq(metaAds.adsetId, inside[0]!.id))).length).toBeGreaterThan(0);
  });

  it("duplicates ads into a new ad set in the same campaign", async () => {
    const [ad] = await db.select().from(metaAds).where(like(metaAds.name, "hook3%")).limit(1);
    const parent = await createDuplicateParent(db, { level: "ad", sourceId: ad!.id, name: "New test ad set" });
    const [set] = await db.select().from(metaAdsets).where(eq(metaAdsets.id, parent.id));
    expect(set).toMatchObject({ name: "New test ad set", status: "PAUSED", campaignId: ad!.campaignId });
    await duplicateObject(db, { level: "ad", id: ad!.id, copies: 2, destinationId: parent.id });
    expect(await db.select().from(metaAds).where(eq(metaAds.adsetId, parent.id))).toHaveLength(2);
  });

  it("copies an ad set with 60 ads, past Meta's 3-objects-per-copy limit", async () => {
    const [set] = await db.select().from(metaAdsets).where(eq(metaAdsets.name, "Lumen_US_glow_3"));
    const { client } = await clientForAdAccount(db, accountId);
    const opts = { accountId: "act_200000000000001" };
    const creative = await client.post<{ id: string }>("act_200000000000001/adcreatives", { name: "bulk", object_story_spec: { page_id: "300000000000001" } }, opts);
    for (let i = 0; i < 57; i++) await client.post("act_200000000000001/ads", { name: `bulk ad ${i}`, adset_id: set!.metaId, creative: { creative_id: creative.id }, status: "PAUSED" }, opts);
    await syncAccountObjects(db, accountId);
    const live = await db.select().from(metaAds).where(eq(metaAds.adsetId, set!.id));
    expect(live.length).toBe(60);

    await duplicateObject(db, { level: "adset", id: set!.id, copies: 1 });
    const [copy] = await db.select().from(metaAdsets).where(eq(metaAdsets.name, "Lumen_US_glow_3 - Copy"));
    const copied = await db.select().from(metaAds).where(eq(metaAds.adsetId, copy!.id));
    expect(copied).toHaveLength(60);
    expect(copied.every((a) => a.status === "PAUSED")).toBe(true);
    // Only the ad set gets " - Copy"; its ads keep their names.
    expect(copied.some((a) => a.name === "bulk ad 0")).toBe(true);
  }, 60_000);

  it("refuses a destination in another ad account", async () => {
    const [set] = await db.select().from(metaAdsets).where(eq(metaAdsets.name, "Lumen_US_glow_1"));
    const other = await db.select().from(adAccounts).where(eq(adAccounts.metaId, "act_200000000000002"));
    await syncAccountObjects(db, other[0]!.id);
    const [foreign] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.adAccountId, other[0]!.id)).limit(1);
    await expect(duplicateObject(db, { level: "adset", id: set!.id, copies: 1, destinationId: foreign!.id })).rejects.toThrow(/same ad account/);
  });
});
