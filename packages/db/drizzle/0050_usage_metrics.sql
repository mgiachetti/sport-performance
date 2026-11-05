CREATE TYPE "public"."usage_client" AS ENUM('web', 'app');--> statement-breakpoint
CREATE TYPE "public"."usage_surface" AS ENUM('panel', 'player_profile', 'test_day_sheet', 'player_home', 'guardian_home', 'kiosk');--> statement-breakpoint
CREATE TABLE "usage_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"local_date" date NOT NULL,
	"surface" "usage_surface" NOT NULL,
	"client" "usage_client" NOT NULL,
	"events_n" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "usage_activity_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "usage_activity_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "usage_activity_member_day_key" UNIQUE("club_id","membership_id","local_date","surface","client"),
	CONSTRAINT "usage_activity_events_n" CHECK ("usage_activity"."events_n" >= 1)
);
--> statement-breakpoint
CREATE TABLE "usage_weekly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"week_start" date NOT NULL,
	"surface" "usage_surface" NOT NULL,
	"client" "usage_client" NOT NULL,
	"role" "membership_role" NOT NULL,
	"active_members_n" integer NOT NULL,
	"member_days_n" integer NOT NULL,
	"events_n" integer NOT NULL,
	CONSTRAINT "usage_weekly_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "usage_weekly_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "usage_weekly_week_key" UNIQUE("club_id","week_start","surface","client","role"),
	CONSTRAINT "usage_weekly_monday" CHECK (extract(isodow from "usage_weekly"."week_start") = 1),
	CONSTRAINT "usage_weekly_counts" CHECK ("usage_weekly"."active_members_n" >= 1 and "usage_weekly"."member_days_n" between "usage_weekly"."active_members_n" and 7 * "usage_weekly"."active_members_n" and "usage_weekly"."events_n" >= "usage_weekly"."member_days_n")
);
--> statement-breakpoint
ALTER TABLE "usage_activity" ADD CONSTRAINT "usage_activity_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_activity" ADD CONSTRAINT "usage_activity_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_activity" ADD CONSTRAINT "usage_activity_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_activity" ADD CONSTRAINT "usage_activity_membership_id_fkey" FOREIGN KEY ("club_id","membership_id") REFERENCES "public"."membership"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_weekly" ADD CONSTRAINT "usage_weekly_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_weekly" ADD CONSTRAINT "usage_weekly_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_weekly" ADD CONSTRAINT "usage_weekly_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_activity_local_date_idx" ON "usage_activity" USING btree ("club_id","local_date");--> statement-breakpoint

-- ─── Hand-written (B-707, ADR 0093) ──────────────────────────────────────────────────
-- First-party usage metrics: the API records the use of a few surfaces with
-- `app.record_usage`; the worker folds whole weeks past the retention into
-- `usage_weekly` (counts without members) and deletes the per-member rows.

-- `updated_at` triggers of the new club tables (see 0001).
CREATE TRIGGER "usage_activity_set_updated_at" BEFORE UPDATE ON "usage_activity" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "usage_weekly_set_updated_at" BEFORE UPDATE ON "usage_weekly" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- RLS (ADR 0026): only the administration reads (the API answers aggregates, never a
-- member); the application writes nothing directly (only `app.record_usage`, below); the
-- worker writes the weekly counts and is the only role that deletes activity rows.
DO $$
DECLARE
  administration constant text := "app_admin"."role_in"('{admin,superadmin}');
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.usage_activity', administration, '{}');
  PERFORM "app_admin"."secure_club_table"('public.usage_weekly', administration, '{}');
END
$$;
--> statement-breakpoint
GRANT DELETE ON "public"."usage_activity" TO "sport_performance_worker";
--> statement-breakpoint

-- ─── app.record_usage: one use of a surface by the caller ────────────────────────────
-- The membership and the role come from the validated context (`app.current_role()`), the
-- day from the club's time zone (`app.club_today()`): the caller cannot record for someone
-- else, another club or another day. A superadmin's support access is not the club's use
-- and records nothing. Idempotent per member, day, surface and client: a repeated use adds
-- to `events_n`.
CREATE FUNCTION "app"."record_usage"(
  used_surface "public"."usage_surface", used_client "public"."usage_client"
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  club constant uuid := "app"."current_club_id"();
  usr constant text := "app"."current_user_id"();
  ctx_role constant text := "app"."current_role"();
  member uuid;
BEGIN
  IF used_surface IS NULL OR used_client IS NULL THEN
    RAISE EXCEPTION 'A use needs its surface and client' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF club IS NULL OR usr IS NULL OR ctx_role IS NULL THEN
    RAISE EXCEPTION 'Recording a use needs a validated tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF ctx_role = 'superadmin' THEN
    RETURN;
  END IF;
  SELECT m.id INTO member
    FROM "public"."membership" m
   WHERE m.club_id = club AND m.user_id = usr AND m.role::text = ctx_role
     AND m.started_at <= now() AND (m.ended_at IS NULL OR m.ended_at > now())
   ORDER BY m.started_at DESC, m.id
   LIMIT 1;
  IF member IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO "public"."usage_activity" AS u
         (club_id, created_by, updated_by, membership_id, role, local_date, surface, client)
  VALUES (club, usr, usr, member, ctx_role::"public"."membership_role", "app"."club_today"(),
          used_surface, used_client)
  ON CONFLICT ON CONSTRAINT "usage_activity_member_day_key"
  DO UPDATE SET events_n = u.events_n + 1;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."record_usage"("public"."usage_surface", "public"."usage_client") FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."record_usage"("public"."usage_surface", "public"."usage_client") TO "sport_performance_app";