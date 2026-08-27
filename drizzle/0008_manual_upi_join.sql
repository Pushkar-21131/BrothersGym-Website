ALTER TABLE "branches" ADD COLUMN "upi_id" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "upi_name" text;--> statement-breakpoint
ALTER TABLE "online_joins" ADD COLUMN "upi_reference" text;--> statement-breakpoint
ALTER TABLE "online_joins" ADD COLUMN "claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "online_joins" ADD COLUMN "confirmed_at" timestamp;