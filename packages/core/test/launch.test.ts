import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { adAccounts, brands, creatives, launchItems, launches, metaConnections, presets, users } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { FAKE_BUSINESS_ID, createFakeGraph } from "@fahd/meta/testing";
import { encryptToken } from "@fahd/shared";
import { EMPTY_DRAFT, buildPlan, type LaunchDraft } from "@fahd/shared/launch-plan";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLaunchItems, resetFailedItems, runLaunch, storageFromEnv, syncConnectionAssets } from "../src";

const fake = createFakeGraph();
let db: Awaited<ReturnType<typeof createTestDb>>;
let presetId: string;
let ownerId: string;
const ANGLES = ["glow", "routine", "results", "gift"];
const HOOKS = ["h1", "h2", "h3", "h4", "h5"];
const ctxCreatives: Record<string, { ratio: string | null; kind: "image" | "video"; fileName: string }> = {};
let groups: LaunchDraft["creatives"]["groups"] = [];
let n = 0;
// The spec's 2 writes/s per account would make 40 video uploads take a minute; tests skip the waits.
let fast: { client: import("@fahd/meta").MetaClient; upload: { pollMs: number; sleep: () => Promise<void>; client: import("@fahd/meta").MetaClient } };

async function addVideo(brandId: string, fileName: string, ratio: "9:16" | "4:5") {
  const storagePath = `creatives/${brandId}/${randomBytes(6).toString("hex")}/${fileName}`;
  const full = path.join(process.env.STORAGE_DIR!, storagePath);
  await mkdir(path.dirname(full), { recursive: true });
  const bytes = randomBytes(2048);
  await writeFile(full, bytes);
  const [row] = await db
    .insert(creatives)
    .values({ brandId, fileName, storagePath, kind: "video", width: 1080, height: ratio === "9:16" ? 1920 : 1350, ratio, durationS: 15, sizeBytes: bytes.length, sha256: randomBytes(32).toString("hex"), groupKey: fileName.split("_")[0]! })
    .returning();
  ctxCreatives[row!.id] = { ratio, kind: "video", fileName };
  return row!.id;
}

async function newLaunch(draft: LaunchDraft) {
  const plan = buildPlan(draft, { brand: "Lumen", market: "US", date: `2026-10-${String(++n).padStart(2, "0")}`, currency: "USD", creatives: ctxCreatives });
  const [launch] = await db.insert(launches).values({ name: "test", presetId, createdBy: ownerId, mode: "new_campaign", structure: draft, status: "queued" }).returning();
  await createLaunchItems(db, launch!.id, plan);
  return { launchId: launch!.id, plan };
}

const objects = (type: string) => [...fake.objects.values()].filter((o) => o.type === type);

beforeAll(async () => {
  process.env.META_GRAPH_HOST = await fake.listen();
  process.env.META_APP_SECRET = "s";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "fahd-launch-"));
  const { createMetaClient, Throttle } = await import("@fahd/meta");
  const client = createMetaClient({ accessToken: "EAAFAKElaunch-tests-token-00000", appSecret: "s", throttle: new Throttle({ sleep: async () => {} }) });
  fast = { client, upload: { pollMs: 1, sleep: async () => {}, client } };
  db = await createTestDb({ minimal: true });
  const enc = encryptToken("EAAFAKElaunch-tests-token-00000");
  const [conn] = await db.insert(metaConnections).values({ businessId: FAKE_BUSINESS_ID, businessName: "x", tokenCiphertext: enc.ciphertext, tokenIv: enc.iv, tokenLast4: enc.last4 }).returning({ id: metaConnections.id });
  await syncConnectionAssets(db, conn!.id);
  const [acc] = await db.update(adAccounts).set({ launchEnabled: true }).where(eq(adAccounts.metaId, "act_200000000000001")).returning();
  const [brand] = await db.select().from(brands).where(eq(brands.name, "Lumen"));
  ownerId = (await db.select().from(users).where(eq(users.role, "owner")))[0]!.id;
  const [p] = await db
    .insert(presets)
    .values({ brandId: brand!.id, market: "US", language: "en", adAccountId: acc!.id, pageId: "300000000000001", instagramUserId: "400000000000001", pixelId: "500000000000001", linkUrl: "https://lumen.example/us", urlTags: "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}", creativeFeatures: {} })
    .returning();
  presetId = p!.id;
  for (const angle of ANGLES) {
    for (const hook of HOOKS) {
      const key = `${angle}-${hook}`;
      groups.push({ key, creativeIds: [await addVideo(brand!.id, `${key}_9x16.mp4`, "9:16"), await addVideo(brand!.id, `${key}_4x5.mp4`, "4:5")], angle, hook, format: "ugc" });
    }
  }
});
afterAll(() => fake.close());
beforeEach(() => {
  groups = groups.slice();
});

function draft(): LaunchDraft {
  return {
    ...EMPTY_DRAFT,
    destination: { mode: "new_campaign", budgetType: "adset", dailyBudget: 5000, countries: ["US"] },
    creatives: { groups },
    copy: { primaryTexts: ["Wake up glowing."], headlines: ["Glow serum"], descriptions: [], cta: "SHOP_NOW", link: "https://lumen.example/us", overrides: {} },
    structure: { ...EMPTY_DRAFT.structure, features: { image_touchups: "OPT_IN", text_optimizations: "OPT_OUT" } },
  };
}

