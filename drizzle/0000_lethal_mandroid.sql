CREATE TABLE "equipment_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"equipment_name" text NOT NULL,
	"cost" integer NOT NULL,
	"date" date NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"gym_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"contact_number" text NOT NULL,
	"address" text,
	"parent_name" text,
	"emergency_contact" text NOT NULL,
	"fee_amount" integer NOT NULL,
	"membership_expiry" date NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "members_gym_id_unique" UNIQUE("gym_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"date" date NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"salary" integer NOT NULL,
	"contact_number" text NOT NULL,
	"address" text,
	"join_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trainers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"photo_url" text,
	"experience" text NOT NULL,
	"pt_fee" integer NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;