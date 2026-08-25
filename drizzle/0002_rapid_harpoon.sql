CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_name" text NOT NULL,
	"rating" integer NOT NULL,
	"review_text" text NOT NULL,
	"member_since" text,
	"photo_url" text,
	"is_visible" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
