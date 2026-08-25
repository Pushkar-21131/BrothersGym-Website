CREATE TABLE "app_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "app_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"price" integer NOT NULL,
	"duration_days" integer DEFAULT 30 NOT NULL,
	"description" text,
	"includes_cardio" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "membership_plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "online_joins" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"contact_number" text NOT NULL,
	"address" text,
	"plan_code" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"razorpay_order_id" text,
	"razorpay_payment_id" text,
	"member_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "plan_type" text DEFAULT 'offline';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "method" text DEFAULT 'cash';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "razorpay_order_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "razorpay_payment_id" text;--> statement-breakpoint
ALTER TABLE "online_joins" ADD CONSTRAINT "online_joins_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;