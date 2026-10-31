import { renderName, type NamingValues } from "./naming";

/**
 * The launch draft (launches.structure) and the plan built from it: the exact
 * tree of objects a launch creates. Pure and browser-safe, so the Review step
 * shows precisely what the runner will create.
 */

export type GroupingMode = "per_creative" | "per_angle" | "all_in_one" | "n_per_adset";
export type LaunchMode = "new_campaign" | "existing_campaign" | "existing_adset";

export type DraftCreativeGroup = {
  key: string;
  creativeIds: string[];
  angle?: string;
  hook?: string;
  format?: string;
  /** Reuse an existing page post (keeps its likes and comments) instead of a new creative. */
  postId?: string;
};

export type CopyBlock = {
  primaryTexts: string[];
  headlines: string[];
  descriptions: string[];
  cta: string;
  link: string;
};

export type LaunchDraft = {
  destination: {
    mode: LaunchMode;
    /** Mirror uuid of the campaign, for existing_campaign. */
    campaignId?: string | null;
    /** Mirror uuids of the ad sets, for existing_adset. */
    adsetIds?: string[];
    adsetTemplateId?: string | null;
    /** Mirror uuid of a live ad set to copy settings from (POST /{id}/copies). */
    cloneAdsetId?: string | null;
    budgetType: "campaign" | "adset";
    /** Daily budget in the account's minor unit: per campaign (CBO) or per ad set (ABO). */
    dailyBudget: number;
    countries: string[];
  };
  creatives: { groups: DraftCreativeGroup[] };
  copy: CopyBlock & { copySetId?: string | null; overrides: Record<string, Partial<CopyBlock>> };
  structure: {
    grouping: GroupingMode;
    perAdset: number;
    naming: { campaign: string; adset: string; ad: string };
    features: Record<string, "OPT_IN" | "OPT_OUT">;
    start: "paused" | "scheduled";
    startTime?: string | null;
  };
  /** Owner/admin "Create & activate": everything is still created paused, then activated. */
  activateAfter?: boolean;
};

export const EMPTY_DRAFT: LaunchDraft = {
  destination: { mode: "new_campaign", budgetType: "campaign", dailyBudget: 0, countries: [], adsetIds: [] },
  creatives: { groups: [] },
  copy: { primaryTexts: [""], headlines: [""], descriptions: [], cta: "SHOP_NOW", link: "", overrides: {} },
  structure: { grouping: "per_angle", perAdset: 3, naming: { campaign: "{brand}_{market}_{date}", adset: "{brand}_{market}_{angle}_{n}", ad: "{hook}_{format}_{n}" }, features: {}, start: "paused" },
};

/** What the plan needs to know about the world, gathered by the caller. */
export type PlanContext = {
  brand: string;
  market: string;
  /** YYYY-MM-DD in the account's time zone. */
  date: string;
  currency: string;
  /** Creative id → its ratio and kind, for placement mapping and checks. */
  creatives: Record<string, { ratio: string | null; kind: "image" | "video"; fileName: string }>;
  existingCampaign?: { metaId: string; name: string; hasBudget: boolean } | null;
  existingAdsets?: { id: string; metaId: string; name: string }[];
  cloneAdset?: { metaId: string; name: string } | null;
};

/** Meta's hard limit on ads in one ad set. */
export const MAX_ADS_PER_ADSET = 50;

export type PlanIssue = { level: "error" | "warning"; message: string };

export type PlannedAd = {
  key: string;
  name: string;
  group: DraftCreativeGroup;
  copy: CopyBlock;
  /** "Stories, Reels" / "Feed" per file. */
  placements: { creativeId: string; ratio: string | null; placements: string }[];
  issues: PlanIssue[];
};

export type PlannedAdset = {
  key: string;
  name: string;
  /** "new" (from the template), "clone" (copy of a live ad set) or "existing". */
  source: "new" | "clone" | "existing";
  existingMetaId?: string;
  dailyBudget: number | null;
  ads: PlannedAd[];
  issues: PlanIssue[];
};

export type LaunchPlan = {
  campaign: { source: "new" | "existing"; name: string; metaId?: string; dailyBudget: number | null };
  adsets: PlannedAdset[];
  totals: { ads: number; adsets: number; dailyBudget: number };
  issues: PlanIssue[];
};

