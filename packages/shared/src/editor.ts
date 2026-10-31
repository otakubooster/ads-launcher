import type { AdCreativeSettings, AdsetSettings, CampaignSettings, CopyBlock, LaunchPlan, PlanIssue, PlannedAd, PlannedAdset } from "./launch-plan";
import { COPY_LIMITS } from "./meta-options";

/**
 * The Ads Manager-style editor: one campaign → ad sets → ads, each edited on its
 * own like Ads Manager (Sales objective, website conversions). Pure and
 * browser-safe; editorToPlan() turns it into the launch runner's plan.
 */

export type EditorAd = {
  key: string;
  name: string;
  /** "existing_post" reuses a Page post (keeps its likes and comments). */
  setup: "create" | "existing_post";
  postId?: string | null;
  /** Library creatives: one per ratio (9:16 for Stories/Reels, 4:5 or 1:1 for Feed). */
  creativeIds: string[];
  primaryTexts: string[];
  headlines: string[];
  descriptions: string[];
  cta: string;
  link: string;
} & AdCreativeSettings;

export type EditorAdset = { key: string; name: string; ads: EditorAd[] } & AdsetSettings;

export type EditorCampaign = { name: string } & CampaignSettings;

export type EditorDoc = { campaign: EditorCampaign; adsets: EditorAdset[] };

/** Where the editor's defaults come from: the preset (brand × market). */
export type EditorDefaults = {
  brand: string;
  market: string;
  date: string;
  pageId: string;
  instagramUserId: string | null;
  pixelId: string;
  event: string;
  link: string;
  cta: string;
  urlTags: string | null;
  features: Record<string, "OPT_IN" | "OPT_OUT">;
};

