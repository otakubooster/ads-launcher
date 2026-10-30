import "server-only";
import { destinationContext, todayIn } from "@fahd/core";
import { adAccounts, adsetTemplates, brands, copySets, creatives, launches, metaAdsets, metaAssets, metaCampaigns, namingTemplates, presets } from "@fahd/db/schema";
import { CREATIVE_FEATURES } from "@fahd/shared/meta-options";
import { EMPTY_DRAFT, type LaunchDraft, type PlanContext } from "@fahd/shared/launch-plan";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { asUser } from "./db";

type Tx = Parameters<Parameters<typeof asUser>[1]>[0];

/** A new draft prefilled from the preset (and creatives picked in the library). */
export async function draftFromPreset(tx: Tx, presetId: string, creativeIds: string[] = []): Promise<{ draft: LaunchDraft; name: string }> {
  const [row] = await tx
    .select({ preset: presets, brand: brands.name, timezone: adAccounts.timezone })
    .from(presets)
    .innerJoin(brands, eq(brands.id, presets.brandId))
    .innerJoin(adAccounts, eq(adAccounts.id, presets.adAccountId))
    .where(eq(presets.id, presetId));
  if (!row) throw new Error("Preset not found");
  const p = row.preset;
  const templateIds = [p.namingTemplateId, p.adsetNamingTemplateId, p.adNamingTemplateId].filter((x): x is string => Boolean(x));
  const templates = templateIds.length ? await tx.select().from(namingTemplates).where(inArray(namingTemplates.id, templateIds)) : [];
  const pattern = (id: string | null, fallback: string) => templates.find((t) => t.id === id)?.pattern ?? fallback;

  const picked = creativeIds.length ? await tx.select().from(creatives).where(inArray(creatives.id, creativeIds)) : [];
  const groups = new Map<string, typeof picked>();
  for (const c of picked) groups.set(c.groupKey, [...(groups.get(c.groupKey) ?? []), c]);

  const draft: LaunchDraft = {
    ...EMPTY_DRAFT,
    destination: { ...EMPTY_DRAFT.destination, countries: [p.market], adsetTemplateId: p.adsetTemplateId },
    creatives: {
      groups: [...groups].map(([key, list]) => {
        const tags = list[0]!.tags as { angle?: string; hook?: string; format?: string };
        return { key, creativeIds: list.map((c) => c.id), angle: tags.angle, hook: tags.hook ?? key, format: tags.format };
      }),
    },
    copy: { ...EMPTY_DRAFT.copy, cta: p.defaultCta, link: p.linkUrl },
    structure: {
      ...EMPTY_DRAFT.structure,
      naming: {
        campaign: pattern(p.namingTemplateId, EMPTY_DRAFT.structure.naming.campaign),
        adset: pattern(p.adsetNamingTemplateId, EMPTY_DRAFT.structure.naming.adset),
        ad: pattern(p.adNamingTemplateId, EMPTY_DRAFT.structure.naming.ad),
      },
      features: Object.fromEntries(CREATIVE_FEATURES.map((f) => [f.key, (p.creativeFeatures as Record<string, "OPT_IN" | "OPT_OUT">)[f.key] ?? "OPT_OUT"])),
    },
  };
  return { draft, name: `${row.brand} ${p.market} · ${todayIn(row.timezone)}` };
}

/** Everything buildPlan needs to know about the world for this draft. */
export async function planContext(tx: Tx, presetId: string, draft: LaunchDraft): Promise<PlanContext> {
  const [row] = await tx
    .select({ market: presets.market, brand: brands.name, timezone: adAccounts.timezone, currency: adAccounts.currency })
    .from(presets)
    .innerJoin(brands, eq(brands.id, presets.brandId))
    .innerJoin(adAccounts, eq(adAccounts.id, presets.adAccountId))
    .where(eq(presets.id, presetId));
  if (!row) throw new Error("Preset not found");
  const ids = [...new Set(draft.creatives.groups.flatMap((g) => g.creativeIds))];
  const files = ids.length ? await tx.select({ id: creatives.id, ratio: creatives.ratio, kind: creatives.kind, fileName: creatives.fileName }).from(creatives).where(inArray(creatives.id, ids)) : [];
  return {
    brand: row.brand,
    market: row.market,
    date: todayIn(row.timezone),
    currency: row.currency,
    creatives: Object.fromEntries(files.map((f) => [f.id, { ratio: f.ratio, kind: f.kind, fileName: f.fileName }])),
    ...(await destinationContext(tx, draft)),
  };
}

