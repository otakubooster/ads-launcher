ALTER TABLE "insights_daily" ADD COLUMN "add_to_cart" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "insights_daily" ADD COLUMN "checkouts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "insights_daily" ADD COLUMN "results" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "insights_daily" ADD COLUMN "actions" jsonb DEFAULT '{}'::jsonb NOT NULL;