describe("runLaunch", () => {
  it("creates 20 ads across 4 ad sets, all paused, with names, placement mapping and UTMs (week 3 check)", async () => {
    const before = { campaigns: objects("campaign").length, adsets: objects("adset").length, ads: objects("ad").length };
    const { launchId, plan } = await newLaunch(draft());
    const result = await runLaunch(db, storageFromEnv(), launchId, fast);
    expect(result).toEqual({ status: "done", created: 45, failed: 0 });

    const campaign = objects("campaign").at(-1)!;
    expect(campaign).toMatchObject({ name: plan.campaign.name, status: "PAUSED", objective: "OUTCOME_SALES" });
    const adsets = objects("adset").slice(before.adsets);
    expect(adsets.map((a) => [a.name, a.status, a.daily_budget])).toEqual(plan.adsets.map((a) => [a.name, "PAUSED", 5000]));
    expect(adsets[0]).toMatchObject({ promoted_object: { pixel_id: "500000000000001", custom_event_type: "PURCHASE" }, targeting: { geo_locations: { countries: ["US"] }, targeting_automation: { advantage_audience: 1 } } });
    const ads = objects("ad").slice(before.ads);
    expect(ads).toHaveLength(20);
    expect(ads.every((a) => a.status === "PAUSED")).toBe(true);
    expect(ads.map((a) => a.name)).toEqual(plan.adsets.flatMap((a) => a.ads.map((ad) => ad.name)));

    const creative = objects("adcreative").at(-1)!;
    expect(creative.url_tags).toBe("utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}");
    const feed = creative.asset_feed_spec as { videos: { adlabels: { name: string }[] }[]; asset_customization_rules: { customization_spec: { instagram_positions: string[] }; video_label: { name: string } }[] };
    expect(feed.videos.map((v) => v.adlabels[0]!.name)).toEqual(["r916", "r45"]);
    expect(feed.asset_customization_rules.map((r) => [r.video_label.name, r.customization_spec.instagram_positions])).toEqual([
      ["r916", ["story", "reels"]],
      ["r45", ["stream", "explore", "profile_feed"]],
    ]);
    expect(creative.degrees_of_freedom_spec).toEqual({ creative_features_spec: { image_touchups: { enroll_status: "OPT_IN" }, text_optimizations: { enroll_status: "OPT_OUT" } } });
    expect(creative.object_story_spec).toEqual({ page_id: "300000000000001", instagram_user_id: "400000000000001" });
  });

  it("finishes partial when an ad set fails, then retries only the failed items without duplicating", async () => {
    const { launchId, plan } = await newLaunch(draft());
    const secondAdset = plan.adsets[1]!.name;
    await fetch(`${process.env.META_GRAPH_HOST}/__fake/fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ match: "^POST act_200000000000001/adsets$", times: 1, error: { code: 100, message: "Invalid parameter", error_user_title: "Budget too low", error_user_msg: "Your daily budget must be at least $1.00." } }),
    });
    const first = await runLaunch(db, storageFromEnv(), launchId, fast);
    expect(first.status).toBe("partial");
    const failed = await db.select().from(launchItems).where(eq(launchItems.launchId, launchId));
    const failedAdset = failed.find((i) => i.level === "adset" && i.status === "failed")!;
    expect(failedAdset.errorMessage).toContain("Budget too low: Your daily budget must be at least $1.00.");
    expect((failedAdset.payload as { name: string }).name).toBe(plan.adsets[0]!.name);
    expect(failed.filter((i) => i.level === "ad" && i.status === "failed")).toHaveLength(5);
    void secondAdset;

    const campaignsBefore = objects("campaign").filter((c) => c.name === plan.campaign.name).length;
    expect(await resetFailedItems(db, launchId)).toBe(11);
    const second = await runLaunch(db, storageFromEnv(), launchId, fast);
    expect(second.status).toBe("done");
    expect(objects("campaign").filter((c) => c.name === plan.campaign.name)).toHaveLength(campaignsBefore);
    const [row] = await db.select().from(launches).where(eq(launches.id, launchId));
    expect(row!.status).toBe("done");
  });

  it("adopts an object that already exists after an ambiguous attempt instead of creating it twice", async () => {
    const small = { ...draft(), creatives: { groups: groups.slice(0, 1) } };
    const { launchId, plan } = await newLaunch(small);
    const [campaignItem] = await db.select().from(launchItems).where(eq(launchItems.idempotencyKey, `${launchId}:campaign:0`));
    // Meta created the campaign but the response never arrived.
    const { createMetaClient } = await import("@fahd/meta");
    const client = createMetaClient({ accessToken: "EAAFAKEx-0000000000000000000", appSecret: "s" });
    const { id } = await client.post<{ id: string }>("act_200000000000001/campaigns", { name: plan.campaign.name, status: "PAUSED" });
    await db.update(launchItems).set({ attempts: 1 }).where(eq(launchItems.id, campaignItem!.id));
    await db.update(launches).set({ startedAt: new Date(Date.now() - 1000) }).where(eq(launches.id, launchId));
    await runLaunch(db, storageFromEnv(), launchId, fast);
    const [after] = await db.select().from(launchItems).where(eq(launchItems.id, campaignItem!.id));
    expect(after!.metaId).toBe(id);
    expect(objects("campaign").filter((c) => c.name === plan.campaign.name)).toHaveLength(1);
  });
});
