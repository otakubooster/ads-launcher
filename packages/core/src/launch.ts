import { adAccounts, adsetTemplates, changeLog, creativeUploads, creatives, launchItems, launches, metaAds, metaAdsets, metaCampaigns, presets } from "@fahd/db/schema";
import type { AdsetTemplateSpec } from "@fahd/db/schema";
import { MetaApiError, describeMetaError, setStatus, type BatchRequest, type MetaClient, type Params } from "@fahd/meta";
import { CREATIVE_FEATURES } from "@fahd/shared/meta-options";
import type { AdCreativeSettings, AdsetSettings, CampaignSettings, CopyBlock, LaunchDraft, LaunchPlan, Placement } from "@fahd/shared/launch-plan";
import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { ALERTS, sendAlert } from "./alerts";
import { markConnectionBroken } from "./connections";
import { killSwitchState } from "./guardrails";
import { clientForAdAccount } from "./meta-client";
import type { Storage } from "./storage";
import type { AnyDb } from "./types";
import { uploadCreativeToAccount, type UploadOptions } from "./uploads";

type Item = typeof launchItems.$inferSelect;

export type CampaignPayload = { source: "new" | "existing"; name: string; metaId?: string; dailyBudget: number | null; settings?: CampaignSettings };
export type AdsetPayload = { source: "new" | "clone" | "existing"; name: string; existingMetaId?: string; dailyBudget: number | null; settings?: AdsetSettings };
export type CreativePayload = { name: string; groupKey: string; creativeIds: string[]; copy: CopyBlock; postId?: string; creative?: AdCreativeSettings };
export type AdPayload = { name: string; creativeIds: string[] };

// --- Plan → launch_items -------------------------------------------------------

/**
 * Writes the plan as a tree of launch_items (campaign → ad sets → creatives → ads).
 * Run inside the member's RLS transaction while the launch is still a draft.
 */
export async function createLaunchItems(db: AnyDb, launchId: string, plan: LaunchPlan) {
  const key = (level: string, k: string) => `${launchId}:${level}:${k}`;
  const [campaign] = await db
    .insert(launchItems)
    .values({ launchId, level: "campaign", payload: plan.campaign satisfies CampaignPayload, idempotencyKey: key("campaign", "0"), metaId: plan.campaign.source === "existing" ? (plan.campaign.metaId ?? null) : null, status: plan.campaign.source === "existing" ? "done" : "pending" })
    .returning({ id: launchItems.id });
  for (const a of plan.adsets) {
    const [adset] = await db
      .insert(launchItems)
      .values({
        launchId,
        level: "adset",
        parentItemId: campaign!.id,
        payload: { source: a.source, name: a.name, existingMetaId: a.existingMetaId, dailyBudget: a.dailyBudget, settings: a.settings } satisfies AdsetPayload,
        idempotencyKey: key("adset", a.key),
        metaId: a.source === "existing" ? (a.existingMetaId ?? null) : null,
        status: a.source === "existing" ? "done" : "pending",
      })
      .returning({ id: launchItems.id });
    for (const ad of a.ads) {
      const [creative] = await db
        .insert(launchItems)
        .values({
          launchId,
          level: "creative",
          parentItemId: adset!.id,
          payload: { name: ad.name, groupKey: ad.group.key, creativeIds: ad.group.creativeIds, copy: ad.copy, postId: ad.group.postId, creative: ad.creative } satisfies CreativePayload,
          idempotencyKey: key("creative", ad.key),
        })
        .returning({ id: launchItems.id });
      await db.insert(launchItems).values({
        launchId,
        level: "ad",
        parentItemId: creative!.id,
        payload: { name: ad.name, creativeIds: ad.group.creativeIds } satisfies AdPayload,
        idempotencyKey: key("ad", ad.key),
      });
    }
  }
}

// --- Creative spec ------------------------------------------------------------

export type CreativeFile = { ratio: string | null; kind: "image" | "video"; imageHash: string | null; videoId: string | null; thumbnailUrl: string | null };

const LABELS: Record<string, string> = { "9:16": "r916", "4:5": "r45", "1:1": "r11", "16:9": "r169" };

/**
 * POST /act_{id}/adcreatives params (docs/spec.md → Create objects, step 4):
 * a single image or video uses object_story_spec; different files per placement
 * use asset_feed_spec with labelled media and at least two asset_customization_rules
 * (9:16 → Stories/Reels, 4:5 or 1:1 → Feed); a Post ID reuses object_story_id.
 */
/** The feature key in Meta's "Param key 'music' in degrees_of_freedom_spec[creative_features_spec] must be one of …". */
export function rejectedFeatureKey(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Param key '([^']+)' in degrees_of_freedom_spec/i.exec(message)?.[1] ?? null;
}

/** Meta's "Ads creative post was created by an app that is in development mode" (subcode 1885183). */
export function madeInDevelopmentMode(error: unknown) {
  const e = error as { message?: string; userMessage?: string | null; subcode?: number | null } | null;
  return e?.subcode === 1885183 || /created by an app that is in development mode/i.test(`${e?.message ?? ""} ${e?.userMessage ?? ""}`);
}

