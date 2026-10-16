ALTER TABLE "payments" ADD COLUMN "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "voided_by" text;