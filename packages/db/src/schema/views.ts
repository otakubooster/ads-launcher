import { bigint, date, integer, numeric, pgView, uuid } from "drizzle-orm/pg-core";

/**
 * Metric views, created in migrations/0002_rls_views_triggers.sql with
 * security_invoker so RLS applies. Ratios are computed after summing:
 *   CPA = spend ÷ purchases (minor units)      ROAS = purchase value ÷ spend
 *   CTR = link clicks ÷ impressions            CPM  = spend ÷ impressions × 1,000 (minor units)
 *   Hook rate = 3-second plays ÷ impressions   Hold rate = ThruPlays ÷ impressions
 * Division by zero yields null.
 */
const metrics = () => ({
  date: date("date").notNull(),
  spend: bigint("spend", { mode: "number" }).notNull(),
  impressions: bigint("impressions", { mode: "number" }).notNull(),
  clicks: bigint("clicks", { mode: "number" }).notNull(),
  purchases: integer("purchases").notNull(),
  purchaseValue: bigint("purchase_value", { mode: "number" }).notNull(),
  video3sPlays: bigint("video_3s_plays", { mode: "number" }).notNull(),
  thruplays: bigint("thruplays", { mode: "number" }).notNull(),
  cpa: numeric("cpa", { mode: "number" }),
  roas: numeric("roas", { mode: "number" }),
  ctr: numeric("ctr", { mode: "number" }),
  cpm: numeric("cpm", { mode: "number" }),
  hookRate: numeric("hook_rate", { mode: "number" }),
  holdRate: numeric("hold_rate", { mode: "number" }),
});

const accountId = () => ({ adAccountId: uuid("ad_account_id").notNull() });
const campaignId = () => ({ ...accountId(), campaignId: uuid("campaign_id").notNull() });
const adsetId = () => ({ ...campaignId(), adsetId: uuid("adset_id").notNull() });

export const adInsightsDaily = pgView("ad_insights_daily", {
  ...adsetId(),
  adId: uuid("ad_id").notNull(),
  ...metrics(),
}).existing();

export const adsetInsightsDaily = pgView("adset_insights_daily", { ...adsetId(), ...metrics() }).existing();

export const campaignInsightsDaily = pgView("campaign_insights_daily", { ...campaignId(), ...metrics() }).existing();

export const accountInsightsDaily = pgView("account_insights_daily", { ...accountId(), ...metrics() }).existing();
