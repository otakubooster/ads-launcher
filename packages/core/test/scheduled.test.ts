import { randomBytes } from "node:crypto";
import { metaCampaigns, metaConnections, users } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { FAKE_BUSINESS_ID, createFakeGraph } from "@fahd/meta/testing";
import { encryptToken } from "@fahd/shared";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scheduledSync, setKillSwitch } from "../src";

const fake = createFakeGraph();
let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  process.env.META_GRAPH_HOST = await fake.listen();
  process.env.META_APP_SECRET = "test-secret";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  db = await createTestDb({ minimal: true });
  const enc = encryptToken("EAAFAKEscheduled-tests-token-00");
  await db.insert(metaConnections).values({ businessId: FAKE_BUSINESS_ID, businessName: "x", tokenCiphertext: enc.ciphertext, tokenIv: enc.iv, tokenLast4: enc.last4 });
});
afterAll(() => fake.close());

describe("scheduledSync", () => {
  it("daily run syncs assets, then objects and insights for every account", async () => {
    const result = await scheduledSync(db, "daily");
    expect(result).toEqual({ accounts: 3, failed: [], assets: 1 });
    expect((await db.select({ n: count() }).from(metaCampaigns))[0]!.n).toBe(6);
  });

  it("quick run refreshes accounts already known", async () => {
    expect(await scheduledSync(db, "quick")).toEqual({ accounts: 3, failed: [] });
  });

  it("does nothing while the kill switch is on", async () => {
    const [owner] = await db.select().from(users).where(eq(users.role, "owner"));
    await setKillSwitch(db, true, owner!.id);
    expect(await scheduledSync(db)).toEqual({ skipped: "kill switch on", accounts: 0, failed: [] });
    await setKillSwitch(db, false, owner!.id);
  });
});

describe("fetchReach", () => {
  it("asks Meta for unique reach per campaign and for the whole account", async () => {
    const { adAccounts } = await import("@fahd/db/schema");
    const { fetchReach } = await import("../src");
    const [account] = await db.select().from(adAccounts).where(eq(adAccounts.metaId, "act_200000000000001"));
    const today = new Date().toISOString().slice(0, 10);
    const byCampaign = await fetchReach(db, account!.id, "campaign", { since: today, until: today });
    const total = await fetchReach(db, account!.id, "account", { since: today, until: today });
    expect(Object.keys(byCampaign).length).toBeGreaterThan(0);
    expect(Object.values(byCampaign).every((n) => n > 0)).toBe(true);
    expect(total["act_200000000000001"]).toBeGreaterThan(0);
  });
});

describe("backfill", () => {
  it("re-pulls the last 30 days with the new metrics", async () => {
    const { insightsDaily } = await import("@fahd/db/schema");
    const { sql } = await import("drizzle-orm");
    const result = await scheduledSync(db, "backfill", 30);
    expect(result).toMatchObject({ accounts: 3, failed: [], days: 30 });
    const [row] = await db.select({ days: sql<number>`count(distinct ${insightsDaily.date})::int`, carts: sql<number>`sum(${insightsDaily.addToCart})::int`, results: sql<number>`sum(${insightsDaily.results})::int` }).from(insightsDaily);
    expect(row!.days).toBe(30);
    expect(row!.carts).toBeGreaterThan(0);
    expect(row!.results).toBeGreaterThan(0);
  });
});
