import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as s from "./schema";

/**
 * Development data: two fictional brands across three ad accounts, a mirror of
 * campaigns → ad sets → ads, 28 days of insights ending yesterday, a finished
 * and a draft launch, change log entries and API usage readings.
 * Deterministic for a given `today`. All Meta IDs are fake.
 * `minimal` seeds only the team, brands, templates, copy and creatives; connect
 * the fake Graph server in Settings to fill in the Meta side.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPgDatabase = PgDatabase<any, typeof s>;

export const SEED_USERS = {
  owner: { id: "00000000-0000-4000-8000-000000000001", email: "fahd@example.com", name: "Fahd", role: "owner" },
  admin: { id: "00000000-0000-4000-8000-000000000002", email: "admin@example.com", name: "Sara Admin", role: "admin" },
  buyer: { id: "00000000-0000-4000-8000-000000000003", email: "buyer@example.com", name: "Omar Buyer", role: "buyer" },
  viewer: { id: "00000000-0000-4000-8000-000000000004", email: "viewer@example.com", name: "Lina Viewer", role: "viewer" },
} as const;

export const SEED_DAYS = 28;

const ACCOUNTS = [
  { metaId: "act_200000000000001", brand: "Lumen", market: "US", name: "Lumen US", currency: "USD", timezone: "America/New_York", language: "en" },
  { metaId: "act_200000000000002", brand: "Lumen", market: "GB", name: "Lumen UK", currency: "GBP", timezone: "Europe/London", language: "en" },
  { metaId: "act_200000000000003", brand: "Arbor", market: "FR", name: "Arbor FR", currency: "EUR", timezone: "Europe/Paris", language: "fr" },
] as const;

// Small deterministic PRNG so seeded numbers are stable across runs.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function metaId(prefix: number, n: number) {
  return `${prefix}${String(n).padStart(14, "0")}`;
}

export async function seed(
  db: AnyPgDatabase,
  { today = new Date().toISOString().slice(0, 10), minimal = false }: { today?: string; minimal?: boolean } = {},
) {
  const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(s.brands);
  if (existing && existing.n > 0) {
    throw new Error("The database already has data; the seed only runs on an empty database.");
  }
  const rand = mulberry32(42);
  const between = (min: number, max: number) => min + rand() * (max - min);

  // Team. auth.users rows stand in for accounts Supabase Auth would create.
  for (const u of Object.values(SEED_USERS)) {
    await db.execute(sql`insert into auth.users (id, email) values (${u.id}, ${u.email}) on conflict (id) do nothing`);
  }
  await db.insert(s.users).values(Object.values(SEED_USERS).map((u) => ({ ...u })));
  const owner = SEED_USERS.owner.id;

  const brandRows = await db
    .insert(s.brands)
    .values([
      { name: "Lumen", defaultDomain: "lumen.example" },
      { name: "Arbor", defaultDomain: "arbor.example" },
    ])
    .returning();
  const brandId = (name: string) => brandRows.find((b) => b.name === name)!.id;

  const naming = await db
    .insert(s.namingTemplates)
    .values([
      { level: "campaign", pattern: "{brand}_{market}_{date}" },
      { level: "adset", pattern: "{brand}_{market}_{angle}_{n}" },
      { level: "ad", pattern: "{hook}_{format}_{n}" },
    ])
    .returning();

  const [adsetTemplate] = await db
    .insert(s.adsetTemplates)
    .values({
      name: "Broad · Advantage+ audience",
      sourceAdsetId: "120000000000000101",
      spec: {
        optimizationGoal: "OFFSITE_CONVERSIONS",
        billingEvent: "IMPRESSIONS",
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
        targeting: { targeting_automation: { advantage_audience: 1 } },
        attributionSpec: [
          { event_type: "CLICK_THROUGH", window_days: 7 },
          { event_type: "VIEW_THROUGH", window_days: 1 },
        ],
      },
    })
    .returning();

  await db.insert(s.copySets).values([
    {
      brandId: brandId("Lumen"),
      language: "en",
      name: "Lumen · Glow serum",
      primaryTexts: ["Your skin, but rested.", "One drop. Visible glow by morning."],
      headlines: ["Glow serum", "Wake up glowing"],
      descriptions: ["Free shipping over $50"],
    },
    {
      brandId: brandId("Arbor"),
      language: "fr",
      name: "Arbor · Lancement",
      primaryTexts: ["Le confort, sans compromis."],
      headlines: ["Découvrir Arbor"],
      descriptions: ["Livraison offerte"],
      ctaType: "LEARN_MORE",
    },
  ]);

  // Creatives: hook × ratio pairs that share a group_key.
  const hooks = ["hook1", "hook2", "hook3"];
  await db.insert(s.creatives).values(
    hooks.flatMap((hook, i) =>
      (["9:16", "4:5"] as const).map((ratio) => ({
        brandId: brandId("Lumen"),
        fileName: `${hook}_${ratio === "9:16" ? "9x16" : "4x5"}.mp4`,
        storagePath: `creatives/lumen/${hook}_${ratio === "9:16" ? "9x16" : "4x5"}.mp4`,
        kind: "video" as const,
        width: 1080,
        height: ratio === "9:16" ? 1920 : 1350,
        ratio,
        durationS: 15 + i * 5,
        sizeBytes: 18_000_000 + i * 2_000_000,
        sha256: `${i}${ratio === "9:16" ? "a" : "b"}`.padEnd(64, "0"),
        groupKey: hook,
        tags: { angle: i === 2 ? "routine" : "glow", hook, format: "ugc", language: "en" },
      })),
    ),
  );

  await db.insert(s.savedViews).values({
    userId: owner,
    name: "Winners · ROAS",
    level: "ad",
    columns: ["status", "name", "spend", "purchases", "cpa", "roas", "hook_rate"],
    filters: { roas: { gte: 2 } },
    sort: [{ id: "roas", desc: true }],
  });

  if (minimal) return { ads: 0, insights: 0 };

  // Everything below mirrors Meta. Minimal mode leaves it to a sync with the fake Graph server.
  const [connection] = await db
    .insert(s.metaConnections)
    .values({
      businessId: "100000000000001",
      businessName: "Fahd Holdings (seed)",
      // Not a real token: decrypting it fails, so nothing can reach Meta with it.
      tokenCiphertext: "c2VlZC1ub3QtYS1yZWFsLXRva2Vu",
      tokenIv: "c2VlZC1pdg==",
      tokenLast4: "SEED",
      scopes: ["ads_management", "ads_read", "business_management"],
      status: "unverified",
    })
    .returning({ id: s.metaConnections.id });

  const accountRows = await db
    .insert(s.adAccounts)
    .values(
      ACCOUNTS.map((a) => ({
        metaId: a.metaId,
        connectionId: connection!.id,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone,
        accountStatus: 1,
        maxDailyBudget: 500_000,
        approvalThreshold: 100_000,
        launchEnabled: true,
      })),
    )
    .returning();

  const presetRows = await db
    .insert(s.presets)
    .values(
      ACCOUNTS.map((a, i) => ({
        brandId: brandId(a.brand),
        market: a.market,
        language: a.language,
        adAccountId: accountRows[i]!.id,
        pageId: metaId(3, i + 1),
        instagramUserId: metaId(4, i + 1),
        pixelId: metaId(5, i + 1),
        linkUrl: `https://${a.brand.toLowerCase()}.example/${a.market.toLowerCase()}`,
        urlTags: "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}",
        creativeFeatures: { image_touchups: "OPT_IN", text_optimizations: "OPT_OUT", music: "OPT_OUT" } as s.CreativeFeatures,
        namingTemplateId: naming.find((n) => n.level === "campaign")!.id,
        adsetTemplateId: adsetTemplate!.id,
      })),
    )
    .returning();

  // Meta mirror: per account 2 campaigns × 2 ad sets × 3 ads.
  const adsetStatuses = ["ACTIVE", "ACTIVE", "ACTIVE", "PAUSED"];
  const adEffective = ["ACTIVE", "ACTIVE", "ACTIVE", "IN_PROCESS", "DISAPPROVED", "WITH_ISSUES"];
  let n = 0;
  const ads: { id: string; active: boolean }[] = [];
  for (const [ai, account] of accountRows.entries()) {
    for (let c = 0; c < 2; c++) {
      n++;
      const [campaign] = await db
        .insert(s.metaCampaigns)
        .values({
          metaId: metaId(12, n),
          adAccountId: account.id,
          name: `${ACCOUNTS[ai]!.brand}_${ACCOUNTS[ai]!.market}_${c === 0 ? "Prospecting" : "Scaling"}`,
          status: "ACTIVE",
          effectiveStatus: "ACTIVE",
          objective: "OUTCOME_SALES",
          bidStrategy: "LOWEST_COST_WITHOUT_CAP",
          dailyBudget: c === 0 ? 15_000 : 40_000,
        })
        .returning();
      for (let a = 0; a < 2; a++) {
        n++;
        const status = adsetStatuses[(c * 2 + a) % adsetStatuses.length]!;
        const [adset] = await db
          .insert(s.metaAdsets)
          .values({
            metaId: metaId(12, n),
            adAccountId: account.id,
            campaignId: campaign!.id,
            name: `${ACCOUNTS[ai]!.brand}_${ACCOUNTS[ai]!.market}_${a === 0 ? "glow" : "routine"}_${a + 1}`,
            status,
            effectiveStatus: status === "PAUSED" ? "PAUSED" : "ACTIVE",
            optimizationGoal: "OFFSITE_CONVERSIONS",
          })
          .returning();
        for (let d = 0; d < 3; d++) {
          n++;
          const effective = status === "PAUSED" ? "ADSET_PAUSED" : adEffective[(n + d) % adEffective.length]!;
          const [ad] = await db
            .insert(s.metaAds)
            .values({
              metaId: metaId(12, n),
              adAccountId: account.id,
              campaignId: campaign!.id,
              adsetId: adset!.id,
              name: `${hooks[d]}_ugc_${d + 1}`,
              status: "ACTIVE",
              effectiveStatus: effective,
              creativeId: metaId(13, n),
            })
            .returning();
          ads.push({ id: ad!.id, active: effective === "ACTIVE" || effective === "WITH_ISSUES" });
        }
      }
    }
  }

  // 28 days of insights ending yesterday. Ads that are not delivering stop
  // spending for the last 7 days.
  const insightRows: (typeof s.insightsDaily.$inferInsert)[] = [];
  for (const ad of ads) {
    const quality = between(0.6, 1.6);
    for (let day = SEED_DAYS; day >= 1; day--) {
      if (!ad.active && day <= 7) continue;
      const spend = Math.round(between(2_000, 30_000));
      const impressions = Math.round((spend / between(800, 2_000)) * 1000);
      const clicks = Math.round(impressions * between(0.006, 0.02) * quality);
      const purchases = Math.round(clicks * between(0.015, 0.04) * quality);
      insightRows.push({
        adId: ad.id,
        date: addDays(today, -day),
        spend,
        impressions,
        clicks,
        purchases,
        purchaseValue: purchases * Math.round(between(4_500, 7_500)),
        video3sPlays: Math.round(impressions * between(0.22, 0.4)),
        thruplays: Math.round(impressions * between(0.07, 0.15)),
      });
    }
  }
  await db.insert(s.insightsDaily).values(insightRows);

  // Launches: one finished, one draft.
  const [done] = await db
    .insert(s.launches)
    .values({
      name: "Lumen US · glow hooks",
      presetId: presetRows[0]!.id,
      createdBy: SEED_USERS.buyer.id,
      mode: "existing_campaign",
      status: "done",
      startedAt: new Date(`${addDays(today, -3)}T14:02:00Z`),
      finishedAt: new Date(`${addDays(today, -3)}T14:06:30Z`),
    })
    .returning();
  const [adsetItem] = await db
    .insert(s.launchItems)
    .values({
      launchId: done!.id,
      level: "adset",
      payload: { name: "Lumen_US_glow_3" },
      metaId: "120000000000000901",
      status: "done",
      attempts: 1,
      idempotencyKey: `${done!.id}:adset:0`,
    })
    .returning();
  await db.insert(s.launchItems).values(
    [0, 1].map((i) => ({
      launchId: done!.id,
      level: "ad" as const,
      parentItemId: adsetItem!.id,
      payload: { name: `hook${i + 1}_ugc_${i + 1}` },
      metaId: `12000000000000091${i}`,
      status: "done" as const,
      attempts: 1,
      idempotencyKey: `${done!.id}:ad:${i}`,
    })),
  );
  await db.insert(s.launches).values({
    name: "Arbor FR · launch",
    presetId: presetRows[2]!.id,
    createdBy: owner,
    mode: "new_campaign",
    status: "draft",
  });

  await db.insert(s.changeLog).values([
    {
      actorId: SEED_USERS.buyer.id,
      source: "ui",
      entityLevel: "adset",
      entityId: metaId(12, 2),
      action: "update_budget",
      before: { daily_budget: 10_000 },
      after: { daily_budget: 12_000 },
      metaResponse: { success: true },
    },
    {
      actorId: owner,
      source: "ui",
      entityLevel: "ad",
      entityId: metaId(12, 4),
      action: "pause",
      before: { status: "ACTIVE" },
      after: { status: "PAUSED" },
      metaResponse: { success: true },
    },
    {
      actorId: null,
      source: "system",
      entityLevel: "ad_account",
      entityId: ACCOUNTS[0].metaId,
      action: "sync",
      after: { campaigns: 2, adsets: 4, ads: 12 },
    },
  ]);

  await db.insert(s.apiUsage).values(
    accountRows.map((a, i) => ({
      adAccountId: a.id,
      accUtilPct: [12.5, 38, 81.25][i]!,
      callCount: [8, 31, 77][i]!,
      totalCputime: [5, 22, 64][i]!,
      totalTime: [6, 25, 70][i]!,
      tier: "development_access",
    })),
  );

  return { ads: ads.length, insights: insightRows.length };
}
