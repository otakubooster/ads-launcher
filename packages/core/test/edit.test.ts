import { randomBytes } from "node:crypto";
import { adAccounts, metaAdsets, metaAds, metaCampaigns, metaConnections } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { FAKE_BUSINESS_ID, createFakeGraph } from "@fahd/meta/testing";
import { encryptToken } from "@fahd/shared";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientForAdAccount, editAdCopy, editObject, loadAdCopy, loadEditable, syncAccountObjects, syncConnectionAssets } from "../src";

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

describe("editAdCopy", () => {
  async function adWithCreative(spec: Record<string, unknown>) {
    const [s] = await db.select().from(metaAdsets).where(eq(metaAdsets.name, "Lumen_US_glow_3"));
    const { client } = await clientForAdAccount(db, accountId);
    const post = (path: string, body: Record<string, unknown>) => client.post<{ id: string }>(path, body as never, { accountId: "act_200000000000001" });
    const creative = await post("act_200000000000001/adcreatives", { name: "copy test", ...spec });
    const ad = await post("act_200000000000001/ads", { name: `copy test ad ${creative.id}`, adset_id: s!.metaId, creative: { creative_id: creative.id }, status: "PAUSED" });
    await syncAccountObjects(db, accountId);
    const [row] = await db.select().from(metaAds).where(eq(metaAds.metaId, ad.id));
    return row!;
  }

  it("reads and replaces a single-image ad's text with a new creative", async () => {
    const ad = await adWithCreative({ object_story_spec: { page_id: "300000000000001", link_data: { image_hash: "abc", link: "https://lumen.example", message: "Old text", name: "Old headline", call_to_action: { type: "SHOP_NOW", value: { link: "https://lumen.example" } } } } });
    const copy = await loadAdCopy(db, ad.id);
    expect(copy).toMatchObject({ format: "single", primaryTexts: ["Old text"], headlines: ["Old headline"], cta: "SHOP_NOW" });
    const change = await editAdCopy(db, ad.id, { ...copy, primaryTexts: ["New text"], cta: "LEARN_MORE" });
    expect(change.creativeId).not.toBe(ad.creativeId);
    const live = await fakeObject(change.creativeId);
    expect(live.object_story_spec).toMatchObject({ link_data: { image_hash: "abc", message: "New text", name: "Old headline", call_to_action: { type: "LEARN_MORE" } } });
    expect((await fakeObject(ad.metaId)).creative).toMatchObject({ id: change.creativeId });
    expect((await loadAdCopy(db, ad.id)).primaryTexts).toEqual(["New text"]);
  });

  it("keeps up to five options on a multi-text ad and refuses posts", async () => {
    const ad = await adWithCreative({ object_story_spec: { page_id: "300000000000001" }, asset_feed_spec: { images: [{ hash: "abc" }], bodies: [{ text: "A" }, { text: "B" }], titles: [{ text: "T" }], link_urls: [{ website_url: "https://lumen.example" }], call_to_action_types: ["SHOP_NOW"], ad_formats: ["SINGLE_IMAGE"] } });
    const copy = await loadAdCopy(db, ad.id);
    expect(copy.format).toBe("multi");
    const change = await editAdCopy(db, ad.id, { ...copy, primaryTexts: ["A", "B", "C"] });
    expect((await fakeObject(change.creativeId)).asset_feed_spec).toMatchObject({ images: [{ hash: "abc" }], bodies: [{ text: "A" }, { text: "B" }, { text: "C" }] });

    const post = await adWithCreative({ object_story_id: "300000000000001_123" });
    expect((await loadAdCopy(db, post.id)).format).toBe("post");
    await expect(editAdCopy(db, post.id, { ...copy })).rejects.toThrow(/existing post/);
  });
});
