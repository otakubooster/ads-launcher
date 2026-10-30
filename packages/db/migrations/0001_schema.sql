CREATE TYPE "public"."aspect_ratio" AS ENUM('9:16', '4:5', '1:1', '16:9');--> statement-breakpoint
CREATE TYPE "public"."change_source" AS ENUM('ui', 'claude', 'system');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('unverified', 'active', 'broken');--> statement-breakpoint
CREATE TYPE "public"."creative_kind" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."entity_level" AS ENUM('campaign', 'adset', 'ad', 'creative', 'ad_account', 'meta_connection', 'preset', 'user');--> statement-breakpoint
CREATE TYPE "public"."launch_item_level" AS ENUM('campaign', 'adset', 'creative', 'ad');--> statement-breakpoint
CREATE TYPE "public"."launch_item_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."launch_mode" AS ENUM('new_campaign', 'existing_campaign', 'existing_adset');--> statement-breakpoint
CREATE TYPE "public"."launch_status" AS ENUM('draft', 'queued', 'running', 'done', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."naming_level" AS ENUM('campaign', 'adset', 'ad');--> statement-breakpoint
CREATE TYPE "public"."table_level" AS ENUM('campaign', 'adset', 'ad');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('queued', 'uploading', 'processing', 'ready', 'error');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'buyer', 'viewer');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"max_budget_change_pct" integer DEFAULT 30 NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_max_budget_change_pct" CHECK (max_budget_change_pct between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"timezone" text NOT NULL,
	"account_status" integer NOT NULL,
	"max_daily_budget" bigint,
	"approval_threshold" bigint,
	"launch_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ad_accounts_meta_id_unique" UNIQUE("meta_id"),
	CONSTRAINT "ad_accounts_meta_id" CHECK (meta_id like 'act\_%'),
	CONSTRAINT "ad_accounts_guardrails" CHECK (max_daily_budget >= 0 and approval_threshold >= 0)
);
--> statement-breakpoint
ALTER TABLE "ad_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acc_util_pct" numeric(5, 2),
	"call_count" integer,
	"total_cputime" integer,
	"total_time" integer,
	"tier" text
);
--> statement-breakpoint
ALTER TABLE "api_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "insights_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ad_id" uuid NOT NULL,
	"date" date NOT NULL,
	"spend" bigint DEFAULT 0 NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"purchases" integer DEFAULT 0 NOT NULL,
	"purchase_value" bigint DEFAULT 0 NOT NULL,
	"video_3s_plays" bigint DEFAULT 0 NOT NULL,
	"thruplays" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "insights_daily_ad_date" UNIQUE("ad_id","date")
);
--> statement-breakpoint
ALTER TABLE "insights_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meta_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta_id" text NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"effective_status" text NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"adset_id" uuid NOT NULL,
	"creative_id" text,
	"thumbnail_url" text,
	CONSTRAINT "meta_ads_meta_id_unique" UNIQUE("meta_id")
);
--> statement-breakpoint
ALTER TABLE "meta_ads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meta_adsets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta_id" text NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"effective_status" text NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"optimization_goal" text,
	"bid_strategy" text,
	"daily_budget" bigint,
	"lifetime_budget" bigint,
	CONSTRAINT "meta_adsets_meta_id_unique" UNIQUE("meta_id")
);
--> statement-breakpoint
ALTER TABLE "meta_adsets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meta_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta_id" text NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"effective_status" text NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"objective" text,
	"bid_strategy" text,
	"daily_budget" bigint,
	"lifetime_budget" bigint,
	CONSTRAINT "meta_campaigns_meta_id_unique" UNIQUE("meta_id")
);
--> statement-breakpoint
ALTER TABLE "meta_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meta_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"business_id" text NOT NULL,
	"business_name" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_last4" char(4) NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "connection_status" DEFAULT 'unverified' NOT NULL,
	"last_verified_at" timestamp with time zone,
	CONSTRAINT "meta_connections_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
