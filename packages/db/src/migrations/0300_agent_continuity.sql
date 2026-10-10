CREATE TABLE "agent_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"packet" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_mailbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"from_agent_id" uuid NOT NULL,
	"to_agent_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"related_issue_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_task_sessions" ADD COLUMN "handoff_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_task_sessions" ADD COLUMN "continuity_policy" text DEFAULT 'resume' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "seat_alias" text;--> statement-breakpoint
ALTER TABLE "agent_handoffs" ADD CONSTRAINT "agent_handoffs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_handoffs" ADD CONSTRAINT "agent_handoffs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_handoffs" ADD CONSTRAINT "agent_handoffs_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mailbox_messages" ADD CONSTRAINT "agent_mailbox_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mailbox_messages" ADD CONSTRAINT "agent_mailbox_messages_related_issue_id_issues_id_fk" FOREIGN KEY ("related_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mailbox_messages" ADD CONSTRAINT "agent_mailbox_messages_company_id_from_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","from_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mailbox_messages" ADD CONSTRAINT "agent_mailbox_messages_company_id_to_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","to_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_handoffs_history_idx" ON "agent_handoffs" USING btree ("company_id","agent_id","issue_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_mailbox_inbox_idx" ON "agent_mailbox_messages" USING btree ("company_id","to_agent_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "agent_mailbox_thread_idx" ON "agent_mailbox_messages" USING btree ("company_id","thread_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_task_sessions" ADD CONSTRAINT "agent_task_sessions_handoff_id_agent_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."agent_handoffs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_company_seat_alias_uq" UNIQUE("company_id","seat_alias");