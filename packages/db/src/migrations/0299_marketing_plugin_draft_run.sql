ALTER TABLE "marketing_drafts" ADD COLUMN IF NOT EXISTS "generation_run_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'marketing_drafts_generation_run_id_heartbeat_runs_id_fk'
      AND conrelid = 'public.marketing_drafts'::regclass
  ) THEN
    ALTER TABLE "marketing_drafts" ADD CONSTRAINT "marketing_drafts_generation_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_drafts_company_channel_run_uq" ON "marketing_drafts" USING btree ("company_id","channel_id","generation_run_id") WHERE "marketing_drafts"."generation_run_id" IS NOT NULL;
