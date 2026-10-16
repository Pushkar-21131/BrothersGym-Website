ALTER TABLE "enquiries" ADD COLUMN "created_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "equipment_expenses" ADD COLUMN "created_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "equipment_expenses" ADD COLUMN "created_by_name" text;