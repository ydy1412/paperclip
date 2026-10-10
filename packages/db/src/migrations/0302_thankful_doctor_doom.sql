CREATE TABLE "agent_profile_bindings" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"applied_version" integer NOT NULL,
	"pending_version" integer,
	"baseline" jsonb NOT NULL,
	"requested_by_user_id" text,
	"overrides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_profile_versions_profile_version_uq" UNIQUE("profile_id","version")
);
--> statement-breakpoint
CREATE TABLE "agent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_profiles_company_id_uq" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "sourcing_forwarder_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"homepage_url" text NOT NULL,
	"login_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sourcing_forwarder_providers_key_uq" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "sourcing_forwarders" ADD COLUMN "provider_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_profile_bindings" ADD CONSTRAINT "agent_profile_bindings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_bindings" ADD CONSTRAINT "agent_profile_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_bindings" ADD CONSTRAINT "agent_profile_bindings_profile_id_agent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_profile_id_agent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_profile_bindings_profile_idx" ON "agent_profile_bindings" USING btree ("company_id","profile_id");--> statement-breakpoint
CREATE INDEX "agent_profiles_company_idx" ON "agent_profiles" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "sourcing_forwarders" ADD CONSTRAINT "sourcing_forwarders_provider_id_sourcing_forwarder_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sourcing_forwarder_providers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
INSERT INTO sourcing_forwarder_providers (id, key, name, homepage_url, login_url)
VALUES ('bdc81085-726e-451b-a4ef-57b12b4deced', 'next1688', '넥스트배송', 'https://www.next1688.com/', 'https://www.next1688.com/Front/Join/Login.asp?gMnu1=207&gMnu2=20702');
--> statement-breakpoint
UPDATE sourcing_forwarders SET provider_id = 'bdc81085-726e-451b-a4ef-57b12b4deced'
WHERE homepage_url IN ('https://www.next1688.com/', 'https://www.next1688.com')
AND login_url = 'https://www.next1688.com/Front/Join/Login.asp?gMnu1=207&gMnu2=20702';
