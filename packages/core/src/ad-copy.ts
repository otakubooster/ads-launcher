import { metaAds } from "@fahd/db/schema";
import { MetaApiError, type Params } from "@fahd/meta";
import { eq } from "drizzle-orm";
import { clientForAdAccount } from "./meta-client";
import type { MetaChange } from "./objects";
import type { AnyDb } from "./types";

/**
 * Ads Manager lets you edit a live ad's text, link and button: it makes a new
 * creative with the same media and swaps it onto the ad (Meta reviews it again).
 */
export type AdCopy = {
  /** "single": one text each (object_story_spec); "multi": up to 5 options (asset_feed_spec); "post": an existing post; "other": a format we can't edit (catalog, carousel, …). */
  format: "single" | "multi" | "post" | "other";
  primaryTexts: string[];
  headlines: string[];
  descriptions: string[];
  link: string;
  cta: string;
  urlTags: string | null;
};

type Cta = { type?: string; value?: { link?: string } };
type Spec = Record<string, unknown> & {
  link_data?: Record<string, unknown> & { message?: string; name?: string; description?: string; link?: string; call_to_action?: Cta };
  video_data?: Record<string, unknown> & { message?: string; title?: string; link_description?: string; call_to_action?: Cta };
};
type Feed = Record<string, unknown> & {
  bodies?: { text: string }[];
  titles?: { text: string }[];
  descriptions?: { text: string }[];
  link_urls?: (Record<string, unknown> & { website_url?: string })[];
  call_to_action_types?: string[];
};
type Creative = {
  id: string;
  name?: string;
  object_story_spec?: Spec;
  asset_feed_spec?: Feed;
  object_story_id?: string;
  url_tags?: string;
  degrees_of_freedom_spec?: { creative_features_spec?: Record<string, unknown> };
};

const FIELDS = "id,name,object_story_spec,asset_feed_spec,object_story_id,url_tags,degrees_of_freedom_spec";

async function loadCreative(db: AnyDb, adId: string) {
  const [ad] = await db.select({ metaId: metaAds.metaId, adAccountId: metaAds.adAccountId, name: metaAds.name, creativeId: metaAds.creativeId }).from(metaAds).where(eq(metaAds.id, adId));
  if (!ad) throw new Error("ad not found");
  if (!ad.creativeId) throw new MetaApiError({ kind: "guard", message: "This ad has no creative to edit" });
  const { client, metaAccountId } = await clientForAdAccount(db, ad.adAccountId);
  const creative = await client.get<Creative>(ad.creativeId, { fields: FIELDS }, { accountId: metaAccountId });
  return { ad, client, metaAccountId, creative };
}

function readCopy(c: Creative): AdCopy {
  const tags = c.url_tags ?? null;
  const feed = c.asset_feed_spec;
  if (feed && (feed.bodies?.length || feed.titles?.length)) {
    return {
      format: "multi",
      primaryTexts: feed.bodies?.map((b) => b.text) ?? [],
      headlines: feed.titles?.map((t) => t.text) ?? [],
      descriptions: feed.descriptions?.map((d) => d.text) ?? [],
      link: feed.link_urls?.[0]?.website_url ?? "",
      cta: feed.call_to_action_types?.[0] ?? "SHOP_NOW",
      urlTags: tags,
    };
  }
  const link = c.object_story_spec?.link_data;
  if (link) {
    return { format: "single", primaryTexts: [link.message ?? ""], headlines: link.name ? [link.name] : [], descriptions: link.description ? [link.description] : [], link: link.link ?? link.call_to_action?.value?.link ?? "", cta: link.call_to_action?.type ?? "SHOP_NOW", urlTags: tags };
  }
  const video = c.object_story_spec?.video_data;
  if (video) {
    return { format: "single", primaryTexts: [video.message ?? ""], headlines: video.title ? [video.title] : [], descriptions: video.link_description ? [video.link_description] : [], link: video.call_to_action?.value?.link ?? "", cta: video.call_to_action?.type ?? "SHOP_NOW", urlTags: tags };
  }
  return { format: c.object_story_id ? "post" : "other", primaryTexts: [], headlines: [], descriptions: [], link: "", cta: "", urlTags: tags };
}