ALTER TABLE "meta_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "adset_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"source_adset_id" text,
	"spec" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adset_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"default_domain" text,
	CONSTRAINT "brands_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "copy_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid NOT NULL,
	"language" text NOT NULL,
	"name" text NOT NULL,
	"primary_texts" text[] DEFAULT '{}'::text[] NOT NULL,
	"headlines" text[] DEFAULT '{}'::text[] NOT NULL,
	"descriptions" text[] DEFAULT '{}'::text[] NOT NULL,
	"cta_type" text DEFAULT 'SHOP_NOW' NOT NULL,
	CONSTRAINT "copy_sets_max_5" CHECK (cardinality(primary_texts) <= 5 and cardinality(headlines) <= 5 and cardinality(descriptions) <= 5)
);
--> statement-breakpoint
ALTER TABLE "copy_sets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creative_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"creative_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"image_hash" text,
	"video_id" text,
	"status" "upload_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	CONSTRAINT "creative_uploads_creative_account" UNIQUE("creative_id","ad_account_id")
);
--> statement-breakpoint
ALTER TABLE "creative_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"kind" "creative_kind" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"ratio" "aspect_ratio",
	"duration_s" numeric(7, 2),
	"size_bytes" bigint NOT NULL,
	"sha256" char(64) NOT NULL,
	"thumbnail_path" text,
	"group_key" text NOT NULL,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "creatives_storage_path_unique" UNIQUE("storage_path"),
	CONSTRAINT "creatives_brand_sha256" UNIQUE("brand_id","sha256")
);
--> statement-breakpoint
ALTER TABLE "creatives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "naming_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" "naming_level" NOT NULL,
	"pattern" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "naming_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid NOT NULL,
	"market" char(2) NOT NULL,
	"language" text NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"page_id" text NOT NULL,
	"instagram_user_id" text,
	"pixel_id" text NOT NULL,
	"conversion_event" text DEFAULT 'PURCHASE' NOT NULL,
	"link_url" text NOT NULL,
	"url_tags" text,
	"default_cta" text DEFAULT 'SHOP_NOW' NOT NULL,
	"creative_features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"naming_template_id" uuid,
	"adset_template_id" uuid,
	CONSTRAINT "presets_brand_market_language" UNIQUE("brand_id","market","language")
);
--> statement-breakpoint
ALTER TABLE "presets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "launch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"launch_id" uuid NOT NULL,
	"level" "launch_item_level" NOT NULL,
	"parent_item_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"meta_id" text,
	"status" "launch_item_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" integer,
	"error_message" text,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "launch_items_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "launch_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "launches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"preset_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"mode" "launch_mode" NOT NULL,
	"structure" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "launch_status" DEFAULT 'draft' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "launches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"source" "change_source" NOT NULL,
	"entity_level" "entity_level" NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"meta_response" jsonb
);
--> statement-breakpoint
ALTER TABLE "change_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" "table_level" NOT NULL,
	"columns" text[] DEFAULT '{}'::text[] NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights_daily" ADD CONSTRAINT "insights_daily_ad_id_meta_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."meta_ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_campaign_id_meta_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."meta_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_adset_id_meta_adsets_id_fk" FOREIGN KEY ("adset_id") REFERENCES "public"."meta_adsets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_adsets" ADD CONSTRAINT "meta_adsets_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_adsets" ADD CONSTRAINT "meta_adsets_campaign_id_meta_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."meta_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_campaigns" ADD CONSTRAINT "meta_campaigns_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_sets" ADD CONSTRAINT "copy_sets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_uploads" ADD CONSTRAINT "creative_uploads_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_uploads" ADD CONSTRAINT "creative_uploads_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presets" ADD CONSTRAINT "presets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presets" ADD CONSTRAINT "presets_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presets" ADD CONSTRAINT "presets_naming_template_id_naming_templates_id_fk" FOREIGN KEY ("naming_template_id") REFERENCES "public"."naming_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presets" ADD CONSTRAINT "presets_adset_template_id_adset_templates_id_fk" FOREIGN KEY ("adset_template_id") REFERENCES "public"."adset_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_items" ADD CONSTRAINT "launch_items_launch_id_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."launches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_items" ADD CONSTRAINT "launch_items_parent_item_id_launch_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."launch_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launches" ADD CONSTRAINT "launches_preset_id_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."presets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launches" ADD CONSTRAINT "launches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_usage_account_recorded_idx" ON "api_usage" USING btree ("ad_account_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "insights_daily_date_idx" ON "insights_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "meta_ads_account_idx" ON "meta_ads" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "meta_ads_adset_idx" ON "meta_ads" USING btree ("adset_id");--> statement-breakpoint
