CREATE TABLE "enquiries" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"name" text NOT NULL,
	"sex" text,
	"phone" text,
	"inquiry_date" date DEFAULT now() NOT NULL,
	"note" text,
	"status" text DEFAULT 'new' NOT NULL,
	"follow_up_date" date,
	"last_contacted_at" timestamp,
	"contact_count" integer DEFAULT 0 NOT NULL,
	"converted_member_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_converted_member_id_members_id_fk" FOREIGN KEY ("converted_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enquiries_branch_status_idx" ON "enquiries" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "enquiries_follow_up_date_idx" ON "enquiries" USING btree ("follow_up_date");