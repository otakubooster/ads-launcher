-- Triggers, column-level grants and metric views. Policies live in the
-- Drizzle schema (src/schema) and were created by 0001.

-- updated_at on every public table that has one.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()',
      t.table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- change_log is append-only for everyone, the service role included.
CREATE TRIGGER change_log_append_only BEFORE UPDATE OR DELETE ON public.change_log
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
--> statement-breakpoint
CREATE TRIGGER change_log_no_truncate BEFORE TRUNCATE ON public.change_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_change();
--> statement-breakpoint

-- Metric views. security_invoker makes RLS apply to the caller.
CREATE VIEW public.ad_insights_daily WITH (security_invoker = true) AS
SELECT
  a.ad_account_id, a.campaign_id, a.adset_id, i.ad_id, i.date,
  i.spend, i.impressions, i.clicks, i.purchases, i.purchase_value, i.video_3s_plays, i.thruplays,
  app.safe_div(i.spend, i.purchases) AS cpa,
  app.safe_div(i.purchase_value, i.spend) AS roas,
  app.safe_div(i.clicks, i.impressions) AS ctr,
  app.safe_div(i.spend * 1000, i.impressions) AS cpm,
  app.safe_div(i.video_3s_plays, i.impressions) AS hook_rate,
  app.safe_div(i.thruplays, i.impressions) AS hold_rate
FROM public.insights_daily i
JOIN public.meta_ads a ON a.id = i.ad_id;
--> statement-breakpoint

CREATE VIEW public.adset_insights_daily WITH (security_invoker = true) AS
SELECT
  ad_account_id, campaign_id, adset_id, date,
  sum(spend)::bigint AS spend, sum(impressions)::bigint AS impressions, sum(clicks)::bigint AS clicks,
  sum(purchases)::integer AS purchases, sum(purchase_value)::bigint AS purchase_value,
  sum(video_3s_plays)::bigint AS video_3s_plays, sum(thruplays)::bigint AS thruplays,
  app.safe_div(sum(spend), sum(purchases)) AS cpa,
  app.safe_div(sum(purchase_value), sum(spend)) AS roas,
  app.safe_div(sum(clicks), sum(impressions)) AS ctr,
  app.safe_div(sum(spend) * 1000, sum(impressions)) AS cpm,
  app.safe_div(sum(video_3s_plays), sum(impressions)) AS hook_rate,
  app.safe_div(sum(thruplays), sum(impressions)) AS hold_rate
FROM public.ad_insights_daily
GROUP BY ad_account_id, campaign_id, adset_id, date;
--> statement-breakpoint

CREATE VIEW public.campaign_insights_daily WITH (security_invoker = true) AS
SELECT
  ad_account_id, campaign_id, date,
  sum(spend)::bigint AS spend, sum(impressions)::bigint AS impressions, sum(clicks)::bigint AS clicks,
  sum(purchases)::integer AS purchases, sum(purchase_value)::bigint AS purchase_value,
  sum(video_3s_plays)::bigint AS video_3s_plays, sum(thruplays)::bigint AS thruplays,
  app.safe_div(sum(spend), sum(purchases)) AS cpa,
  app.safe_div(sum(purchase_value), sum(spend)) AS roas,
  app.safe_div(sum(clicks), sum(impressions)) AS ctr,
  app.safe_div(sum(spend) * 1000, sum(impressions)) AS cpm,
  app.safe_div(sum(video_3s_plays), sum(impressions)) AS hook_rate,
  app.safe_div(sum(thruplays), sum(impressions)) AS hold_rate
FROM public.ad_insights_daily
GROUP BY ad_account_id, campaign_id, date;
--> statement-breakpoint

CREATE VIEW public.account_insights_daily WITH (security_invoker = true) AS
SELECT
  ad_account_id, date,
  sum(spend)::bigint AS spend, sum(impressions)::bigint AS impressions, sum(clicks)::bigint AS clicks,
  sum(purchases)::integer AS purchases, sum(purchase_value)::bigint AS purchase_value,
  sum(video_3s_plays)::bigint AS video_3s_plays, sum(thruplays)::bigint AS thruplays,
  app.safe_div(sum(spend), sum(purchases)) AS cpa,
  app.safe_div(sum(purchase_value), sum(spend)) AS roas,
  app.safe_div(sum(clicks), sum(impressions)) AS ctr,
  app.safe_div(sum(spend) * 1000, sum(impressions)) AS cpm,
  app.safe_div(sum(video_3s_plays), sum(impressions)) AS hook_rate,
  app.safe_div(sum(thruplays), sum(impressions)) AS hold_rate
FROM public.ad_insights_daily
GROUP BY ad_account_id, date;
--> statement-breakpoint

-- Privileges. Supabase grants ALL on new public tables to anon, authenticated
-- and service_role by default; narrow that here. RLS still applies on top.
GRANT USAGE ON SCHEMA app TO authenticated, service_role;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO authenticated, service_role;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
--> statement-breakpoint

-- Token ciphertext and IV are never selectable by app users, owners included.
REVOKE SELECT ON public.meta_connections FROM authenticated;
--> statement-breakpoint
GRANT SELECT (id, created_at, updated_at, business_id, business_name, token_last4, scopes, status, last_verified_at)
  ON public.meta_connections TO authenticated;
--> statement-breakpoint

-- Ad accounts are synced by the worker; app users may only change guardrails.
REVOKE INSERT, UPDATE, DELETE ON public.ad_accounts FROM authenticated;
--> statement-breakpoint
GRANT UPDATE (max_daily_budget, approval_threshold, launch_enabled) ON public.ad_accounts TO authenticated;
--> statement-breakpoint

REVOKE UPDATE, DELETE, TRUNCATE ON public.change_log FROM authenticated;