CREATE INDEX "meta_adsets_account_idx" ON "meta_adsets" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "meta_adsets_campaign_idx" ON "meta_adsets" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "meta_campaigns_account_idx" ON "meta_campaigns" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "creatives_brand_group_idx" ON "creatives" USING btree ("brand_id","group_key");--> statement-breakpoint
CREATE INDEX "launch_items_launch_idx" ON "launch_items" USING btree ("launch_id");--> statement-breakpoint
CREATE INDEX "launches_created_idx" ON "launches" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "change_log_entity_idx" ON "change_log" USING btree ("entity_level","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "change_log_created_idx" ON "change_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "saved_views_user_idx" ON "saved_views" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "members can read" ON "users" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "managers can insert" ON "users" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((select app.has_role('owner')) or ((select app.has_role('admin')) and role <> 'owner')));--> statement-breakpoint
CREATE POLICY "managers can update" ON "users" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((select app.has_role('owner')) or ((select app.has_role('admin')) and role <> 'owner'))) WITH CHECK (((select app.has_role('owner')) or ((select app.has_role('admin')) and role <> 'owner')));--> statement-breakpoint
CREATE POLICY "managers can delete others" ON "users" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((select app.has_role('owner')) or ((select app.has_role('admin')) and role <> 'owner')) and id <> (select auth.uid()));--> statement-breakpoint
CREATE POLICY "members can read" ON "ad_accounts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "managers can update guardrails" ON "ad_accounts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select app.has_role('owner', 'admin'))) WITH CHECK ((select app.has_role('owner', 'admin')));--> statement-breakpoint
CREATE POLICY "members can read" ON "api_usage" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "members can read" ON "insights_daily" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "members can read" ON "meta_ads" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "members can read" ON "meta_adsets" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "members can read" ON "meta_campaigns" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "members can read" ON "meta_connections" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "owners can insert" ON "meta_connections" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select app.has_role('owner')));--> statement-breakpoint
CREATE POLICY "owners can update" ON "meta_connections" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select app.has_role('owner'))) WITH CHECK ((select app.has_role('owner')));--> statement-breakpoint
CREATE POLICY "owners can delete" ON "meta_connections" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select app.has_role('owner')));--> statement-breakpoint
CREATE POLICY "members can read" ON "adset_templates" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "editors can insert" ON "adset_templates" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "editors can update" ON "adset_templates" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer'))) WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "editors can delete" ON "adset_templates" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "members can read" ON "brands" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "editors can insert" ON "brands" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "editors can update" ON "brands" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer'))) WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "editors can delete" ON "brands" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "members can read" ON "copy_sets" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "editors can insert" ON "copy_sets" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "editors can update" ON "copy_sets" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer'))) WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "editors can delete" ON "copy_sets" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "members can read" ON "creative_uploads" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "members can read" ON "creatives" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "editors can insert" ON "creatives" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "editors can update" ON "creatives" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer'))) WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "editors can delete" ON "creatives" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "members can read" ON "naming_templates" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "editors can insert" ON "naming_templates" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "editors can update" ON "naming_templates" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer'))) WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "editors can delete" ON "naming_templates" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "members can read" ON "presets" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "editors can insert" ON "presets" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "editors can update" ON "presets" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer'))) WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "editors can delete" ON "presets" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer')));--> statement-breakpoint
CREATE POLICY "members can read" ON "launch_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "editors can add items to drafts" ON "launch_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')) and exists (
  select 1 from public.launches l
  where l.id = launch_id and l.status = 'draft' and (l.created_by = (select auth.uid()) or (select app.has_role('owner', 'admin')))
));--> statement-breakpoint
CREATE POLICY "editors can edit items in drafts" ON "launch_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer')) and exists (
  select 1 from public.launches l
  where l.id = launch_id and l.status = 'draft' and (l.created_by = (select auth.uid()) or (select app.has_role('owner', 'admin')))
)) WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')) and exists (
  select 1 from public.launches l
  where l.id = launch_id and l.status = 'draft' and (l.created_by = (select auth.uid()) or (select app.has_role('owner', 'admin')))
));--> statement-breakpoint
CREATE POLICY "editors can remove items from drafts" ON "launch_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer')) and exists (
  select 1 from public.launches l
  where l.id = launch_id and l.status = 'draft' and (l.created_by = (select auth.uid()) or (select app.has_role('owner', 'admin')))
));--> statement-breakpoint
CREATE POLICY "members can read" ON "launches" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "editors can create own drafts" ON "launches" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')) and created_by = (select auth.uid()) and status = 'draft');--> statement-breakpoint
CREATE POLICY "authors and managers can edit drafts" ON "launches" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer')) and status = 'draft' and (created_by = (select auth.uid()) or (select app.has_role('owner', 'admin')))) WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')) and status in ('draft', 'queued') and (created_by = (select auth.uid()) or (select app.has_role('owner', 'admin'))));--> statement-breakpoint
CREATE POLICY "authors and managers can delete drafts" ON "launches" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select app.has_role('owner', 'admin', 'buyer')) and status = 'draft' and (created_by = (select auth.uid()) or (select app.has_role('owner', 'admin'))));--> statement-breakpoint
CREATE POLICY "members can read" ON "change_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "editors can append their own changes" ON "change_log" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')) and actor_id = (select auth.uid()) and source in ('ui', 'claude'));--> statement-breakpoint
CREATE POLICY "members manage their own views" ON "saved_views" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select app.current_user_role()) is not null and user_id = (select auth.uid())) WITH CHECK ((select app.current_user_role()) is not null and user_id = (select auth.uid()));