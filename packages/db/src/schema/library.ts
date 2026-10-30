import { sql } from "drizzle-orm";
import {
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import { EDITORS, base, membersCanRead, rolesCanWrite } from "./_shared";
import { aspectRatio, creativeKind, namingLevel, uploadStatus } from "./enums";
import { adAccounts } from "./meta";

const editable = () => [membersCanRead(), ...rolesCanWrite("editors", EDITORS)];

export const brands = pgTable(
  "brands",
  {
    ...base(),
    name: text("name").notNull().unique(),
    logoUrl: text("logo_url"),
    defaultDomain: text("default_domain"),
  },
  editable,
);

/** Tokens: {brand} {market} {angle} {hook} {format} {date} {n}. */
export const namingTemplates = pgTable(
  "naming_templates",
  {
    ...base(),
    level: namingLevel("level").notNull(),
    pattern: text("pattern").notNull(),
  },
  editable,
);

export type AdsetTemplateSpec = {
  optimizationGoal: string;
  billingEvent: string;
  bidStrategy?: string;
  dailyBudget?: number;
  targeting: Record<string, unknown>;
  attributionSpec?: { event_type: string; window_days: number }[];
};

/** Saved by cloning a winning ad set. */
export const adsetTemplates = pgTable(
  "adset_templates",
  {
    ...base(),
    name: text("name").notNull(),
    sourceAdsetId: text("source_adset_id"),
    spec: jsonb("spec").$type<AdsetTemplateSpec>().notNull(),
  },
  editable,
);

/** Advantage+ creative feature → OPT_IN / OPT_OUT. */
export type CreativeFeatures = Record<string, "OPT_IN" | "OPT_OUT">;

/** The one-click "where does this ad go" bundle for a brand × market. */
export const presets = pgTable(
  "presets",
  {
    ...base(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** ISO 3166-1 alpha-2 country code. */
    market: char("market", { length: 2 }).notNull(),
    language: text("language").notNull(),
    adAccountId: uuid("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "restrict" }),
    pageId: text("page_id").notNull(),
    instagramUserId: text("instagram_user_id"),
    pixelId: text("pixel_id").notNull(),
    conversionEvent: text("conversion_event").notNull().default("PURCHASE"),
    linkUrl: text("link_url").notNull(),
    urlTags: text("url_tags"),
    defaultCta: text("default_cta").notNull().default("SHOP_NOW"),
    creativeFeatures: jsonb("creative_features").$type<CreativeFeatures>().notNull().default({}),
    /** Campaign-level naming template. */
    namingTemplateId: uuid("naming_template_id").references(() => namingTemplates.id, { onDelete: "set null" }),
    adsetNamingTemplateId: uuid("adset_naming_template_id").references(() => namingTemplates.id, { onDelete: "set null" }),
    adNamingTemplateId: uuid("ad_naming_template_id").references(() => namingTemplates.id, { onDelete: "set null" }),
    adsetTemplateId: uuid("adset_template_id").references(() => adsetTemplates.id, { onDelete: "set null" }),
  },
  (t) => [unique("presets_brand_market_language").on(t.brandId, t.market, t.language), ...editable()],
);

export type CreativeTags = { angle?: string; hook?: string; format?: string; language?: string };

/** Media library; group_key is the filename stem used to pair ratios. */
export const creatives = pgTable(
  "creatives",
  {
    ...base(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    storagePath: text("storage_path").notNull().unique(),
    kind: creativeKind("kind").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    ratio: aspectRatio("ratio"),
    durationS: numeric("duration_s", { precision: 7, scale: 2, mode: "number" }),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    thumbnailPath: text("thumbnail_path"),
    groupKey: text("group_key").notNull(),
    tags: jsonb("tags").$type<CreativeTags>().notNull().default({}),
  },
  (t) => [
    unique("creatives_brand_sha256").on(t.brandId, t.sha256),
    index("creatives_brand_group_idx").on(t.brandId, t.groupKey),
    ...editable(),
  ],
);

/** Meta media belongs to one ad account, so one row per creative per account. Written by the worker. */
export const creativeUploads = pgTable(
  "creative_uploads",
  {
    ...base(),
    creativeId: uuid("creative_id")
      .notNull()
      .references(() => creatives.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    imageHash: text("image_hash"),
    videoId: text("video_id"),
    /** Meta's preferred video thumbnail; video ads need one (image_url). */
    thumbnailUrl: text("thumbnail_url"),
    status: uploadStatus("status").notNull().default("queued"),
    error: text("error"),
  },
  (t) => [unique("creative_uploads_creative_account").on(t.creativeId, t.adAccountId), membersCanRead()],
);

/** Reusable copy; at most 5 texts per type (Meta's limit). */
export const copySets = pgTable(
  "copy_sets",
  {
    ...base(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    name: text("name").notNull(),
    primaryTexts: text("primary_texts").array().notNull().default(sql`'{}'::text[]`),
    headlines: text("headlines").array().notNull().default(sql`'{}'::text[]`),
    descriptions: text("descriptions").array().notNull().default(sql`'{}'::text[]`),
    ctaType: text("cta_type").notNull().default("SHOP_NOW"),
  },
  () => [
    check(
      "copy_sets_max_5",
      sql`cardinality(primary_texts) <= 5 and cardinality(headlines) <= 5 and cardinality(descriptions) <= 5`,
    ),
    ...editable(),
  ],
);
