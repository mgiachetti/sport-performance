CREATE TYPE "public"."fixture_status" AS ENUM('scheduled', 'postponed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."fixture_venue" AS ENUM('home', 'away', 'neutral');--> statement-breakpoint
CREATE TABLE "fixture" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"opponent" text NOT NULL,
	"venue" "fixture_venue" NOT NULL,
	"competition" text,
	"match_date" date NOT NULL,
	"kickoff_time" time(0),
	"location" text,
	"status" "fixture_status" DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	CONSTRAINT "fixture_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "fixture_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "fixture_opponent_format" CHECK ("fixture"."opponent" is null or ("fixture"."opponent" = btrim("fixture"."opponent") and "fixture"."opponent" <> '' and char_length("fixture"."opponent") <= 120)),
	CONSTRAINT "fixture_competition_format" CHECK ("fixture"."competition" is null or ("fixture"."competition" = btrim("fixture"."competition") and "fixture"."competition" <> '' and char_length("fixture"."competition") <= 120)),
	CONSTRAINT "fixture_location_format" CHECK ("fixture"."location" is null or ("fixture"."location" = btrim("fixture"."location") and "fixture"."location" <> '' and char_length("fixture"."location") <= 120)),
	CONSTRAINT "fixture_notes_format" CHECK ("fixture"."notes" is null or ("fixture"."notes" = btrim("fixture"."notes") and "fixture"."notes" <> '' and char_length("fixture"."notes") <= 2000)),
	CONSTRAINT "fixture_kickoff_minute" CHECK ("fixture"."kickoff_time" is null or extract(second from "fixture"."kickoff_time") = 0)
);
--> statement-breakpoint
ALTER TABLE "season" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "test_window" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fixture" ADD CONSTRAINT "fixture_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture" ADD CONSTRAINT "fixture_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture" ADD CONSTRAINT "fixture_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture" ADD CONSTRAINT "fixture_category_id_fkey" FOREIGN KEY ("club_id","category_id") REFERENCES "public"."category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fixture_category_date_idx" ON "fixture" USING btree ("club_id","category_id","match_date");--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_max_length" CHECK ("season"."ends_on" - "season"."starts_on" < 366);--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_name_format" CHECK ("season"."name" = btrim("season"."name") and "season"."name" <> '' and char_length("season"."name") <= 60);--> statement-breakpoint

-- ─── Hand-written (B-317, ADR 0036) ──────────────────────────────────────────────────
-- btree_gist lets an exclusion constraint compare uuid and enum columns with `=` next to a
-- date range with `&&` (a trusted extension). In its own schema, so `public` keeps only
-- our objects; the index uses the default operator classes, whatever the search_path.
CREATE SCHEMA IF NOT EXISTS "extensions";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "extensions" FROM PUBLIC;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "extensions";
--> statement-breakpoint

-- Active seasons of a sport never overlap: a day of the club is in at most one season per
-- sport (the season of a match is derived from its date). Archived ones are out of the plan.
ALTER TABLE "season" ADD CONSTRAINT "season_no_overlap" EXCLUDE USING gist (
  "club_id" WITH =, "sport" WITH =, daterange("starts_on", "ends_on", '[]') WITH &&
) WHERE ("archived_at" IS NULL);
--> statement-breakpoint
-- Active windows of a season never overlap. That they lie inside the season and follow
-- their number (V2 after V1) is checked by the API under a lock of the season.
ALTER TABLE "test_window" ADD CONSTRAINT "test_window_no_overlap" EXCLUDE USING gist (
  "club_id" WITH =, "season_id" WITH =, daterange("starts_on", "ends_on", '[]') WITH &&
) WHERE ("archived_at" IS NULL);
--> statement-breakpoint

-- The new archive columns are written by the same roles as the rest of their table
-- (secure_club_table granted UPDATE per column when the tables were created, 0004).
GRANT UPDATE ("archived_at") ON "public"."season", "public"."test_window"
  TO "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint

-- `updated_at` trigger of the new club table (see 0001).
CREATE TRIGGER "fixture_set_updated_at" BEFORE UPDATE ON "fixture" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint

-- The fixture is part of the calendar: every member reads it (like training sessions); the
-- staff that plans training writes it (coach, sc, admin; the permission matrix narrows it
-- to the coach of the category and the administration). A wrong match is archived: no
-- DELETE.
DO $$
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.fixture',
    '(SELECT "app"."current_role"()) IS NOT NULL', '{coach,sc,admin,superadmin}');
END
$$;
