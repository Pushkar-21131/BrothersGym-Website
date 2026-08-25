ALTER TABLE "branches" ADD COLUMN "owner_name" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "owner_email" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "consent_to_health_data" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "consent_date" timestamp;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "consent_ip_address" text;