/** The live ad's text, read from its creative on Meta. */
export async function loadAdCopy(db: AnyDb, adId: string): Promise<AdCopy> {
  const { creative } = await loadCreative(db, adId);
  return readCopy(creative);
}

const clean = (list: string[]) => list.map((t) => t.trim()).filter(Boolean);

/** New creative with the same media and identity, then the ad points at it. */
export async function editAdCopy(db: AnyDb, adId: string, next: Omit<AdCopy, "format">): Promise<MetaChange & { creativeId: string }> {
  const { ad, client, metaAccountId, creative } = await loadCreative(db, adId);
  const current = readCopy(creative);
  if (current.format === "post") throw new MetaApiError({ kind: "guard", message: "This ad uses an existing post. Edit the post on Facebook, or duplicate the ad and give it new text." });
  if (current.format === "other") throw new MetaApiError({ kind: "guard", message: "This ad's format can't be edited here yet. Edit it in Ads Manager." });
  const texts = clean(next.primaryTexts);
  const headlines = clean(next.headlines);
  const descriptions = clean(next.descriptions);
  if (!texts.length) throw new MetaApiError({ kind: "guard", message: "Write the primary text" });
  if (!/^https?:\/\/\S+\.\S+/.test(next.link)) throw new MetaApiError({ kind: "guard", message: "Enter a website URL starting with https://" });
  const max = current.format === "multi" ? 5 : 1;
  if (texts.length > max || headlines.length > max || descriptions.length > max) throw new MetaApiError({ kind: "guard", message: max === 1 ? "This ad takes one text of each kind" : "Up to 5 options of each text" });

  const before = { primaryTexts: current.primaryTexts, headlines: current.headlines, descriptions: current.descriptions, link: current.link, cta: current.cta, urlTags: current.urlTags };
  const after = { primaryTexts: texts, headlines, descriptions, link: next.link, cta: next.cta, urlTags: next.urlTags?.trim() || null };
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return { level: "ad", id: adId, metaId: ad.metaId, adAccountId: ad.adAccountId, name: ad.name, before: {}, after: {}, metaResponse: { skipped: "no changes" }, creativeId: creative.id };
  }

  const params: Params = { name: `${(creative.name ?? ad.name).replace(/ · edited.*$/, "")} · edited ${new Date().toISOString().slice(0, 16).replace("T", " ")}` };
  if (after.urlTags) params.url_tags = after.urlTags;
  const features = creative.degrees_of_freedom_spec?.creative_features_spec;
  if (features && Object.keys(features).length) params.degrees_of_freedom_spec = { creative_features_spec: features };
  const cta = { type: after.cta, value: { link: after.link } };
  const spec = creative.object_story_spec ?? {};
  if (current.format === "multi") {
    const feed = creative.asset_feed_spec!;
    params.object_story_spec = spec;
    params.asset_feed_spec = {
      ...feed,
      bodies: texts.map((text) => ({ text })),
      titles: headlines.map((text) => ({ text })),
      descriptions: descriptions.map((text) => ({ text })),
      link_urls: [{ ...(feed.link_urls?.[0] ?? {}), website_url: after.link }],
      call_to_action_types: [after.cta],
    };
  } else if (spec.link_data) {
    params.object_story_spec = { ...spec, link_data: { ...spec.link_data, message: texts[0], name: headlines[0], description: descriptions[0], link: after.link, call_to_action: cta } };
  } else {
    params.object_story_spec = { ...spec, video_data: { ...spec.video_data, message: texts[0], title: headlines[0], link_description: descriptions[0], call_to_action: cta } };
  }

  const created = await client.post<{ id: string }>(`${metaAccountId}/adcreatives`, params, { accountId: metaAccountId });
  const swapped = await client.post<{ success: boolean }>(ad.metaId, { creative: { creative_id: created.id } }, { accountId: metaAccountId });
  await db.update(metaAds).set({ creativeId: created.id }).where(eq(metaAds.id, adId));
  return { level: "ad", id: adId, metaId: ad.metaId, adAccountId: ad.adAccountId, name: ad.name, before: { ...before, creativeId: creative.id }, after: { ...after, creativeId: created.id }, metaResponse: { creative: created, ad: swapped }, creativeId: created.id };
}
