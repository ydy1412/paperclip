CREATE TABLE "sourcing_capture_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"local_board" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sourcing_capture_connections" ADD CONSTRAINT "sourcing_capture_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_capture_connections" ADD CONSTRAINT "sourcing_capture_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sourcing_capture_connections_token_hash_idx" ON "sourcing_capture_connections" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sourcing_capture_connections_scope_idx" ON "sourcing_capture_connections" USING btree ("company_id","project_id");