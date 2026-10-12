ALTER TABLE "sourcing_forwarders" ADD COLUMN "verification_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "sourcing_forwarders" ADD COLUMN "verification_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "sourcing_forwarders" ADD COLUMN "verification_session_id" text;--> statement-breakpoint
ALTER TABLE "sourcing_forwarders" ADD COLUMN "verification_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sourcing_forwarders" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sourcing_forwarders" ADD COLUMN "verification_error_code" text;