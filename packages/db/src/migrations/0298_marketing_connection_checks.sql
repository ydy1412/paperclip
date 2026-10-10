CREATE TABLE "marketing_connection_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"target" jsonb NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"aside_session_id" text,
	"preparation_intent_at" timestamp with time zone,
	"request_intent_at" timestamp with time zone,
	"observation" jsonb,
	"raw_decision" jsonb,
	"applied_status" text,
	"reason" text,
	"lease_owner" uuid,
	"lease_until" timestamp with time zone,
	"next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
	"poll_failures" integer DEFAULT 0 NOT NULL,
	"result_received_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_connection_monitors" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"next_check_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketing_channels" ADD COLUMN "connection_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_channels" ADD COLUMN "connection_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_connection_checks" ADD CONSTRAINT "marketing_connection_checks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_connection_checks" ADD CONSTRAINT "marketing_connection_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_connection_checks" ADD CONSTRAINT "marketing_connection_checks_channel_id_marketing_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."marketing_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_connection_monitors" ADD CONSTRAINT "marketing_connection_monitors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_connection_monitors" ADD CONSTRAINT "marketing_connection_monitors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_connection_active_channel_uq" ON "marketing_connection_checks" USING btree ("channel_id") WHERE "marketing_connection_checks"."status" NOT IN ('completed', 'needs_attention', 'cancelled');--> statement-breakpoint
CREATE INDEX "marketing_connection_due_idx" ON "marketing_connection_checks" USING btree ("next_poll_at","status");--> statement-breakpoint
CREATE INDEX "marketing_connection_project_idx" ON "marketing_connection_checks" USING btree ("company_id","project_id","created_at");