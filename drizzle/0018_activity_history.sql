CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"actor_user_id" integer,
	"actor_name" text NOT NULL,
	"actor_role" text NOT NULL,
	"event" text NOT NULL,
	"subject_id" integer,
	"details" text NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "activity_logs_branch_created_at_idx" ON "activity_logs" USING btree ("branch_id","created_at","id");