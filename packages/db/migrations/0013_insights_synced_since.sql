ALTER TABLE "ad_accounts" ADD COLUMN "insights_synced_since" date;--> statement-breakpoint
-- Start from what is already stored for each account.
UPDATE "ad_accounts" AS a
SET "insights_synced_since" = s.first_day
FROM (
  SELECT ad.ad_account_id, min(i.date) AS first_day
  FROM "insights_daily" i JOIN "meta_ads" ad ON ad.id = i.ad_id
  GROUP BY ad.ad_account_id
) s
WHERE s.ad_account_id = a.id;
