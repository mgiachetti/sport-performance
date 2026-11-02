-- Active sessions per device and known devices (B-333, ADR 0033).
CREATE TYPE "public"."device_browser" AS ENUM('chrome', 'safari', 'firefox', 'edge', 'opera', 'samsung_internet', 'app');--> statement-breakpoint
CREATE TYPE "public"."device_os" AS ENUM('ios', 'android', 'macos', 'windows', 'linux', 'chromeos');--> statement-breakpoint
CREATE TYPE "public"."session_client_type" AS ENUM('web', 'mobile');--> statement-breakpoint
CREATE TABLE "known_device" (
	"user_id" text NOT NULL,
	"device_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_device_pkey" PRIMARY KEY("user_id","device_hash"),
	CONSTRAINT "known_device_hash_format" CHECK ("known_device"."device_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
-- Sessions opened before this migration cannot tell how they travel: they are listed as web
-- sessions (the default is dropped right away, so every new session must say it).
ALTER TABLE "session" ADD COLUMN "client_type" "session_client_type" DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "client_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "device_os" "device_os";--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "device_browser" "device_browser";--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "known_device" ADD CONSTRAINT "known_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "known_device_last_seen_at_idx" ON "known_device" USING btree ("last_seen_at");--> statement-breakpoint
-- No IP and no raw User-Agent with a session. RLS is forced on "session" (the owner sees
-- nothing through it), so it is lifted for the clean-up of older rows and forced again.
ALTER TABLE "public"."session" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "public"."session" SET "ip_address" = NULL, "user_agent" = NULL WHERE "ip_address" <> '' OR "user_agent" <> '';--> statement-breakpoint
ALTER TABLE "public"."session" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_no_ip_address" CHECK (coalesce("session"."ip_address", '') = '');--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_no_user_agent" CHECK (coalesce("session"."user_agent", '') = '');--> statement-breakpoint

-- Known devices: global like the identity tables, only for Better Auth's role, which records,
-- refreshes and prunes them. The API and the worker never see them.
ALTER TABLE "public"."known_device" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."known_device" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "known_device_auth_all" ON "public"."known_device" FOR ALL TO "sport_performance_auth" USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."known_device" TO "sport_performance_auth";