export function buildCreativeParams(input: {
  name: string;
  pageId: string;
  instagramUserId: string | null;
  files: CreativeFile[];
  copy: CopyBlock;
  urlTags: string | null;
  features: Record<string, "OPT_IN" | "OPT_OUT">;
  postId?: string;
  /** The link text shown instead of the URL (Ads Manager's "Display link"). */
  displayLink?: string | null;
}): Params {
  const params: Params = { name: input.name };
  if (input.urlTags) params.url_tags = input.urlTags;
  // Image-only features on a video creative (and video-only on an image) are refused by Meta.
  const isVideo = input.files.some((f) => f.kind === "video");
  const applies = (k: string) => (isVideo ? !k.startsWith("image_") : !k.startsWith("video_"));
  // Only features the app still offers (older presets may carry removed ones, like "music").
  const offered = new Set<string>(CREATIVE_FEATURES.map((f) => f.key));
  const featureSpec = Object.fromEntries(
    Object.entries(input.features)
      .filter(([k]) => offered.has(k) && (input.postId || applies(k)))
      .map(([k, v]) => [k, { enroll_status: v }]),
  );
  if (Object.keys(featureSpec).length) params.degrees_of_freedom_spec = { creative_features_spec: featureSpec };

  if (input.postId) {
    params.object_story_id = input.postId.includes("_") ? input.postId : `${input.pageId}_${input.postId}`;
    return params;
  }
  const identity = { page_id: input.pageId, ...(input.instagramUserId ? { instagram_user_id: input.instagramUserId } : {}) };
  const c = input.copy;
  const cta = { type: c.cta, value: { link: c.link } };
  const multiText = c.primaryTexts.length > 1 || c.headlines.length > 1 || c.descriptions.length > 1;
  const vertical = input.files.find((f) => f.ratio === "9:16");
  const feed = input.files.find((f) => f.ratio === "4:5") ?? input.files.find((f) => f.ratio === "1:1");
  const byPlacement = vertical && feed && vertical !== feed;

  if (input.files.length === 1 && !multiText) {
    const f = input.files[0]!;
    params.object_story_spec =
      f.kind === "video"
        ? { ...identity, video_data: { video_id: f.videoId, image_url: f.thumbnailUrl, message: c.primaryTexts[0], title: c.headlines[0], link_description: c.descriptions[0], call_to_action: cta } }
        : { ...identity, link_data: { image_hash: f.imageHash, link: c.link, message: c.primaryTexts[0], name: c.headlines[0], description: c.descriptions[0], call_to_action: cta, ...(input.displayLink ? { caption: input.displayLink } : {}) } };
    return params;
  }

  const media = byPlacement ? [vertical!, feed!] : [input.files.find((f) => f.ratio === "4:5") ?? input.files[0]!];
  const mediaIsVideo = media[0]!.kind === "video";
  const label = (f: CreativeFile) => ({ name: LABELS[f.ratio ?? ""] ?? "r45" });
  params.object_story_spec = identity;
  params.asset_feed_spec = {
    ...(mediaIsVideo
      ? { videos: media.map((f) => ({ video_id: f.videoId, thumbnail_url: f.thumbnailUrl, adlabels: [label(f)] })) }
      : { images: media.map((f) => ({ hash: f.imageHash, adlabels: [label(f)] })) }),
    bodies: c.primaryTexts.map((text) => ({ text })),
    titles: (c.headlines.length ? c.headlines : [""]).filter(Boolean).map((text) => ({ text })),
    descriptions: c.descriptions.map((text) => ({ text })),
    link_urls: [{ website_url: c.link, ...(input.displayLink ? { display_url: input.displayLink } : {}) }],
    call_to_action_types: [c.cta],
    ad_formats: [mediaIsVideo ? "SINGLE_VIDEO" : "SINGLE_IMAGE"],
    ...(byPlacement
      ? {
          asset_customization_rules: [
            {
              customization_spec: { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["story", "facebook_reels"], instagram_positions: ["story", "reels"] },
              [mediaIsVideo ? "video_label" : "image_label"]: label(vertical!),
              priority: 1,
            },
            {
              customization_spec: { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed", "marketplace", "video_feeds", "search"], instagram_positions: ["stream", "explore", "profile_feed"] },
              [mediaIsVideo ? "video_label" : "image_label"]: label(feed!),
              priority: 2,
            },
          ],
        }
      : { optimization_type: "DEGREES_OF_FREEDOM" }),
  };
  return params;
}

// --- Editor settings → Meta ------------------------------------------------------

/** Campaign fields from the Ads Manager-style editor (Sales, auction). */
export function campaignParams(name: string, s: CampaignSettings): Params {
  return {
    name,
    objective: "OUTCOME_SALES",
    special_ad_categories: [],
    buying_type: "AUCTION",
    status: "PAUSED",
    ...(s.campaignBudget
      ? {
          [s.budgetType === "lifetime" ? "lifetime_budget" : "daily_budget"]: s.budget,
          bid_strategy: s.bidStrategy,
          ...(s.startTime ? { start_time: s.startTime } : {}),
          ...(s.endTime ? { stop_time: s.endTime } : {}),
        }
      : { is_adset_budget_sharing_enabled: false }),
  };
}

const POSITIONS: Record<Placement, [platform: string, field: string, position: string]> = {
  facebook_feed: ["facebook", "facebook_positions", "feed"],
  facebook_reels: ["facebook", "facebook_positions", "facebook_reels"],
  facebook_stories: ["facebook", "facebook_positions", "story"],
  instagram_feed: ["instagram", "instagram_positions", "stream"],
  instagram_reels: ["instagram", "instagram_positions", "reels"],
  instagram_stories: ["instagram", "instagram_positions", "story"],
  instagram_explore: ["instagram", "instagram_positions", "explore"],
  audience_network: ["audience_network", "audience_network_positions", "classic"],
  messenger: ["messenger", "messenger_positions", "messenger_home"],
};

const ATTRIBUTION: Record<AdsetSettings["attribution"], { event_type: string; window_days: number }[]> = {
  "7d_click_1d_view": [
    { event_type: "CLICK_THROUGH", window_days: 7 },
    { event_type: "VIEW_THROUGH", window_days: 1 },
  ],
  "7d_click": [{ event_type: "CLICK_THROUGH", window_days: 7 }],
  "1d_click": [{ event_type: "CLICK_THROUGH", window_days: 1 }],
  "1d_click_1d_view": [
    { event_type: "CLICK_THROUGH", window_days: 1 },
    { event_type: "VIEW_THROUGH", window_days: 1 },
  ],
};

/** Ad set fields from the editor: conversion, budget and schedule, audience, placements. */
export function adsetParams(name: string, campaignMetaId: string, s: AdsetSettings, campaign: CampaignSettings | undefined): Params {
  // Advantage+ audience treats age and gender as suggestions; tighter limits need the original audience.
  const advantage = s.ageMin <= 25 && s.ageMax === 65 && s.gender === "all";
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: s.countries },
    age_min: s.ageMin,
    age_max: s.ageMax,
    ...(s.gender === "all" ? {} : { genders: [s.gender === "male" ? 1 : 2] }),
    targeting_automation: { advantage_audience: advantage ? 1 : 0 },
  };
  if (Array.isArray(s.placements)) {
    const platforms = new Set<string>();
    for (const p of s.placements) {
      const [platform, field, position] = POSITIONS[p];
      platforms.add(platform);
      targeting[field] = [...((targeting[field] as string[] | undefined) ?? []), position];
    }
    targeting.publisher_platforms = [...platforms];
  }
  const strategy = campaign?.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP";
  const ownBudget = !campaign?.campaignBudget;
  return {
    name,
    campaign_id: campaignMetaId,
    optimization_goal: s.performanceGoal,
    billing_event: "IMPRESSIONS",
    promoted_object: { pixel_id: s.pixelId, custom_event_type: s.event },
    targeting,
    attribution_spec: ATTRIBUTION[s.attribution],
    ...(ownBudget ? { [s.budgetType === "lifetime" ? "lifetime_budget" : "daily_budget"]: s.budget, bid_strategy: strategy } : {}),
    ...(s.bidAmount && (strategy === "COST_CAP" || strategy === "LOWEST_COST_WITH_BID_CAP") ? { bid_amount: s.bidAmount } : {}),
    ...(s.bidAmount && strategy === "LOWEST_COST_WITH_MIN_ROAS" ? { bid_constraints: { roas_average_floor: s.bidAmount } } : {}),
    ...(s.startTime ? { start_time: s.startTime } : {}),
    ...(s.endTime ? { end_time: s.endTime } : {}),
    status: "PAUSED",
  };
}