const RATIO_ORDER = ["9:16", "4:5", "1:1", "16:9"];
const PLACEMENTS: Record<string, string> = { "9:16": "Stories, Reels", "4:5": "Feed", "1:1": "Feed, right column", "16:9": "In-stream, Feed" };

function copyFor(draft: LaunchDraft, group: DraftCreativeGroup): CopyBlock {
  const o = draft.copy.overrides[group.key] ?? {};
  const pick = <K extends keyof CopyBlock>(k: K) => (o[k] !== undefined && (Array.isArray(o[k]) ? (o[k] as string[]).some(Boolean) : o[k]) ? (o[k] as CopyBlock[K]) : draft.copy[k]);
  return {
    primaryTexts: pick("primaryTexts").filter(Boolean),
    headlines: pick("headlines").filter(Boolean),
    descriptions: pick("descriptions").filter(Boolean),
    cta: pick("cta"),
    link: pick("link"),
  };
}

function chunk<T>(list: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Builds the object tree, names and checks from a draft. */
export function buildPlan(draft: LaunchDraft, ctx: PlanContext): LaunchPlan {
  const issues: PlanIssue[] = [];
  const { destination: d, structure: s } = draft;
  const base: NamingValues = { brand: ctx.brand, market: ctx.market, date: ctx.date };
  const groups = draft.creatives.groups.filter((g) => g.creativeIds.length > 0 || g.postId);

  if (groups.length === 0) issues.push({ level: "error", message: "Add at least one creative." });
  if (!draft.copy.link && !groups.every((g) => g.postId)) issues.push({ level: "error", message: "Add a link." });
  if (d.mode !== "existing_adset" && d.dailyBudget <= 0) issues.push({ level: "error", message: "Set a daily budget." });
  if (d.mode === "existing_campaign" && !ctx.existingCampaign) issues.push({ level: "error", message: "Pick the campaign to add ad sets to." });
  if (d.mode === "existing_adset" && !(ctx.existingAdsets?.length)) issues.push({ level: "error", message: "Pick at least one ad set." });
  if (s.start === "scheduled" && !s.startTime) issues.push({ level: "error", message: "Pick a start time, or start paused." });

  const campaign =
    d.mode === "new_campaign"
      ? { source: "new" as const, name: renderName(s.naming.campaign, base) || `${ctx.brand}_${ctx.market}_${ctx.date}`, dailyBudget: d.budgetType === "campaign" ? d.dailyBudget : null }
      : { source: "existing" as const, name: ctx.existingCampaign?.name ?? "—", metaId: ctx.existingCampaign?.metaId, dailyBudget: null };

  // Ad set buckets from the grouping choice.
  let buckets: { label: { angle?: string }; groups: DraftCreativeGroup[] }[];
  if (d.mode === "existing_adset") {
    buckets = [];
  } else if (s.grouping === "per_creative") {
    buckets = groups.map((g) => ({ label: { angle: g.angle }, groups: [g] }));
  } else if (s.grouping === "per_angle") {
    const byAngle = new Map<string, DraftCreativeGroup[]>();
    for (const g of groups) byAngle.set(g.angle || "untagged", [...(byAngle.get(g.angle || "untagged") ?? []), g]);
    buckets = [...byAngle].map(([angle, gs]) => ({ label: { angle: angle === "untagged" ? undefined : angle }, groups: gs }));
  } else if (s.grouping === "n_per_adset") {
    buckets = chunk(groups, Math.max(1, s.perAdset)).map((gs) => ({ label: { angle: gs[0]?.angle }, groups: gs }));
  } else {
    buckets = [{ label: {}, groups }];
  }

  const plannedAd = (g: DraftCreativeGroup, n: number, key: string): PlannedAd => {
    const copy = copyFor(draft, g);
    const adIssues: PlanIssue[] = [];
    const files = g.creativeIds.map((id) => ({ id, ...ctx.creatives[id] }));
    if (!g.postId) {
      if (copy.primaryTexts.length === 0) adIssues.push({ level: "error", message: "Primary text is empty." });
      if (files.some((f) => !f.kind)) adIssues.push({ level: "error", message: "A creative is missing from the library." });
      const ratios = new Set(files.map((f) => f.ratio));
      if (!ratios.has("9:16")) adIssues.push({ level: "warning", message: "No 9:16 version: Stories and Reels will crop it." });
      if (!ratios.has("4:5") && !ratios.has("1:1")) adIssues.push({ level: "warning", message: "No 4:5 version: Feed will use the vertical file." });
      if (new Set(files.map((f) => f.kind)).size > 1) adIssues.push({ level: "error", message: "Mix of images and videos in one creative." });
    }
    return {
      key,
      name: renderName(s.naming.ad, { ...base, angle: g.angle, hook: g.hook || g.key, format: g.format, n }) || `${g.key}_${n}`,
      group: g,
      copy,
      placements: files
        .map((f) => ({ creativeId: f.id, ratio: f.ratio ?? null, placements: f.ratio ? (PLACEMENTS[f.ratio] ?? "Feed") : "Feed" }))
        .sort((a, b) => RATIO_ORDER.indexOf(a.ratio ?? "") - RATIO_ORDER.indexOf(b.ratio ?? "")),
      issues: adIssues,
    };
  };

  let adsets: PlannedAdset[];
  if (d.mode === "existing_adset") {
    // Every creative goes into each chosen ad set.
    adsets = (ctx.existingAdsets ?? []).map((a, i) => ({
      key: `adset-${i}`,
      name: a.name,
      source: "existing",
      existingMetaId: a.metaId,
      dailyBudget: null,
      ads: groups.map((g, j) => plannedAd(g, j + 1, `adset-${i}-ad-${j}`)),
      issues: [],
    }));
  } else {
    const perAdsetBudget = d.mode === "existing_campaign" ? (ctx.existingCampaign?.hasBudget ? null : d.dailyBudget) : d.budgetType === "adset" ? d.dailyBudget : null;
    adsets = buckets.map((b, i) => ({
      key: `adset-${i}`,
      name: renderName(s.naming.adset, { ...base, angle: b.label.angle, n: i + 1 }) || `${ctx.brand}_${ctx.market}_${i + 1}`,
      source: ctx.cloneAdset ? "clone" : "new",
      dailyBudget: perAdsetBudget,
      ads: b.groups.map((g, j) => plannedAd(g, j + 1, `adset-${i}-ad-${j}`)),
      issues: [],
    }));
  }

  // Names must be unique within a parent so retries can find objects by name.
  for (const a of adsets) {
    const seen = new Map<string, number>();
    for (const ad of a.ads) {
      const count = (seen.get(ad.name) ?? 0) + 1;
      seen.set(ad.name, count);
      if (count > 1) ad.name = `${ad.name}_${count}`;
    }
  }
  const seenSets = new Map<string, number>();
  for (const a of adsets) {
    if (a.source === "existing") continue;
    const count = (seenSets.get(a.name) ?? 0) + 1;
    seenSets.set(a.name, count);
    if (count > 1) a.name = `${a.name}_${count}`;
  }

  const ads = adsets.reduce((n, a) => n + a.ads.length, 0);
  // Meta refuses a 51st ad in an ad set.
  for (const a of adsets.filter((x) => x.ads.length > MAX_ADS_PER_ADSET)) {
    a.issues.push({ level: "error", message: `${a.ads.length} ads: Meta allows at most ${MAX_ADS_PER_ADSET} per ad set. Group by angle, or use "N ads per ad set".` });
  }
  if (adsets.some((a) => a.ads.length > MAX_ADS_PER_ADSET)) issues.push({ level: "error", message: `An ad set has more than ${MAX_ADS_PER_ADSET} ads. Change the grouping in Structure.` });
  const dailyBudget = campaign.dailyBudget ?? adsets.reduce((sum, a) => sum + (a.dailyBudget ?? 0), 0);
  return { campaign, adsets, totals: { ads, adsets: adsets.length, dailyBudget }, issues };
}

export function planHasErrors(plan: LaunchPlan) {
  return plan.issues.some((i) => i.level === "error") || plan.adsets.some((a) => a.issues.some((i) => i.level === "error") || a.ads.some((ad) => ad.issues.some((i) => i.level === "error")));
}
