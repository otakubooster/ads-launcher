import { randomBytes } from "node:crypto";
import { adAccounts, metaConnections } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { MetaApiError } from "@fahd/meta";
import { FAKE_BUSINESS_ID, createFakeGraph } from "@fahd/meta/testing";
import { encryptToken } from "@fahd/shared";
import { syncConnectionAssets } from "@fahd/core";
import { UnrecoverableError } from "bullmq";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backoffDelay, processAccountJob } from "../src/processor";

const fake = createFakeGraph();
let db: Awaited<ReturnType<typeof createTestDb>>;
let accountId: string;
let connectionId: string;

beforeAll(async () => {
  process.env.META_GRAPH_HOST = await fake.listen();
  process.env.META_APP_SECRET = "s";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  db = await createTestDb({ minimal: true });
  const enc = encryptToken("EAAFAKEworker-tests-token-00000");
  [{ id: connectionId }] = (await db
    .insert(metaConnections)
    .values({ businessId: FAKE_BUSINESS_ID, businessName: "x", tokenCiphertext: enc.ciphertext, tokenIv: enc.iv, tokenLast4: enc.last4 })
    .returning({ id: metaConnections.id })) as [{ id: string }];
  await syncConnectionAssets(db, connectionId);
  accountId = (await db.select().from(adAccounts).where(eq(adAccounts.metaId, "act_200000000000002")))[0]!.id;
});
afterAll(() => fake.close());

describe("processAccountJob", () => {
  it("runs object and insight syncs", async () => {
    expect(await processAccountJob(db, { kind: "sync-objects", adAccountId: accountId })).toMatchObject({ campaigns: 2, ads: 12 });
    const today = new Date().toISOString().slice(0, 10);
    expect(await processAccountJob(db, { kind: "sync-insights", adAccountId: accountId, since: today, until: today })).toMatchObject({ rows: expect.any(Number) });
  });

  it("marks the connection broken and stops retrying on a token error", async () => {
    await fetch(`${process.env.META_GRAPH_HOST}/__fake/fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ match: "campaigns$", error: { code: 190, message: "Error validating access token" } }),
    });
    await expect(processAccountJob(db, { kind: "sync-objects", adAccountId: accountId })).rejects.toBeInstanceOf(UnrecoverableError);
    const [conn] = await db.select().from(metaConnections).where(eq(metaConnections.id, connectionId));
    expect(conn!.status).toBe("broken");
  });
});

describe("backoffDelay", () => {
  it("waits as long as Meta asks, otherwise backs off exponentially", () => {
    expect(backoffDelay(1, new MetaApiError({ kind: "rate_limit", message: "x", retryAfterMs: 120_000 }))).toBe(120_000);
    expect(backoffDelay(1, new Error("x"))).toBe(30_000);
    expect(backoffDelay(2, new Error("x"))).toBe(60_000);
    expect(backoffDelay(10, new Error("x"))).toBe(15 * 60_000);
  });
});
