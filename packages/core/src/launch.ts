import { adAccounts, adsetTemplates, changeLog, creatives, launchItems, launches, metaAds, metaAdsets, metaCampaigns, presets } from "@fahd/db/schema";
import type { AdsetTemplateSpec } from "@fahd/db/schema";
import { MetaApiError, describeMetaError, setStatus, type BatchRequest, type MetaClient, type Params } from "@fahd/meta";
import type { CopyBlock, LaunchDraft, LaunchPlan } from "@fahd/shared/launch-plan";
import { and, asc, eq, inArray } from "drizzle-orm";
import { markConnectionBroken } from "./connections";
import { clientForAdAccount } from "./meta-client";
import type { Storage } from "./storage";
import type { AnyDb } from "./types";
import { uploadCreativeToAccount, type UploadOptions } from "./uploads";

type Item = typeof launchItems.$inferSelect;

export type CampaignPayload = { source: "new" | "existing"; name: string; metaId?: string; dailyBudget: number | null };
export type AdsetPayload = { source: "new" | "clone" | "existing"; name: string; existingMetaId?: string; dailyBudget: number | null };
export type CreativePayload = { name: string; groupKey: string; creativeIds: string[]; copy: CopyBlock; postId?: string };
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
        payload: { source: a.source, name: a.name, existingMetaId: a.existingMetaId, dailyBudget: a.dailyBudget } satisfies AdsetPayload,
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
          payload: { name: ad.name, groupKey: ad.group.key, creativeIds: ad.group.creativeIds, copy: ad.copy, postId: ad.group.postId } satisfies CreativePayload,
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
export function buildCreativeParams(input: {
  name: string;
  pageId: string;
  instagramUserId: string | null;
  files: CreativeFile[];
  copy: CopyBlock;
  urlTags: string | null;
  features: Record<string, "OPT_IN" | "OPT_OUT">;
  postId?: string;
}): Params {
  const params: Params = { name: input.name };
  if (input.urlTags) params.url_tags = input.urlTags;
  const featureSpec = Object.fromEntries(Object.entries(input.features).map(([k, v]) => [k, { enroll_status: v }]));
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
        : { ...identity, link_data: { image_hash: f.imageHash, link: c.link, message: c.primaryTexts[0], name: c.headlines[0], description: c.descriptions[0], call_to_action: cta } };
    return params;
  }

  const media = byPlacement ? [vertical!, feed!] : [input.files.find((f) => f.ratio === "4:5") ?? input.files[0]!];
  const isVideo = media[0]!.kind === "video";
  const label = (f: CreativeFile) => ({ name: LABELS[f.ratio ?? ""] ?? "r45" });
  params.object_story_spec = identity;
  params.asset_feed_spec = {
    ...(isVideo
      ? { videos: media.map((f) => ({ video_id: f.videoId, thumbnail_url: f.thumbnailUrl, adlabels: [label(f)] })) }
      : { images: media.map((f) => ({ hash: f.imageHash, adlabels: [label(f)] })) }),
    bodies: c.primaryTexts.map((text) => ({ text })),
    titles: (c.headlines.length ? c.headlines : [""]).filter(Boolean).map((text) => ({ text })),
    descriptions: c.descriptions.map((text) => ({ text })),
    link_urls: [{ website_url: c.link }],
    call_to_action_types: [c.cta],
    ad_formats: [isVideo ? "SINGLE_VIDEO" : "SINGLE_IMAGE"],
    ...(byPlacement
      ? {
          asset_customization_rules: [
            {
              customization_spec: { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["story", "facebook_reels"], instagram_positions: ["story", "reels"] },
              [isVideo ? "video_label" : "image_label"]: label(vertical!),
              priority: 1,
            },
            {
              customization_spec: { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed", "marketplace", "video_feeds", "search"], instagram_positions: ["stream", "explore", "profile_feed"] },
              [isVideo ? "video_label" : "image_label"]: label(feed!),
              priority: 2,
            },
          ],
        }
      : { optimization_type: "DEGREES_OF_FREEDOM" }),
  };
  return params;
}

// --- Runner -------------------------------------------------------------------

export type RunOptions = { upload?: UploadOptions; client?: MetaClient; shouldStop?: () => Promise<boolean> };
export type RunResult = { status: "done" | "partial" | "failed" | "stopped"; created: number; failed: number };

class StopLaunch extends Error {}

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
    for (const creativeId of needed) {
      if (opts.shouldStop && (await opts.shouldStop())) throw new StopLaunch("Kill switch");
      try {
        const res = await uploadCreativeToAccount(db, storage, creativeId, account!.id, opts.upload);
        const [row] = await db.select({ ratio: creatives.ratio, kind: creatives.kind }).from(creatives).where(eq(creatives.id, creativeId));
        uploaded.set(creativeId, { ratio: row?.ratio ?? null, kind: row?.kind ?? "image", imageHash: res.imageHash, videoId: res.videoId, thumbnailUrl: res.thumbnailUrl });
      } catch (e) {
        if (e instanceof MetaApiError && (e.kind === "rate_limit" || e.kind === "auth")) throw e;
        uploadErrors.set(creativeId, e);
      }
    }

    // 2. Campaign.
    const campaignItem = items.find((i) => i.level === "campaign")!;
    if (campaignItem.status !== "done") {
      const p = campaignItem.payload as CampaignPayload;
      try {
        let id = campaignItem.attempts > 0 ? await findByName(`${metaAccountId}/campaigns`, p.name) : null;
        if (!id) {
          const res = await client.post<{ id: string }>(
            `${metaAccountId}/campaigns`,
            {
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
      if (opts.shouldStop && (await opts.shouldStop())) throw new StopLaunch("Kill switch");
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
        if (opts.shouldStop && (await opts.shouldStop())) throw new StopLaunch("Kill switch");
        const slice = ready.slice(start, start + 25);
        // An ambiguous earlier attempt may have created some ads: adopt those by name.
        const todo: typeof slice = [];
        for (const pair of slice) {
          const name = (pair.ad.payload as AdPayload).name;
          const existing = pair.ad.attempts > 0 ? await findByName(`${adsetItem.metaId}/ads`, name) : null;
          if (existing) await save(pair.ad, { status: "done", metaId: existing, errorMessage: null });
          else todo.push(pair);
        }
        if (todo.length === 0) continue;

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
              params: buildCreativeParams({ name: payload.name, pageId: preset.pageId, instagramUserId: preset.instagramUserId, files, copy: payload.copy, urlTags: preset.urlTags, features: draft.structure.features, postId: payload.postId }),
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
          } else {
            await save(ad, { status: "failed", attempts: ad.attempts + 1, errorMessage: "Skipped: its creative wasn't created." });
          }
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
  await db
    .update(launches)
    .set({ status, finishedAt: status === "running" ? null : new Date() })
    .where(eq(launches.id, launchId));
  return { status: status === "running" ? "partial" : status, created, failed };
}

/** Puts failed items back to pending so the runner tries them again (docs/spec.md → Retry failed items). */
export async function resetFailedItems(db: AnyDb, launchId: string) {
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
