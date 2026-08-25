CREATE TABLE "sms_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer,
	"phone_number" text NOT NULL,
	"message" text NOT NULL,
	"status" text NOT NULL,
	"cost" integer DEFAULT 0,
	"sent_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "joining_date" date DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;