CREATE TYPE "public"."approval_kind" AS ENUM('activate', 'budget', 'launch_activate');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"recipients" text[] NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "alerts_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"kind" "approval_kind" NOT NULL,
	"entity_level" "entity_level",
	"entity_id" uuid NOT NULL,
	"entity_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"increase" bigint NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_created_idx" ON "alerts" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "managers can read" ON "alerts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.has_role('owner', 'admin')));--> statement-breakpoint
CREATE POLICY "members can read" ON "app_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "owners can insert" ON "app_settings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select app.has_role('owner')));--> statement-breakpoint
CREATE POLICY "owners can update" ON "app_settings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select app.has_role('owner'))) WITH CHECK ((select app.has_role('owner')));--> statement-breakpoint
CREATE POLICY "members can read" ON "approval_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select app.current_user_role()) is not null);--> statement-breakpoint
CREATE POLICY "editors request for themselves" ON "approval_requests" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select app.has_role('owner', 'admin', 'buyer')) and requested_by = (select auth.uid()) and status = 'pending');--> statement-breakpoint
CREATE POLICY "managers decide" ON "approval_requests" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select app.has_role('owner', 'admin')) and status = 'pending') WITH CHECK ((select app.has_role('owner', 'admin')) and decided_by = (select auth.uid()));