export type BuilderPreset = {
  id: string;
  brandId: string;
  brandName: string;
  market: string;
  language: string;
  accountId: string;
  accountName: string;
  currency: string;
  today: string;
  pageName: string;
  instagramName: string | null;
  pixelName: string;
  conversionEvent: string;
  linkUrl: string;
  urlTags: string | null;
};

export type BuilderData = {
  launch: { id: string; name: string; presetId: string; draft: LaunchDraft };
  presets: { id: string; label: string }[];
  preset: BuilderPreset;
  copySets: { id: string; name: string; language: string; primaryTexts: string[]; headlines: string[]; descriptions: string[]; ctaType: string }[];
  adsetTemplates: { id: string; name: string }[];
  campaigns: { id: string; metaId: string; name: string; status: string; dailyBudget: number | null }[];
  adsets: { id: string; metaId: string; name: string; status: string; campaignId: string }[];
};

/** Everything the builder shows, except the creative library (loadCreatives signs its URLs). */
export async function loadBuilder(userId: string, launchId: string): Promise<BuilderData | { status: string } | null> {
  return asUser(userId, async (tx) => {
    const [launch] = await tx.select().from(launches).where(eq(launches.id, launchId));
    if (!launch) return null;
    if (launch.status !== "draft") return { status: launch.status };
    const [row] = await tx
      .select({ preset: presets, brand: brands.name, account: adAccounts })
      .from(presets)
      .innerJoin(brands, eq(brands.id, presets.brandId))
      .innerJoin(adAccounts, eq(adAccounts.id, presets.adAccountId))
      .where(eq(presets.id, launch.presetId));
    if (!row) return null;
    const p = row.preset;
    const assets = await tx
      .select({ kind: metaAssets.kind, metaId: metaAssets.metaId, name: metaAssets.name })
      .from(metaAssets)
      .where(inArray(metaAssets.metaId, [p.pageId, p.pixelId, p.instagramUserId].filter((x): x is string => Boolean(x))));
    const assetName = (id: string | null) => (id ? (assets.find((a) => a.metaId === id)?.name ?? id) : null);
    const allPresets = await tx
      .select({ id: presets.id, brand: brands.name, market: presets.market, language: presets.language })
      .from(presets)
      .innerJoin(brands, eq(brands.id, presets.brandId))
      .orderBy(asc(brands.name), asc(presets.market));
    const live = and(eq(metaCampaigns.adAccountId, p.adAccountId), notInArray(metaCampaigns.status, ["DELETED", "ARCHIVED"]));
    return {
      launch: { id: launch.id, name: launch.name, presetId: launch.presetId, draft: { ...EMPTY_DRAFT, ...(launch.structure as Partial<LaunchDraft>) } },
      presets: allPresets.map((x) => ({ id: x.id, label: `${x.brand} · ${x.market} · ${x.language}` })),
      preset: {
        id: p.id,
        brandId: p.brandId,
        brandName: row.brand,
        market: p.market,
        language: p.language,
        accountId: row.account.id,
        accountName: row.account.name,
        currency: row.account.currency,
        today: todayIn(row.account.timezone),
        pageName: assetName(p.pageId)!,
        instagramName: assetName(p.instagramUserId),
        pixelName: assetName(p.pixelId)!,
        conversionEvent: p.conversionEvent,
        linkUrl: p.linkUrl,
        urlTags: p.urlTags,
      },
      copySets: (await tx.select().from(copySets).where(eq(copySets.brandId, p.brandId)).orderBy(asc(copySets.name))).map((c) => ({
        id: c.id,
        name: c.name,
        language: c.language,
        primaryTexts: c.primaryTexts,
        headlines: c.headlines,
        descriptions: c.descriptions,
        ctaType: c.ctaType,
      })),
      adsetTemplates: await tx.select({ id: adsetTemplates.id, name: adsetTemplates.name }).from(adsetTemplates).orderBy(asc(adsetTemplates.name)),
      campaigns: await tx
        .select({ id: metaCampaigns.id, metaId: metaCampaigns.metaId, name: metaCampaigns.name, status: metaCampaigns.status, dailyBudget: metaCampaigns.dailyBudget })
        .from(metaCampaigns)
        .where(live)
        .orderBy(asc(metaCampaigns.name)),
      adsets: await tx
        .select({ id: metaAdsets.id, metaId: metaAdsets.metaId, name: metaAdsets.name, status: metaAdsets.status, campaignId: metaAdsets.campaignId })
        .from(metaAdsets)
        .where(and(eq(metaAdsets.adAccountId, p.adAccountId), notInArray(metaAdsets.status, ["DELETED", "ARCHIVED"])))
        .orderBy(asc(metaAdsets.name)),
    };
  });
}