// --- Runner -------------------------------------------------------------------

export type RunOptions = {
  upload?: UploadOptions;
  client?: MetaClient;
  shouldStop?: () => Promise<boolean>;
  /**
   * Epoch ms to hand over by (hosts that cut requests short, like Vercel). The run
   * saves its place and returns "running"; the next call continues, and videos
   * still processing on Meta are checked again then instead of waited for.
   */
  deadline?: number;
};
export type RunResult = { status: "done" | "partial" | "failed" | "stopped" | "running"; created: number; failed: number };

class StopLaunch extends Error {}
/** Out of time for this step; everything done so far is saved. */
class Yield extends Error {}

/**
 * Creates a launch on Meta (docs/spec.md → launch runner): uploads media, then
 * walks campaign → ad sets → creatives + ads (batched, ads chained to their
 * creative), everything PAUSED. Safe to re-run: done items are skipped and an
 * item that may have been created is looked up by name first.
 * Rate limits and ambiguous timeouts are rethrown for the queue to retry.
 */
export async function runLaunch(db: AnyDb, storage: Storage, launchId: string, opts: RunOptions = {}): Promise<RunResult> {
  const [launch] = await db.select().from(launches).where(eq(launches.id, launchId));
  if (!launch) throw new Error("Launch not found");
  if (launch.status === "done") return { status: "done", created: 0, failed: 0 };
  const draft = launch.structure as LaunchDraft;
  const [preset] = await db.select().from(presets).where(eq(presets.id, launch.presetId));
  if (!preset) throw new Error("Preset not found");
  const [account] = await db.select().from(adAccounts).where(eq(adAccounts.id, preset.adAccountId));
  const [template] = preset.adsetTemplateId || draft.destination.adsetTemplateId
    ? await db.select().from(adsetTemplates).where(eq(adsetTemplates.id, (draft.destination.adsetTemplateId ?? preset.adsetTemplateId)!))
    : [];

  // The kill switch stops inline runs too, not only the worker's.
  const shouldStop = opts.shouldStop ?? (async () => (await killSwitchState(db)).on);
  // The first unit of work always runs, so every step makes progress.
  let units = 0;
  const checkpoint = async () => {
    if (await shouldStop()) throw new StopLaunch("Kill switch");
    if (units++ > 0 && opts.deadline && Date.now() > opts.deadline) throw new Yield();
  };
  const startedAt = launch.startedAt ?? new Date();
  await db.update(launches).set({ status: "running", startedAt }).where(eq(launches.id, launchId));
  const { client, metaAccountId } = opts.client ? { client: opts.client, metaAccountId: account!.metaId } : await clientForAdAccount(db, account!.id);
  const meta = { accountId: metaAccountId };

  let items = await db.select().from(launchItems).where(eq(launchItems.launchId, launchId)).orderBy(asc(launchItems.createdAt));
  const byId = new Map(items.map((i) => [i.id, i]));
  const children = (parent: Item) => items.filter((i) => i.parentItemId === parent.id);

  const save = async (item: Item, patch: Partial<Item>) => {
    Object.assign(item, patch);
    await db.update(launchItems).set(patch).where(eq(launchItems.id, item.id));
  };
  const fail = async (item: Item, e: unknown) => {
    const d = e instanceof MetaApiError ? describeMetaError(e) : null;
    await save(item, {
      status: "failed",
      attempts: item.attempts + 1,
      errorCode: e instanceof MetaApiError ? e.code : null,
      // Title, Meta's message and the fix on separate lines; the launch log shows them apart.
      errorMessage: d ? [d.title, d.detail, d.fix].join("\n").slice(0, 1000) : (e instanceof Error ? e.message : String(e)).slice(0, 1000),
    });
  };
  const skipSubtree = async (item: Item, reason: string) => {
    for (const child of children(item)) {
      if (child.status === "pending" || child.status === "running") await save(child, { status: "failed", errorMessage: reason });
      await skipSubtree(child, reason);
    }
  };
  const logCreate = async (level: "campaign" | "adset" | "creative" | "ad", metaId: string, name: string, response: unknown) => {
    await db.insert(changeLog).values({ actorId: launch.createdBy, source: "system", entityLevel: level, entityId: metaId, action: "create", after: { name, status: "PAUSED", launchId }, metaResponse: response as object });
  };

  /** Whether Meta already has this object (after an ambiguous timeout). */
  const findByName = async (path: string, name: string) => {
    const res = await client.get<{ data: { id: string; name: string; created_time?: string }[] }>(path, { fields: "id,name,created_time", filtering: [{ field: "name", operator: "EQUAL", value: name }], limit: 50 }, meta);
    return res.data.find((o) => o.name === name && (!o.created_time || new Date(o.created_time).getTime() >= startedAt.getTime() - 60_000))?.id ?? null;
  };

  /** Classifies an error: stop everything, retry later, or fail just this item. */
  const handle = async (item: Item, e: unknown) => {
    if (e instanceof MetaApiError) {
      if (e.kind === "auth") {
        await markConnectionBroken(db, account!.connectionId, e);
        await fail(item, e);
        throw new StopLaunch(e.message);
      }
      if (e.kind === "rate_limit") throw e;
      if (e.ambiguous) {
        await save(item, { attempts: item.attempts + 1, errorMessage: "Meta didn't answer; checking before retrying." });
        throw e;
      }
      if (e.kind === "policy" || e.kind === "permission") {
        await fail(item, e);
        if (e.code === 368) await sendAlert(db, ALERTS.policyBlock(account!.id, account!.name, e.userMessage ?? e.message));
        throw new StopLaunch(e.message);
      }
    }
    await fail(item, e);
  };

  try {
    // 1. Media into the account's library, once per file.
    const creativeItems = items.filter((i) => i.level === "creative" && i.status !== "done");
    const needed = [...new Set(creativeItems.flatMap((i) => (i.payload as CreativePayload).postId ? [] : (i.payload as CreativePayload).creativeIds))];
    const uploaded = new Map<string, CreativeFile>();
    const uploadErrors = new Map<string, unknown>();
    let processing = 0;
    // Files already in this account's library cost nothing: load them without a checkpoint.
    const ready = needed.length
      ? await db
          .select({ id: creatives.id, ratio: creatives.ratio, kind: creatives.kind, imageHash: creativeUploads.imageHash, videoId: creativeUploads.videoId, thumbnailUrl: creativeUploads.thumbnailUrl })
          .from(creativeUploads)
          .innerJoin(creatives, eq(creatives.id, creativeUploads.creativeId))
          .where(
            and(
              eq(creativeUploads.adAccountId, account!.id),
              eq(creativeUploads.status, "ready"),
              inArray(creativeUploads.creativeId, needed),
              // Videos need a thumbnail; one saved without goes back through the upload check.
              or(isNotNull(creativeUploads.imageHash), isNotNull(creativeUploads.thumbnailUrl)),
            ),
          )
      : [];
    for (const r of ready) uploaded.set(r.id, { ratio: r.ratio, kind: r.kind, imageHash: r.imageHash, videoId: r.videoId, thumbnailUrl: r.thumbnailUrl });
    for (const creativeId of needed) {
      if (uploaded.has(creativeId)) continue;
      await checkpoint();
      try {
        const res = await uploadCreativeToAccount(db, storage, creativeId, account!.id, { ...opts.upload, noWait: opts.deadline !== undefined });
        if (res.status === "processing") {
          processing++;
          continue;
        }
        const [row] = await db.select({ ratio: creatives.ratio, kind: creatives.kind }).from(creatives).where(eq(creatives.id, creativeId));
        uploaded.set(creativeId, { ratio: row?.ratio ?? null, kind: row?.kind ?? "image", imageHash: res.imageHash, videoId: res.videoId, thumbnailUrl: res.thumbnailUrl });
      } catch (e) {
        if (e instanceof MetaApiError && (e.kind === "rate_limit" || e.kind === "auth")) throw e;
        uploadErrors.set(creativeId, e);
      }
    }

    // Ads need every file ready; videos Meta is still processing are checked next step.
    if (processing > 0) throw new Yield();

    // 2. Campaign.
    const campaignItem = items.find((i) => i.level === "campaign")!;
    if (campaignItem.status !== "done") {
      const p = campaignItem.payload as CampaignPayload;
      try {
        let id = campaignItem.attempts > 0 ? await findByName(`${metaAccountId}/campaigns`, p.name) : null;
        if (!id) {
          const res = await client.post<{ id: string }>(
            `${metaAccountId}/campaigns`,
            p.settings
              ? campaignParams(p.name, p.settings)
              : {
                  name: p.name,
                  objective: "OUTCOME_SALES",
                  special_ad_categories: [],
                  buying_type: "AUCTION",
                  status: "PAUSED",
                  ...(p.dailyBudget ? { daily_budget: p.dailyBudget, bid_strategy: "LOWEST_COST_WITHOUT_CAP" } : { is_adset_budget_sharing_enabled: false }),
                },
            meta,
          );
          id = res.id;
          await logCreate("campaign", id, p.name, res);
        }
        await save(campaignItem, { status: "done", metaId: id, attempts: campaignItem.attempts + 1, errorMessage: null });
      } catch (e) {
        await handle(campaignItem, e);
        await skipSubtree(campaignItem, "Skipped: the campaign wasn't created.");
      }
    }

    // 3. Ad sets.
    for (const adsetItem of items.filter((i) => i.level === "adset")) {
      if (adsetItem.status === "done" || adsetItem.status === "failed") continue;
      await checkpoint();
      const campaign = byId.get(adsetItem.parentItemId!)!;
      if (!campaign.metaId) continue;
      const p = adsetItem.payload as AdsetPayload;
      try {
        let id = adsetItem.attempts > 0 ? await findByName(`${campaign.metaId}/adsets`, p.name) : null;
        if (!id && p.source === "clone" && draft.destination.cloneAdsetId) {
          const [src] = await db.select({ metaId: metaAdsets.metaId }).from(metaAdsets).where(eq(metaAdsets.id, draft.destination.cloneAdsetId));
          const res = await client.post<{ copied_adset_id: string }>(`${src!.metaId}/copies`, { campaign_id: campaign.metaId, deep_copy: false, status_option: "PAUSED" }, meta);
          id = res.copied_adset_id;
          await client.post(id, { name: p.name, ...(p.dailyBudget ? { daily_budget: p.dailyBudget } : {}) }, meta);
          await logCreate("adset", id, p.name, res);
        } else if (!id && p.settings) {
          const res = await client.post<{ id: string }>(`${metaAccountId}/adsets`, adsetParams(p.name, campaign.metaId, p.settings, (campaign.payload as CampaignPayload).settings), meta);
          id = res.id;
          await logCreate("adset", id, p.name, res);
        } else if (!id) {
          const spec = template?.spec as AdsetTemplateSpec | undefined;
          const targeting = {
            ...(spec?.targeting ?? {}),
            geo_locations: { countries: draft.destination.countries.length ? draft.destination.countries : [preset.market] },
            targeting_automation: { advantage_audience: 1 },
          };
          const res = await client.post<{ id: string }>(
            `${metaAccountId}/adsets`,
            {
              name: p.name,
              campaign_id: campaign.metaId,
              optimization_goal: spec?.optimizationGoal ?? "OFFSITE_CONVERSIONS",
              billing_event: spec?.billingEvent ?? "IMPRESSIONS",
              ...(p.dailyBudget ? { daily_budget: p.dailyBudget, bid_strategy: spec?.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP" } : {}),
              promoted_object: { pixel_id: preset.pixelId, custom_event_type: preset.conversionEvent },
              targeting,
              attribution_spec: spec?.attributionSpec ?? [
                { event_type: "CLICK_THROUGH", window_days: 7 },
                { event_type: "VIEW_THROUGH", window_days: 1 },
              ],
              ...(draft.structure.start === "scheduled" && draft.structure.startTime ? { start_time: draft.structure.startTime } : {}),
              status: "PAUSED",
            },
            meta,
          );
          id = res.id;
          await logCreate("adset", id, p.name, res);
        }
        await save(adsetItem, { status: "done", metaId: id, attempts: adsetItem.attempts + 1, errorMessage: null });
      } catch (e) {
        await handle(adsetItem, e);
        await skipSubtree(adsetItem, "Skipped: its ad set wasn't created.");
      }
    }

    // Advantage+ feature keys Meta refused in this run (its list changes between API
    // versions): they're dropped and the creative is sent again without them.
    const rejectedFeatures = new Set<string>();
    const withoutRejected = (f: Record<string, "OPT_IN" | "OPT_OUT">) => Object.fromEntries(Object.entries(f).filter(([k]) => !rejectedFeatures.has(k)));

    // 4. Creatives and ads, batched per ad set: [creative, ad] pairs chained by name.
    items = await db.select().from(launchItems).where(eq(launchItems.launchId, launchId)).orderBy(asc(launchItems.createdAt));
    for (const i of items) byId.set(i.id, i);
    for (const adsetItem of items.filter((i) => i.level === "adset" && i.status === "done")) {
      const pairs = items
        .filter((c) => c.level === "creative" && c.parentItemId === adsetItem.id)
        .map((creative) => ({ creative, ad: items.find((a) => a.level === "ad" && a.parentItemId === creative.id)! }))
        .filter((p) => p.ad && p.ad.status !== "done" && p.ad.status !== "failed");

      // Files that failed to upload fail their creative before anything is sent.
      const ready: typeof pairs = [];
      for (const pair of pairs) {
        const payload = pair.creative.payload as CreativePayload;
        const broken = payload.creativeIds.find((id) => uploadErrors.has(id));
        if (broken && !payload.postId) {
          await fail(pair.creative, uploadErrors.get(broken));
          await save(pair.ad, { status: "failed", errorMessage: "Skipped: its media didn't upload." });
        } else ready.push(pair);
      }

      for (let start = 0; start < ready.length; start += 25) {
        await checkpoint();
        const slice = ready.slice(start, start + 25);
        // An ambiguous earlier attempt may have created some ads: adopt those by name.
        let todo: typeof slice = [];
        for (const pair of slice) {
          const name = (pair.ad.payload as AdPayload).name;
          const existing = pair.ad.attempts > 0 ? await findByName(`${adsetItem.metaId}/ads`, name) : null;
          if (existing) await save(pair.ad, { status: "done", metaId: existing, errorMessage: null });
          else todo.push(pair);
        }
        if (todo.length === 0) continue;

        // Rounds: a refused feature key is dropped and only those pairs go again.
        for (let round = 0; todo.length && round < 12; round++) {
          const retry: typeof todo = [];
          const droppedNow = new Set<string>();
          const requests: BatchRequest[] = [];
          for (const [i, { creative, ad }] of todo.entries()) {
            const payload = creative.payload as CreativePayload;
            const files = payload.creativeIds.map((id) => uploaded.get(id)).filter((f): f is CreativeFile => Boolean(f));
            if (creative.status === "done" && creative.metaId) {
              requests.push({ method: "GET", relativeUrl: creative.metaId, params: { fields: "id" }, name: `c${i}` });
            } else {
              requests.push({
                method: "POST",
                relativeUrl: `${metaAccountId}/adcreatives`,
                name: `c${i}`,
                params: buildCreativeParams({
                  name: payload.name,
                  pageId: payload.creative?.pageId ?? preset.pageId,
                  instagramUserId: payload.creative ? (payload.creative.instagramUserId ?? null) : preset.instagramUserId,
                  files,
                  copy: payload.copy,
                  urlTags: payload.creative ? (payload.creative.urlTags ?? null) : preset.urlTags,
                  features: withoutRejected(payload.creative?.features ?? draft.structure.features),
                  postId: payload.postId,
                  displayLink: payload.creative?.displayLink,
                }),
              });
            }
            requests.push({
              method: "POST",
              relativeUrl: `${metaAccountId}/ads`,
              params: { name: (ad.payload as AdPayload).name, adset_id: adsetItem.metaId, creative: { creative_id: `{result=c${i}:$.id}` }, status: "PAUSED" },
            });
          }

          let results;
          try {
            results = await client.batch<{ id: string }>(requests, meta);
          } catch (e) {
            for (const { ad } of todo) await save(ad, { attempts: ad.attempts + 1 });
            throw e;
          }
          for (const [i, { creative, ad }] of todo.entries()) {
            const c = results[i * 2]!;
            const a = results[i * 2 + 1]!;
            if (c.ok) {
              if (creative.status !== "done") {
                await save(creative, { status: "done", metaId: c.body.id, attempts: creative.attempts + 1, errorMessage: null });
                await logCreate("creative", c.body.id, (creative.payload as CreativePayload).name, c.body);
              }
            } else {
              const key = rejectedFeatureKey(c.error);
              // A newly refused feature (and not the last round): drop it and send this pair again.
              if (key && (!rejectedFeatures.has(key) || droppedNow.has(key)) && round < 11) {
                rejectedFeatures.add(key);
                droppedNow.add(key);
                retry.push({ creative, ad });
                continue;
              }
              await fail(creative, c.error);
            }
            if (a.ok) {
              await save(ad, { status: "done", metaId: a.body.id, attempts: ad.attempts + 1, errorMessage: null });
              await logCreate("ad", a.body.id, (ad.payload as AdPayload).name, a.body);
            } else if (c.ok) {
              if (a.error.kind === "policy" || a.error.kind === "permission") {
                await fail(ad, a.error);
                throw new StopLaunch(a.error.message);
              }
              await fail(ad, a.error);
              // A creative made while the Meta app was in Development mode can never run as an ad:
              // fail it too, so "Retry failed items" makes a new one instead of reusing it.
              if (madeInDevelopmentMode(a.error)) await save(creative, { status: "failed", errorMessage: "Made while the Meta app was in Development mode; a new one is created on retry." });
            } else {
              await save(ad, { status: "failed", attempts: ad.attempts + 1, errorMessage: "Skipped: its creative wasn't created." });
            }
          }
          todo = retry;
        }
      }
    }

    // 5. Optional activation ("Create & activate"), only when everything was created.
    items = await db.select().from(launchItems).where(eq(launchItems.launchId, launchId));
    if (draft.activateAfter && items.every((i) => i.status === "done")) {
      await activateLaunch(db, launchId, { actorId: launch.createdBy, source: "system", client, metaAccountId });
    }
    return await finish(db, launchId);
  } catch (e) {
    if (e instanceof StopLaunch) {
      const result = await finish(db, launchId, true);
      return { ...result, status: e.message === "Kill switch" ? "stopped" : result.status };
    }
    if (e instanceof Yield) {
      const now = await db.select({ status: launchItems.status }).from(launchItems).where(eq(launchItems.launchId, launchId));
      return { status: "running", created: now.filter((i) => i.status === "done").length, failed: now.filter((i) => i.status === "failed").length };
    }
    throw e;
  }
}

/**
 * Activates what a launch created: ads, then new ad sets, then a new campaign, so
 * nothing spends before its children exist. Existing campaigns and ad sets keep
 * their status. Each write gets a change_log row, also when Meta refuses it.
 */
export async function activateLaunch(
  db: AnyDb,
  launchId: string,
  opts: { actorId: string; source: "ui" | "system"; client?: MetaClient; metaAccountId?: string },
): Promise<{ activated: number }> {
  const [launch] = await db.select().from(launches).where(eq(launches.id, launchId));
  if (!launch) throw new Error("Launch not found");
  const items = await db.select().from(launchItems).where(eq(launchItems.launchId, launchId));
  if (!items.length || items.some((i) => i.status !== "done")) {
    throw new MetaApiError({ kind: "guard", message: "Activate all needs every item created. Retry the failed items first." });
  }
  let { client, metaAccountId } = opts;
  if (!client) {
    const [preset] = await db.select({ adAccountId: presets.adAccountId }).from(presets).where(eq(presets.id, launch.presetId));
    ({ client, metaAccountId } = await clientForAdAccount(db, preset!.adAccountId));
  }
  const mirror = { campaign: metaCampaigns, adset: metaAdsets, ad: metaAds } as const;
  let activated = 0;
  for (const level of ["ad", "adset", "campaign"] as const) {
    for (const item of items.filter((i) => i.level === level && i.metaId)) {
      if (level !== "ad" && (item.payload as CampaignPayload | AdsetPayload).source === "existing") continue;
      const entry = { actorId: opts.actorId, source: opts.source, entityLevel: level, entityId: item.metaId!, action: "activate", before: { status: "PAUSED" }, after: { status: "ACTIVE", launchId } } as const;
      try {
        const res = await setStatus(client!, item.metaId!, "ACTIVE", metaAccountId!);
        await db.insert(changeLog).values({ ...entry, metaResponse: res as object });
      } catch (e) {
        await db.insert(changeLog).values({ ...entry, after: { status: "PAUSED", launchId }, metaResponse: { error: e instanceof Error ? e.message : String(e) } });
        throw e;
      }
      await db.update(mirror[level]).set({ status: "ACTIVE", effectiveStatus: "ACTIVE" }).where(eq(mirror[level].metaId, item.metaId!));
      activated++;
    }
  }
  await db
    .update(launches)
    .set({ structure: { ...(launch.structure as object), activatedAt: new Date().toISOString() } })
    .where(eq(launches.id, launchId));
  return { activated };
}

async function finish(db: AnyDb, launchId: string, stopped = false): Promise<RunResult> {
  const items = await db.select().from(launchItems).where(eq(launchItems.launchId, launchId));
  const created = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const pending = items.filter((i) => i.status === "pending" || i.status === "running").length;
  const ads = items.filter((i) => i.level === "ad");
  const adsDone = ads.filter((i) => i.status === "done").length;
  const status = pending > 0 && !stopped ? "running" : adsDone === ads.length && failed === 0 ? "done" : adsDone === 0 ? "failed" : "partial";
  const [launch] = await db
    .update(launches)
    .set({ status, finishedAt: status === "running" ? null : new Date() })
    .where(eq(launches.id, launchId))
    .returning({ name: launches.name });
  if (status === "failed" && !stopped) await sendAlert(db, ALERTS.launchFailed(launchId, launch?.name ?? "launch"));
  return { status: status === "running" ? "partial" : status, created, failed };
}

/** Puts failed items back to pending so the runner tries them again (docs/spec.md → Retry failed items). */
export async function resetFailedItems(db: AnyDb, launchId: string) {
  // Ads refused because their creative was made in Development mode: that creative must be made again.
  const devFailed = await db
    .select({ parent: launchItems.parentItemId })
    .from(launchItems)
    .where(and(eq(launchItems.launchId, launchId), eq(launchItems.level, "ad"), eq(launchItems.status, "failed"), sql`${launchItems.errorMessage} ilike '%development mode%'`));
  const creativeIds = devFailed.map((r) => r.parent).filter((id): id is string => Boolean(id));
  if (creativeIds.length) {
    await db.update(launchItems).set({ status: "pending", metaId: null, errorCode: null, errorMessage: null }).where(and(eq(launchItems.level, "creative"), inArray(launchItems.id, creativeIds)));
  }
  const reset = await db
    .update(launchItems)
    .set({ status: "pending", errorCode: null, errorMessage: null })
    .where(and(eq(launchItems.launchId, launchId), eq(launchItems.status, "failed")))
    .returning({ id: launchItems.id });
  if (reset.length) await db.update(launches).set({ status: "queued", finishedAt: null }).where(eq(launches.id, launchId));
  return reset.length;
}

/** Mirror rows for a draft's destination, for buildPlan's context. */
export async function destinationContext(db: AnyDb, draft: LaunchDraft) {
  const campaign = draft.destination.campaignId
    ? (await db.select({ metaId: metaCampaigns.metaId, name: metaCampaigns.name, budget: metaCampaigns.dailyBudget }).from(metaCampaigns).where(eq(metaCampaigns.id, draft.destination.campaignId)))[0]
    : undefined;
  const adsets = draft.destination.adsetIds?.length
    ? await db.select({ id: metaAdsets.id, metaId: metaAdsets.metaId, name: metaAdsets.name }).from(metaAdsets).where(inArray(metaAdsets.id, draft.destination.adsetIds))
    : [];
  const clone = draft.destination.cloneAdsetId
    ? (await db.select({ metaId: metaAdsets.metaId, name: metaAdsets.name }).from(metaAdsets).where(eq(metaAdsets.id, draft.destination.cloneAdsetId)))[0]
    : undefined;
  return {
    existingCampaign: campaign ? { metaId: campaign.metaId, name: campaign.name, hasBudget: campaign.budget !== null } : null,
    existingAdsets: adsets,
    cloneAdset: clone ?? null,
  };
}

/**
 * Takes the launch for one step (Vercel runs), or returns false when another step
 * holds it. Expires on its own, so a step that dies never blocks the launch.
 */
export async function acquireLaunchLease(db: AnyDb, launchId: string, seconds: number) {
  const rows = await db
    .update(launches)
    .set({ leaseUntil: sql`now() + make_interval(secs => ${seconds})` })
    .where(and(eq(launches.id, launchId), sql`(${launches.leaseUntil} is null or ${launches.leaseUntil} < now())`))
    .returning({ id: launches.id });
  return rows.length > 0;
}

export async function releaseLaunchLease(db: AnyDb, launchId: string) {
  await db.update(launches).set({ leaseUntil: null }).where(eq(launches.id, launchId));
}

/** Launches whose runner stopped mid-way (a step died or a chain broke): resume them. */
export async function stalledLaunches(db: AnyDb, idleSeconds = 120) {
  const rows = await db
    .select({ id: launches.id })
    .from(launches)
    .where(
      and(
        inArray(launches.status, ["queued", "running"]),
        sql`(${launches.leaseUntil} is null or ${launches.leaseUntil} < now())`,
        sql`coalesce((select max(li.updated_at) from launch_items li where li.launch_id = ${launches.id}), ${launches.updatedAt}) < now() - make_interval(secs => ${idleSeconds})`,
      ),
    );
  return rows.map((r) => r.id);
}