let seq = 0;
/** Short unique keys for tree nodes (stable across saves). */
export function nodeKey(prefix: "s" | "a") {
  seq = (seq + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newAd(d: EditorDefaults, n: number): EditorAd {
  return {
    key: nodeKey("a"),
    name: `${d.brand} ${d.market} ad ${n}`,
    setup: "create",
    postId: null,
    creativeIds: [],
    primaryTexts: [""],
    headlines: [""],
    descriptions: [],
    cta: d.cta,
    link: d.link,
    pageId: d.pageId,
    instagramUserId: d.instagramUserId,
    urlTags: d.urlTags,
    displayLink: null,
    features: { ...d.features },
  };
}

export function newAdset(d: EditorDefaults, n: number): EditorAdset {
  return {
    key: nodeKey("s"),
    name: `${d.brand} ${d.market} ad set ${n}`,
    performanceGoal: "OFFSITE_CONVERSIONS",
    pixelId: d.pixelId,
    event: d.event,
    bidAmount: null,
    budgetType: "daily",
    budget: 0,
    startTime: null,
    endTime: null,
    countries: [d.market],
    ageMin: 18,
    ageMax: 65,
    gender: "all",
    placements: "advantage",
    attribution: "7d_click_1d_view",
    ads: [newAd(d, 1)],
  };
}

export function newEditorDoc(d: EditorDefaults): EditorDoc {
  return {
    campaign: { name: `${d.brand} ${d.market} ${d.date}`, campaignBudget: true, budgetType: "daily", budget: 0, bidStrategy: "LOWEST_COST_WITHOUT_CAP", startTime: null, endTime: null },
    adsets: [newAdset(d, 1)],
  };
}

const copyName = (name: string) => `${name} - Copy`;

/** Ads Manager's Duplicate inside the editor: a full copy with new keys. */
export function duplicateAdset(s: EditorAdset): EditorAdset {
  return { ...structuredClone(s), key: nodeKey("s"), name: copyName(s.name), ads: s.ads.map((a) => ({ ...structuredClone(a), key: nodeKey("a") })) };
}

export function duplicateAd(a: EditorAd): EditorAd {
  return { ...structuredClone(a), key: nodeKey("a"), name: copyName(a.name) };
}

export type EditorIssue = PlanIssue & { node: "campaign" | string };

type Files = Record<string, { ratio: string | null; kind: "image" | "video" }>;

/** Per-node checks, the way Ads Manager flags a field before publishing. */
export function validateEditor(doc: EditorDoc, files: Files): EditorIssue[] {
  const out: EditorIssue[] = [];
  const c = doc.campaign;
  const add = (node: string, level: PlanIssue["level"], message: string) => out.push({ node, level, message });
  if (!c.name.trim()) add("campaign", "error", "Name the campaign.");
  if (c.campaignBudget && c.budget <= 0) add("campaign", "error", "Set the campaign budget.");
  if (c.campaignBudget && c.budgetType === "lifetime" && !c.endTime) add("campaign", "error", "A lifetime budget needs an end date.");
  if (doc.adsets.length === 0) add("campaign", "error", "Add at least one ad set.");
  const needsBidAmount = c.bidStrategy !== "LOWEST_COST_WITHOUT_CAP";
  for (const s of doc.adsets) {
    if (!s.name.trim()) add(s.key, "error", "Name the ad set.");
    if (!c.campaignBudget && s.budget <= 0) add(s.key, "error", "Set the ad set budget.");
    if (!c.campaignBudget && s.budgetType === "lifetime" && !s.endTime) add(s.key, "error", "A lifetime budget needs an end date.");
    if (needsBidAmount && !s.bidAmount) add(s.key, "error", c.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" ? "Set the ROAS goal." : c.bidStrategy === "COST_CAP" ? "Set the cost per result goal." : "Set the bid cap.");
    if (s.countries.length === 0) add(s.key, "error", "Choose at least one location.");
    if (s.ageMin > s.ageMax) add(s.key, "error", "Minimum age is above the maximum.");
    if (Array.isArray(s.placements) && s.placements.length === 0) add(s.key, "error", "Choose at least one placement, or use Advantage+ placements.");
    if (s.endTime && s.startTime && s.endTime <= s.startTime) add(s.key, "error", "The end date is before the start.");
    if (s.ads.length === 0) add(s.key, "error", "Add at least one ad.");
    if (s.ads.length > 50) add(s.key, "error", `${s.ads.length} ads: Meta allows at most 50 per ad set.`);
    for (const a of s.ads) {
      if (!a.name.trim()) add(a.key, "error", "Name the ad.");
      if (!a.pageId) add(a.key, "error", "Choose a Facebook Page.");
      if (a.setup === "existing_post") {
        if (!a.postId?.trim()) add(a.key, "error", "Enter the post ID.");
        continue;
      }
      if (a.creativeIds.length === 0) add(a.key, "error", "Add an image or video.");
      if (a.creativeIds.some((id) => !files[id])) add(a.key, "error", "A file is missing from the library.");
      if (new Set(a.creativeIds.map((id) => files[id]?.kind)).size > 1) add(a.key, "error", "Use either images or videos in one ad, not both.");
      if (!a.primaryTexts.some((t) => t.trim())) add(a.key, "error", "Write the primary text.");
      if (!/^https?:\/\/\S+\.\S+/.test(a.link)) add(a.key, "error", "Enter a website URL starting with https://.");
      const ratios = new Set(a.creativeIds.map((id) => files[id]?.ratio));
      if (a.creativeIds.length && !ratios.has("9:16")) add(a.key, "warning", "No 9:16 version: Stories and Reels will crop it.");
      if (a.primaryTexts.some((t) => t.length > COPY_LIMITS.primaryText)) add(a.key, "warning", `Primary text over ${COPY_LIMITS.primaryText} characters gets cut off in most placements.`);
      if (a.headlines.some((t) => t.length > COPY_LIMITS.headline)) add(a.key, "warning", `Headline over ${COPY_LIMITS.headline} characters gets cut off.`);
    }
    const names = s.ads.map((a) => a.name.trim());
    if (new Set(names).size !== names.length) add(s.key, "error", "Two ads in this ad set have the same name.");
  }
  const setNames = doc.adsets.map((s) => s.name.trim());
  if (new Set(setNames).size !== setNames.length) add("campaign", "error", "Two ad sets have the same name.");
  return out;
}

export function editorHasErrors(issues: EditorIssue[]) {
  return issues.some((i) => i.level === "error");
}

const PLACEMENT_LABELS: Record<string, string> = { "9:16": "Stories, Reels", "4:5": "Feed", "1:1": "Feed, right column", "16:9": "In-stream, Feed" };

/** The runner's plan: same tree, every object carrying its own settings. */
export function editorToPlan(doc: EditorDoc, files: Files): LaunchPlan {
  const c = doc.campaign;
  const campaignBudget = c.campaignBudget ? c.budget : null;
  const adsets: PlannedAdset[] = doc.adsets.map((s) => ({
    key: s.key,
    name: s.name.trim(),
    source: "new",
    dailyBudget: c.campaignBudget ? null : s.budgetType === "daily" ? s.budget : null,
    settings: {
      performanceGoal: s.performanceGoal,
      pixelId: s.pixelId,
      event: s.event,
      bidAmount: s.bidAmount ?? null,
      budgetType: s.budgetType,
      budget: s.budget,
      startTime: s.startTime ?? null,
      endTime: s.endTime ?? null,
      countries: s.countries,
      ageMin: s.ageMin,
      ageMax: s.ageMax,
      gender: s.gender,
      placements: s.placements,
      attribution: s.attribution,
    },
    issues: [],
    ads: s.ads.map((a): PlannedAd => {
      const copy: CopyBlock = {
        primaryTexts: a.primaryTexts.filter((t) => t.trim()),
        headlines: a.headlines.filter((t) => t.trim()),
        descriptions: a.descriptions.filter((t) => t.trim()),
        cta: a.cta,
        link: a.link,
      };
      return {
        key: a.key,
        name: a.name.trim(),
        group: { key: a.key, creativeIds: a.setup === "existing_post" ? [] : a.creativeIds, postId: a.setup === "existing_post" ? (a.postId ?? undefined) : undefined },
        copy,
        creative: { pageId: a.pageId, instagramUserId: a.instagramUserId ?? null, urlTags: a.urlTags ?? null, displayLink: a.displayLink ?? null, features: a.features },
        placements: a.creativeIds.map((id) => ({ creativeId: id, ratio: files[id]?.ratio ?? null, placements: PLACEMENT_LABELS[files[id]?.ratio ?? ""] ?? "Feed" })),
        issues: [],
      };
    }),
  }));
  const ads = adsets.reduce((n, s) => n + s.ads.length, 0);
  const daily = c.campaignBudget ? (c.budgetType === "daily" ? c.budget : 0) : doc.adsets.reduce((sum, s) => sum + (s.budgetType === "daily" ? s.budget : 0), 0);
  return {
    campaign: { source: "new", name: c.name.trim(), dailyBudget: c.campaignBudget && c.budgetType === "daily" ? campaignBudget : null, settings: { ...c } },
    adsets,
    totals: { ads, adsets: adsets.length, dailyBudget: daily },
    issues: [],
  };
}
