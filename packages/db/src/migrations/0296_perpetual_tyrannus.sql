CREATE TABLE "marketing_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"name" text NOT NULL,
	"account_id" text NOT NULL,
	"account_url" text NOT NULL,
	"concept" text NOT NULL,
	"tone" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT '' NOT NULL,
	"writing_rules" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"content" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content_hash" text NOT NULL,
	"generation_issue_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aside_account_id" text NOT NULL,
	"browser_profile_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_publish_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"external_session_id" text,
	"posted_url" text,
	"last_error" text,
	"evidence" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketing_channels" ADD CONSTRAINT "marketing_channels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_channels" ADD CONSTRAINT "marketing_channels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_channels" ADD CONSTRAINT "marketing_channels_profile_id_marketing_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."marketing_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_drafts" ADD CONSTRAINT "marketing_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_drafts" ADD CONSTRAINT "marketing_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_drafts" ADD CONSTRAINT "marketing_drafts_channel_id_marketing_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."marketing_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_drafts" ADD CONSTRAINT "marketing_drafts_generation_issue_id_issues_id_fk" FOREIGN KEY ("generation_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_profiles" ADD CONSTRAINT "marketing_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_profiles" ADD CONSTRAINT "marketing_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_publish_jobs" ADD CONSTRAINT "marketing_publish_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_publish_jobs" ADD CONSTRAINT "marketing_publish_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_publish_jobs" ADD CONSTRAINT "marketing_publish_jobs_profile_id_marketing_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."marketing_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_publish_jobs" ADD CONSTRAINT "marketing_publish_jobs_channel_id_marketing_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."marketing_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_publish_jobs" ADD CONSTRAINT "marketing_publish_jobs_draft_id_marketing_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."marketing_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_channels_company_project_idx" ON "marketing_channels" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_channels_account_uq" ON "marketing_channels" USING btree ("company_id","project_id","platform","account_id");--> statement-breakpoint
CREATE INDEX "marketing_drafts_company_channel_idx" ON "marketing_drafts" USING btree ("company_id","channel_id");--> statement-breakpoint
CREATE INDEX "marketing_profiles_company_project_idx" ON "marketing_profiles" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_profiles_binding_uq" ON "marketing_profiles" USING btree ("company_id","project_id","aside_account_id");--> statement-breakpoint
CREATE INDEX "marketing_jobs_company_status_idx" ON "marketing_publish_jobs" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_jobs_draft_revision_uq" ON "marketing_publish_jobs" USING btree ("company_id","draft_id","revision");