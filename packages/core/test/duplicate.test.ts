import { randomBytes } from "node:crypto";
import { adAccounts, metaAdsets, metaAds, metaCampaigns, metaConnections } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { FAKE_BUSINESS_ID, createFakeGraph } from "@fahd/meta/testing";
import { encryptToken } from "@fahd/shared";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { duplicateObject, syncAccountObjects, syncConnectionAssets } from "../src";

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

  it("refuses a destination in another ad account", async () => {
    const [set] = await db.select().from(metaAdsets).where(eq(metaAdsets.name, "Lumen_US_glow_1"));
    const other = await db.select().from(adAccounts).where(eq(adAccounts.metaId, "act_200000000000002"));
    await syncAccountObjects(db, other[0]!.id);
    const [foreign] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.adAccountId, other[0]!.id)).limit(1);
    await expect(duplicateObject(db, { level: "adset", id: set!.id, copies: 1, destinationId: foreign!.id })).rejects.toThrow(/same ad account/);
  });
});
