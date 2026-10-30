CREATE TYPE "public"."asset_kind" AS ENUM('page', 'instagram', 'pixel');--> statement-breakpoint
CREATE TABLE "meta_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"ad_account_id" uuid,
	"kind" "asset_kind" NOT NULL,
	"meta_id" text NOT NULL,
	"name" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_assets_unique" UNIQUE NULLS NOT DISTINCT("connection_id","kind","meta_id","ad_account_id")
);
--> statement-breakpoint
ALTER TABLE "meta_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_assets" ADD CONSTRAINT "meta_assets_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_assets" ADD CONSTRAINT "meta_assets_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "members can read" ON "meta_assets" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);