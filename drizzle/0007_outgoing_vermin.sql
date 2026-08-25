-- Hand-edited after generation, deliberately.
--
-- This database was previously updated with `drizzle-kit push`, so it already
-- has `branches.map_url` and the rate_limit_attempts unique constraint even
-- though no migration ever recorded them. Generation therefore swept those two
-- pre-existing changes into this file alongside the new online_joins columns.
--
-- Run as generated, statements 1 and 4 would fail here with "already exists",
-- while a fresh database (Neon, on deploy) genuinely needs all four. Making
-- them idempotent satisfies both.

ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "map_url" text;--> statement-breakpoint
ALTER TABLE "online_joins" ADD COLUMN IF NOT EXISTS "parent_name" text;--> statement-breakpoint
ALTER TABLE "online_joins" ADD COLUMN IF NOT EXISTS "emergency_contact" text;--> statement-breakpoint
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS; this is the standard guard.
DO $$ BEGIN
  ALTER TABLE "rate_limit_attempts" ADD CONSTRAINT "rate_limit_attempts_identifier_unique" UNIQUE("identifier");
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;
