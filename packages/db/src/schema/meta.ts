import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";
import { MANAGERS, base, hasRole, membersCanRead, money, rolesCanWrite } from "./_shared";
import { assetKind, connectionStatus } from "./enums";

/**
 * One per Business Manager. The token is AES-256-GCM encrypted by server code;
 * ciphertext and IV are not selectable by app users (column grants in 0002).
 */
export const metaConnections = pgTable(
  "meta_connections",
  {
    ...base(),
    businessId: text("business_id").notNull().unique(),
    businessName: text("business_name").notNull(),
    /** base64 ciphertext with the 16-byte GCM auth tag appended. */
    tokenCiphertext: text("token_ciphertext").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenLast4: char("token_last4", { length: 4 }).notNull(),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    status: connectionStatus("status").notNull().default("unverified"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  },
  () => [membersCanRead(), ...rolesCanWrite("owners", ["owner"])],
);

/** Synced from Meta by the worker; app users may only edit the guardrail columns. */
export const adAccounts = pgTable(
  "ad_accounts",
  {
    ...base(),
    metaId: text("meta_id").notNull().unique(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => metaConnections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    timezone: text("timezone").notNull(),
    /** Meta's numeric account_status (1 = active, 2 = disabled, …). */
    accountStatus: integer("account_status").notNull(),
    maxDailyBudget: money("max_daily_budget"),
    approvalThreshold: money("approval_threshold"),
    launchEnabled: boolean("launch_enabled").notNull().default(false),
  },
  () => [
    check("ad_accounts_meta_id", sql`meta_id like 'act\\_%'`),
    check("ad_accounts_guardrails", sql`max_daily_budget >= 0 and approval_threshold >= 0`),
    membersCanRead(),
    // Column grants (0002) limit this to max_daily_budget, approval_threshold, launch_enabled.
    pgPolicy("managers can update guardrails", {
      for: "update",
      to: authenticatedRole,
      using: hasRole(...MANAGERS),
      withCheck: hasRole(...MANAGERS),
    }),
  ],
);

const mirror = () => ({
  ...base(),
  metaId: text("meta_id").notNull().unique(),
  adAccountId: uuid("ad_account_id")
    .notNull()
    .references(() => adAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Meta's configured status: ACTIVE, PAUSED, DELETED, ARCHIVED. */
  status: text("status").notNull(),
  /** What Meta is actually doing: ACTIVE, ADSET_PAUSED, DISAPPROVED, IN_PROCESS, WITH_ISSUES, … */
  effectiveStatus: text("effective_status").notNull(),
  raw: jsonb("raw").notNull().default({}),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const metaCampaigns = pgTable(
  "meta_campaigns",
  {
    ...mirror(),
    objective: text("objective"),
    bidStrategy: text("bid_strategy"),
    dailyBudget: money("daily_budget"),
    lifetimeBudget: money("lifetime_budget"),
  },
  (t) => [index("meta_campaigns_account_idx").on(t.adAccountId), membersCanRead()],
);

export const metaAdsets = pgTable(
  "meta_adsets",
  {
    ...mirror(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => metaCampaigns.id, { onDelete: "cascade" }),
    optimizationGoal: text("optimization_goal"),
    bidStrategy: text("bid_strategy"),
    dailyBudget: money("daily_budget"),
    lifetimeBudget: money("lifetime_budget"),
  },
  (t) => [
    index("meta_adsets_account_idx").on(t.adAccountId),
    index("meta_adsets_campaign_idx").on(t.campaignId),
    membersCanRead(),
  ],
);

export const metaAds = pgTable(
  "meta_ads",
  {
    ...mirror(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => metaCampaigns.id, { onDelete: "cascade" }),
    adsetId: uuid("adset_id")
      .notNull()
      .references(() => metaAdsets.id, { onDelete: "cascade" }),
    /** Meta's ad creative id. */
    creativeId: text("creative_id"),
    thumbnailUrl: text("thumbnail_url"),
  },
  (t) => [
    index("meta_ads_account_idx").on(t.adAccountId),
    index("meta_ads_adset_idx").on(t.adsetId),
    membersCanRead(),
  ],
);

/** One row per ad per day; ratios live in the views (migrations/0002). */
export const insightsDaily = pgTable(
  "insights_daily",
  {
    ...base(),
    adId: uuid("ad_id")
      .notNull()
      .references(() => metaAds.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    spend: money("spend").notNull().default(0),
    impressions: money("impressions").notNull().default(0),
    /** Inline link clicks. */
    clicks: money("clicks").notNull().default(0),
    purchases: integer("purchases").notNull().default(0),
    purchaseValue: money("purchase_value").notNull().default(0),
    video3sPlays: money("video_3s_plays").notNull().default(0),
    thruplays: money("thruplays").notNull().default(0),
  },
  (t) => [unique("insights_daily_ad_date").on(t.adId, t.date), index("insights_daily_date_idx").on(t.date), membersCanRead()],
);

/** From Meta's X-Ad-Account-Usage and X-Business-Use-Case-Usage headers. */
export const apiUsage = pgTable(
  "api_usage",
  {
    ...base(),
    adAccountId: uuid("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    accUtilPct: numeric("acc_util_pct", { precision: 5, scale: 2, mode: "number" }),
    callCount: integer("call_count"),
    totalCputime: integer("total_cputime"),
    totalTime: integer("total_time"),
    tier: text("tier"),
  },
  (t) => [index("api_usage_account_recorded_idx").on(t.adAccountId, t.recordedAt.desc()), membersCanRead()],
);

/**
 * Pages, Instagram accounts and pixels a connection can use, synced with the
 * ad accounts. Pages belong to the Business Manager; Instagram accounts and
 * pixels are listed per ad account. Not in the spec's data model; the presets
 * screen and the week 1 check need them stored.
 */
export const metaAssets = pgTable(
  "meta_assets",
  {
    ...base(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => metaConnections.id, { onDelete: "cascade" }),
    adAccountId: uuid("ad_account_id").references(() => adAccounts.id, { onDelete: "cascade" }),
    kind: assetKind("kind").notNull(),
    metaId: text("meta_id").notNull(),
    name: text("name").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("meta_assets_unique").on(t.connectionId, t.kind, t.metaId, t.adAccountId).nullsNotDistinct(),
    membersCanRead(),
  ],
);
