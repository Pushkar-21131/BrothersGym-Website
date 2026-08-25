CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "branches_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "members" DROP CONSTRAINT "members_gym_id_unique";--> statement-breakpoint
ALTER TABLE "membership_plans" DROP CONSTRAINT "membership_plans_code_unique";--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "permissions" jsonb;--> statement-breakpoint
ALTER TABLE "equipment_expenses" ADD COLUMN "branch_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "branch_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "left_gym" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "left_gym_date" date;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "left_gym_reason" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "left_gym_note" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "won_back_at" timestamp;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "branch_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "display_order" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "online_joins" ADD COLUMN "branch_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "branch_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "branch_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "trainers" ADD COLUMN "branch_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "trainers" ADD COLUMN "instagram_url" text;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_expenses" ADD CONSTRAINT "equipment_expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_joins" ADD CONSTRAINT "online_joins_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainers" ADD CONSTRAINT "trainers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_branch_gymid_unique" UNIQUE("branch_id","gym_id");--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "plans_branch_code_unique" UNIQUE("branch_id","code");