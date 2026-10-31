import { randomBytes } from "node:crypto";
import { adAccounts, metaAdsets, metaAds, metaCampaigns, metaConnections } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { FAKE_BUSINESS_ID, createFakeGraph } from "@fahd/meta/testing";
import { encryptToken } from "@fahd/shared";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editObject, loadEditable, syncAccountObjects, syncConnectionAssets } from "../src";

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
  const enc = encryptToken("EAAFAKEedit-tests-token-00000000");
  const [conn] = await db.insert(metaConnections).values({ businessId: FAKE_BUSINESS_ID, businessName: "x", tokenCiphertext: enc.ciphertext, tokenIv: enc.iv, tokenLast4: enc.last4 }).returning();
  await syncConnectionAssets(db, conn!.id);
  accountId = (await db.select().from(adAccounts).where(eq(adAccounts.metaId, "act_200000000000001")))[0]!.id;
  await syncAccountObjects(db, accountId);
});
afterAll(() => fake.close());

describe("editObject", () => {
  it("renames a campaign on Meta and in the mirror, logging only what changed", async () => {
    const [c] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.name, "Lumen_US_Scaling"));
    const change = await editObject(db, "campaign", c!.id, { name: "Lumen_US_Scaling_v2" });
    expect(change.before).toEqual({ name: "Lumen_US_Scaling" });
    expect(change.after).toEqual({ name: "Lumen_US_Scaling_v2" });
    expect((await fakeObject(c!.metaId)).name).toBe("Lumen_US_Scaling_v2");
    expect((await db.select().from(metaCampaigns).where(eq(metaCampaigns.id, c!.id)))[0]!.name).toBe("Lumen_US_Scaling_v2");
  });

  it("changes an ad set's countries and ages, keeping the rest of its targeting", async () => {
    const [s] = await db.select().from(metaAdsets).where(eq(metaAdsets.name, "Lumen_US_glow_1"));
    const change = await editObject(db, "adset", s!.id, { countries: ["US", "CA"], ageMin: 25, ageMax: 54, endTime: new Date(Date.now() + 7 * 864e5).toISOString() });
    expect(change.after.targeting).toEqual({ countries: ["US", "CA"], age_min: 25, age_max: 54 });
    const live = await fakeObject(s!.metaId);
    expect(live.targeting).toMatchObject({ geo_locations: { countries: ["US", "CA"] }, age_min: 25, age_max: 54 });
    expect(live.end_time).toBeTruthy();
    const now = await loadEditable(db, "adset", s!.id);
    expect(now).toMatchObject({ countries: ["US", "CA"], ageMin: 25, ageMax: 54 });
  });

  it("sends nothing when nothing changed", async () => {
    const [ad] = await db.select().from(metaAds).where(like(metaAds.name, "hook1%")).limit(1);
    const change = await editObject(db, "ad", ad!.id, { name: ad!.name });
    expect(change.metaResponse).toEqual({ skipped: "no changes" });
  });

  it("refuses an empty name and impossible ages before calling Meta", async () => {
    const [s] = await db.select().from(metaAdsets).where(eq(metaAdsets.name, "Lumen_US_routine_2"));
    await expect(editObject(db, "adset", s!.id, { name: "  " })).rejects.toThrow(/empty/);
    await expect(editObject(db, "adset", s!.id, { ageMin: 50, ageMax: 30 })).rejects.toThrow(/minimum first/);
  });
});
