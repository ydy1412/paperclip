CREATE TABLE "sourcing_forwarders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"homepage_url" text NOT NULL,
	"login_url" text NOT NULL,
	"credential_secret_id" uuid NOT NULL,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sourcing_forwarders" ADD CONSTRAINT "sourcing_forwarders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_forwarders" ADD CONSTRAINT "sourcing_forwarders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_forwarders" ADD CONSTRAINT "sourcing_forwarders_credential_secret_id_company_secrets_id_fk" FOREIGN KEY ("credential_secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sourcing_forwarders_company_project_idx" ON "sourcing_forwarders" USING btree ("company_id","project_id");