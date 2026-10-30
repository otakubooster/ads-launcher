import { randomBytes } from "node:crypto";
import { adAccounts, accountInsightsDaily, insightsDaily, metaAds, metaAdsets, metaCampaigns, metaConnections } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { FAKE_BUSINESS_ID, createFakeGraph } from "@fahd/meta/testing";
import { encryptToken } from "@fahd/shared";
import { count, eq, sum } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backfillInsights, clientForAdAccount, mapInsights, syncAccountObjects, syncConnectionAssets, syncInsights, syncableAccounts } from "../src";

const fake = createFakeGraph();
let db: Awaited<ReturnType<typeof createTestDb>>;
let accountId: string;

beforeAll(async () => {
  process.env.META_GRAPH_HOST = await fake.listen();
  process.env.META_APP_SECRET = "test-secret";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  db = await createTestDb({ minimal: true });
  const enc = encryptToken("EAAFAKEsync-tests-token-000000");
  const [conn] = await db
    .insert(metaConnections)
    .values({ businessId: FAKE_BUSINESS_ID, businessName: "x", tokenCiphertext: enc.ciphertext, tokenIv: enc.iv, tokenLast4: enc.last4 })
    .returning({ id: metaConnections.id });
  await syncConnectionAssets(db, conn!.id);
  accountId = (await db.select().from(adAccounts).where(eq(adAccounts.metaId, "act_200000000000001")))[0]!.id;
});
afterAll(() => fake.close());

const n = async (table: typeof metaCampaigns | typeof metaAdsets | typeof metaAds | typeof insightsDaily) =>
  (await db.select({ n: count() }).from(table))[0]!.n;

describe("syncAccountObjects", () => {
  it("mirrors campaigns, ad sets and ads with parents and budgets", async () => {
    expect(await syncAccountObjects(db, accountId)).toEqual({ campaigns: 2, adsets: 4, ads: 12, removed: 0 });
    const [scaling] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.name, "Lumen_US_Scaling"));
    expect(scaling!.dailyBudget).toBe(40000);
    const ads = await db.select().from(metaAds).where(eq(metaAds.campaignId, scaling!.id));
    expect(ads).toHaveLength(6);
    expect(ads.every((a) => a.thumbnailUrl?.startsWith("data:image/svg+xml"))).toBe(true);
  });

  it("is idempotent and marks objects Meta stopped listing as deleted", async () => {
    const [ad] = await db.select().from(metaAds).limit(1);
    const { client } = await clientForAdAccount(db, accountId);
    await client.delete(ad!.metaId);
    expect(await syncAccountObjects(db, accountId)).toMatchObject({ ads: 11, removed: 1 });
    expect(await n(metaAds)).toBe(12);
    const [after] = await db.select().from(metaAds).where(eq(metaAds.id, ad!.id));
    expect(after!.status).toBe("DELETED");
  });
});

describe("insights", () => {
  it("syncs today's rows for delivering ads", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const stored = await syncInsights(db, accountId, { since: today, until: today });
    expect(stored).toBeGreaterThan(0);
    expect(await n(insightsDaily)).toBe(stored);
  });

  it("backfills 28 days through an async report run", async () => {
    const before = await n(insightsDaily);
    const stored = await backfillInsights(db, accountId, { since: "2026-10-01", until: "2026-10-28" }, { sleep: async () => {} });
    expect(stored).toBeGreaterThan(28);
    expect(await n(insightsDaily)).toBe(before + stored);
    const [total] = await db.select({ spend: sum(accountInsightsDaily.spend).mapWith(Number) }).from(accountInsightsDaily);
    expect(total!.spend).toBeGreaterThan(0);
  });

  it("lists only accounts with a working connection", async () => {
    expect((await syncableAccounts(db)).map((a) => a.metaId).sort()).toEqual([
      "act_200000000000001",
      "act_200000000000002",
      "act_200000000000003",
    ]);
  });
});

describe("mapInsights", () => {
  it("follows the spec's metric definitions", () => {
    const [row] = mapInsights(
      [
        {
          ad_id: "9",
          date_start: "2026-10-29",
          spend: "123.45",
          impressions: "10000",
          inline_link_clicks: "150",
          actions: [
            { action_type: "purchase", value: "4" },
            { action_type: "video_view", value: "3100" },
            { action_type: "link_click", value: "180" },
          ],
          action_values: [{ action_type: "purchase", value: "260.00" }],
          video_thruplay_watched_actions: [{ action_type: "video_view", value: "900" }],
        },
        { ad_id: "unknown", date_start: "2026-10-29" },
      ],
      new Map([["9", "ad-uuid"]]),
      "USD",
    ) as [ReturnType<typeof mapInsights>[number]];
    expect(row).toEqual({
      adId: "ad-uuid",
      date: "2026-10-29",
      spend: 12345,
      impressions: 10000,
      clicks: 150,
      purchases: 4,
      purchaseValue: 26000,
      video3sPlays: 3100,
      thruplays: 900,
      addToCart: 0,
      checkouts: 0,
      results: 4,
      actions: { purchase: 4, video_view: 3100, link_click: 180 },
    });
    expect(mapInsights([{ ad_id: "9", date_start: "2026-10-29", spend: "1500" }], new Map([["9", "x"]]), "JPY")[0]!.spend).toBe(1500);
  });
});
