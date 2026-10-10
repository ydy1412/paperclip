CREATE TABLE "artifact_folder_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"artifact_id" text NOT NULL,
	"folder_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_folder_entries" ADD CONSTRAINT "artifact_folder_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_folder_entries" ADD CONSTRAINT "artifact_folder_entries_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_folder_entries_company_artifact_idx" ON "artifact_folder_entries" USING btree ("company_id","artifact_id");--> statement-breakpoint
CREATE INDEX "artifact_folder_entries_company_folder_idx" ON "artifact_folder_entries" USING btree ("company_id","folder_id");