CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"success" boolean NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "login_otps" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"otp" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"device_info" text,
	"ip_address" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rate_limit_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"window_start" timestamp DEFAULT now() NOT NULL,
	"blocked_until" timestamp
);
