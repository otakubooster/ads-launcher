import { randomBytes } from "node:crypto";
import { adAccounts, metaAdsets, metaAds, metaCampaigns, metaConnections } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { FAKE_BUSINESS_ID, createFakeGraph } from "@fahd/meta/testing";
import { encryptToken } from "@fahd/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteMetaObject, syncAccountObjects, syncConnectionAssets } from "../src";

const fake = createFakeGraph();
let db: Awaited<ReturnType<typeof createTestDb>>;
let accountId: string;
let graph: string;

const fakeObject = async (id: string) => (((await (await fetch(`${graph}/__fake/state`)).json()) as { objects: Record<string, unknown>[] }).objects).find((o) => o.id === id)!;

beforeAll(async () => {
  graph = await fake.listen();
  process.env.META_GRAPH_HOST = graph;
  process.env.META_APP_SECRET = "s";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  db = await createTestDb({ minimal: true });
  const enc = encryptToken("EAAFAKEdelete-tests-token-000000");
  const [conn] = await db.insert(metaConnections).values({ businessId: FAKE_BUSINESS_ID, businessName: "x", tokenCiphertext: enc.ciphertext, tokenIv: enc.iv, tokenLast4: enc.last4 }).returning();
  await syncConnectionAssets(db, conn!.id);
  accountId = (await db.select().from(adAccounts).where(eq(adAccounts.metaId, "act_200000000000001")))[0]!.id;
  await syncAccountObjects(db, accountId);
});
afterAll(() => fake.close());


describe("deleteMetaObject", () => {
  it("deletes a campaign on Meta with its ad sets and ads, and hides them from the mirror", async () => {
    const [c] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.name, "Lumen_US_Scaling"));
    const change = await deleteMetaObject(db, "campaign", c!.id);
    expect(change.after).toEqual({ status: "DELETED" });
    expect((await fakeObject(c!.metaId)).status).toBe("DELETED");
    const sets = await db.select().from(metaAdsets).where(eq(metaAdsets.campaignId, c!.id));
    const ads = await db.select().from(metaAds).where(eq(metaAds.campaignId, c!.id));
    expect(sets.length).toBeGreaterThan(0);
    expect([...sets, ...ads].every((o) => o.status === "DELETED")).toBe(true);
    // A sync afterwards keeps them deleted.
    await syncAccountObjects(db, accountId);
    expect((await db.select().from(metaCampaigns).where(eq(metaCampaigns.id, c!.id)))[0]!.status).toBe("DELETED");
  });

  it("deletes a single ad and leaves its ad set alone", async () => {
    const [s] = await db.select().from(metaAdsets).where(eq(metaAdsets.name, "Lumen_US_glow_1"));
    const [ad] = await db.select().from(metaAds).where(eq(metaAds.adsetId, s!.id)).limit(1);
    await deleteMetaObject(db, "ad", ad!.id);
    expect((await fakeObject(ad!.metaId)).status).toBe("DELETED");
    expect((await db.select().from(metaAdsets).where(eq(metaAdsets.id, s!.id)))[0]!.status).not.toBe("DELETED");
  });
});
