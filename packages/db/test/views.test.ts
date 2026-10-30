import { and, count, eq, sql, sum } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { SEED_DAYS, SEED_USERS, seed } from "../src/seed";
import { asUser, createTestDb, TODAY, type TestDb } from "./helpers";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

describe("seed", () => {
  it("creates the expected shape", async () => {
    const counts = async (table: Parameters<TestDb["select"]>[0] extends never ? never : any) =>
      (await db.select({ n: count() }).from(table))[0]!.n;
    expect(await counts(s.users)).toBe(4);
    expect(await counts(s.adAccounts)).toBe(3);
    expect(await counts(s.presets)).toBe(3);
    expect(await counts(s.metaCampaigns)).toBe(6);
    expect(await counts(s.metaAdsets)).toBe(12);
    expect(await counts(s.metaAds)).toBe(36);
  });

  it("ends insights yesterday and spans 28 days", async () => {
    const [range] = await db.execute<{ min: string; max: string; days: number }>(sql`
      select min(date)::text as min, max(date)::text as max, count(distinct date)::int as days from insights_daily`).then((r) => r.rows);
    expect(range).toEqual({ min: "2026-10-02", max: "2026-10-29", days: SEED_DAYS });
  });

  it("refuses to run twice", async () => {
    await expect(seed(db, { today: TODAY })).rejects.toThrow(/empty database/);
  });
});

describe("metric views", () => {
  it("compute ad-level ratios from the raw counts", async () => {
    const [row] = await db.select().from(s.adInsightsDaily).where(sql`purchases > 0`).limit(1);
    expect(row).toBeDefined();
    const r = row!;
    expect(r.cpa).toBeCloseTo(r.spend / r.purchases, 6);
    expect(r.roas).toBeCloseTo(r.purchaseValue / r.spend, 6);
    expect(r.ctr).toBeCloseTo(r.clicks / r.impressions, 6);
    expect(r.cpm).toBeCloseTo((r.spend * 1000) / r.impressions, 6);
    expect(r.hookRate).toBeCloseTo(r.video3sPlays / r.impressions, 6);
    expect(r.holdRate).toBeCloseTo(r.thruplays / r.impressions, 6);
  });

  it("sum before dividing at the account level", async () => {
    const [view] = await db
      .select()
      .from(s.accountInsightsDaily)
      .where(eq(s.accountInsightsDaily.date, "2026-10-20"))
      .limit(1);
    const [raw] = await db
      .select({ spend: sum(s.insightsDaily.spend).mapWith(Number), value: sum(s.insightsDaily.purchaseValue).mapWith(Number) })
      .from(s.insightsDaily)
      .innerJoin(s.metaAds, eq(s.metaAds.id, s.insightsDaily.adId))
      .where(and(eq(s.metaAds.adAccountId, view!.adAccountId), eq(s.insightsDaily.date, "2026-10-20")));
    expect(view!.spend).toBe(raw!.spend);
    expect(view!.roas).toBeCloseTo(raw!.value / raw!.spend, 6);
  });

  it("roll ads up consistently through ad sets and campaigns", async () => {
    const total = async (view: typeof s.adsetInsightsDaily | typeof s.campaignInsightsDaily | typeof s.accountInsightsDaily) =>
      (await db.select({ spend: sum(view.spend).mapWith(Number) }).from(view))[0]!.spend;
    const adsTotal = (await db.select({ spend: sum(s.insightsDaily.spend).mapWith(Number) }).from(s.insightsDaily))[0]!.spend;
    expect(await total(s.adsetInsightsDaily)).toBe(adsTotal);
    expect(await total(s.campaignInsightsDaily)).toBe(adsTotal);
    expect(await total(s.accountInsightsDaily)).toBe(adsTotal);
  });

  it("return null instead of dividing by zero", async () => {
    const [r] = await db.execute<{ v: string | null }>(sql`select app.safe_div(5, 0) as v`).then((x) => x.rows);
    expect(r!.v).toBeNull();
  });

  it("respect RLS for members reading them", async () => {
    const r = await asUser(db, SEED_USERS.viewer.id, (tx) => tx.select({ n: count() }).from(s.accountInsightsDaily));
    expect(r.ok && r.value[0]!.n).toBeGreaterThan(0);
  });
});
