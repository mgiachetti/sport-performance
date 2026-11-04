CREATE TYPE "public"."external_load_activity" AS ENUM('physical_education', 'other_sport', 'own_training', 'other');--> statement-breakpoint
ALTER TYPE "public"."change_tracked_table" ADD VALUE 'external_load';--> statement-breakpoint
ALTER TYPE "public"."sync_collection" ADD VALUE 'external_load';--> statement-breakpoint
ALTER TYPE "public"."sync_operation" ADD VALUE 'external_load.report';--> statement-breakpoint
ALTER TYPE "public"."sync_operation" ADD VALUE 'external_load.correct';--> statement-breakpoint
ALTER TYPE "public"."sync_operation" ADD VALUE 'external_load.archive';--> statement-breakpoint
CREATE TABLE "external_load" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"activity" "external_load_activity" NOT NULL,
	"detail" text,
	"minutes" smallint NOT NULL,
	"rpe" smallint NOT NULL,
	"srpe_au" integer GENERATED ALWAYS AS ("rpe"::integer * "minutes") STORED NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "external_load_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "external_load_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "external_load_minutes" CHECK ("external_load"."minutes" between 1 and 600),
	CONSTRAINT "external_load_rpe" CHECK ("external_load"."rpe" between 0 and 10),
	CONSTRAINT "external_load_detail" CHECK ("external_load"."detail" is null or (char_length("external_load"."detail") between 1 and 60 and "external_load"."detail" = btrim("external_load"."detail")))
);
--> statement-breakpoint
ALTER TABLE "player_load_daily" DROP CONSTRAINT "player_load_daily_values";--> statement-breakpoint
ALTER TABLE "player_load_daily" ADD COLUMN "external_load_au" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_load_daily" ADD COLUMN "external_n" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "external_load" ADD CONSTRAINT "external_load_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_load" ADD CONSTRAINT "external_load_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_load" ADD CONSTRAINT "external_load_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_load" ADD CONSTRAINT "external_load_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_load_player_idx" ON "external_load" USING btree ("club_id","player_id","local_date");--> statement-breakpoint
ALTER TABLE "player_load_daily" ADD CONSTRAINT "player_load_daily_values" CHECK ("player_load_daily"."load_au" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_load_daily"."load_au" >= 0 and "player_load_daily"."acute_ewma_au" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_load_daily"."acute_ewma_au" >= 0 and "player_load_daily"."chronic_ewma_au" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_load_daily"."chronic_ewma_au" >= 0 and "player_load_daily"."window_load_au" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_load_daily"."window_load_au" >= 0 and "player_load_daily"."history_days" >= 1 and "player_load_daily"."sessions_n" >= 0 and "player_load_daily"."pending_rpe_n" >= 0 and "player_load_daily"."external_load_au" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_load_daily"."external_load_au" >= 0 and "player_load_daily"."external_load_au" <= "player_load_daily"."load_au" and "player_load_daily"."external_n" >= 0 and "player_load_daily"."missing_days_acute" >= 0 and "player_load_daily"."missing_days_chronic" >= 0);--> statement-breakpoint

-- ─── Hand-written (B-511, ADR 0084) ──────────────────────────────────────────────────
-- The enum values added above are only used at run time (triggers, the API): `ADD VALUE`
-- is enough, and no row of the new table exists yet to enter the sync log.

-- `updated_at` trigger of the new club table (see 0001).
CREATE TRIGGER "external_load_set_updated_at" BEFORE UPDATE ON "external_load" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- RLS (ADR 0026): an activity is of a player, read with the player scope (the player their
-- own, the staff of their assignments, the administration the whole club). Only the player
-- reports, corrects and archives it, on themselves (the matrix adds the data consent). Never
-- deleted by the application: it goes with the player (ADR 0051).
DO $$
DECLARE
  player_scope constant text := '((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.external_load', player_scope, '{player}');
END
$$;
--> statement-breakpoint
-- The player of an activity never changes: a report for someone else is a new row.
REVOKE UPDATE ON "public"."external_load" FROM "sport_performance_app";
--> statement-breakpoint
GRANT UPDATE ("local_date", "activity", "detail", "minutes", "rpe", "archived_at", "updated_at", "updated_by")
  ON "public"."external_load" TO "sport_performance_app";
--> statement-breakpoint

-- Archiving is one-way and final: an archived activity never changes again (only the
-- ON DELETE SET NULL of an author touches it).
CREATE FUNCTION "public"."external_load_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['created_by', 'updated_by', 'updated_at'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['created_by', 'updated_by', 'updated_at']) THEN
    RAISE EXCEPTION 'An archived external load never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'external_load_archived', TABLE = 'external_load';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."external_load_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "external_load_guard" BEFORE UPDATE ON "public"."external_load"
  FOR EACH ROW EXECUTE FUNCTION "public"."external_load_guard"();
--> statement-breakpoint

-- Change history (ADR 0030): correcting the day, the activity, the detail, the minutes or the
-- RPE says why; archiving fills an empty column and needs no reason; the generated load is free.
CREATE TRIGGER "external_load_change_history" AFTER UPDATE OR DELETE ON "external_load" FOR EACH ROW EXECUTE FUNCTION "public"."change_history_record"('player_id', '{srpe_au,archived_at}');--> statement-breakpoint

-- Offline sync (ADR 0050): logged under its player; what the player reports is resolved per
-- field. Archiving has no clock (one-way, like a void of an attempt).
CREATE TRIGGER "external_load_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "public"."external_load"
  FOR EACH ROW EXECUTE FUNCTION "public"."sync_change_record"('external_load', 'id', 'player_id', 'local_date,activity,detail,minutes,rpe');--> statement-breakpoint

-- `sync_lock_rows` (as 0041 left it) also locks external loads; same body otherwise.
CREATE OR REPLACE FUNCTION "app"."sync_lock_rows"(target_collection text, ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  club uuid := "app"."current_club_id"();
BEGIN
  IF "app"."current_role"() IS NULL OR club IS NULL THEN
    RAISE EXCEPTION 'sync_lock_rows needs a validated role' USING ERRCODE = 'insufficient_privilege';
  END IF;
  CASE target_collection
    WHEN 'wellness' THEN
      PERFORM 1 FROM "public"."wellness" t WHERE t.club_id = club AND t.id = ANY (ids)
        ORDER BY t.id FOR NO KEY UPDATE;
    WHEN 'participation' THEN
      PERFORM 1 FROM "public"."participation" t WHERE t.club_id = club AND t.id = ANY (ids)
        ORDER BY t.id FOR NO KEY UPDATE;
    WHEN 'test_result' THEN
      PERFORM 1 FROM "public"."test_result" t WHERE t.club_id = club AND t.id = ANY (ids)
        ORDER BY t.id FOR NO KEY UPDATE;
    WHEN 'gym_set' THEN
      PERFORM 1 FROM "public"."gym_set" t WHERE t.club_id = club AND t.id = ANY (ids)
        ORDER BY t.id FOR NO KEY UPDATE;
    WHEN 'anthro_measurement' THEN
      PERFORM 1 FROM "public"."anthro_measurement" t WHERE t.club_id = club AND t.id = ANY (ids)
        ORDER BY t.id FOR NO KEY UPDATE;
    WHEN 'external_load' THEN
      PERFORM 1 FROM "public"."external_load" t WHERE t.club_id = club AND t.id = ANY (ids)
        ORDER BY t.id FOR NO KEY UPDATE;
    ELSE
      RAISE EXCEPTION 'not a collection with field clocks' USING ERRCODE = 'invalid_parameter_value';
  END CASE;
END;
$$;
--> statement-breakpoint

-- Derived outbox (0021, ADR 0046): an external load marks the player's load series from the
-- earliest day it touches (its day before and after a correction). Same body otherwise.
CREATE OR REPLACE FUNCTION "public"."derived_refresh_trigger"() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  whole_series constant date := DATE '1900-01-01';
  rec record;
BEGIN
  CASE TG_TABLE_NAME
  WHEN 'participation' THEN
    FOR rec IN
      SELECT x.club_id, x.player_id, s.local_date
        FROM (SELECT OLD.club_id, OLD.player_id, OLD.training_session_id WHERE TG_OP <> 'INSERT'
              UNION ALL
              SELECT NEW.club_id, NEW.player_id, NEW.training_session_id WHERE TG_OP <> 'DELETE')
             AS x(club_id, player_id, training_session_id)
        JOIN "public"."training_session" s ON s.club_id = x.club_id AND s.id = x.training_session_id
    LOOP
      PERFORM "public"."derived_refresh_mark"(rec.club_id, ARRAY[rec.player_id], rec.local_date, NULL, false);
    END LOOP;
  WHEN 'external_load' THEN
    IF TG_OP <> 'INSERT' THEN
      PERFORM "public"."derived_refresh_mark"(OLD.club_id, ARRAY[OLD.player_id], OLD.local_date, NULL, false);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      PERFORM "public"."derived_refresh_mark"(NEW.club_id, ARRAY[NEW.player_id], NEW.local_date, NULL, false);
    END IF;
  WHEN 'training_session' THEN
    PERFORM "public"."derived_refresh_mark"(
      NEW.club_id,
      ARRAY(SELECT p.player_id FROM "public"."participation" p
             WHERE p.club_id = NEW.club_id AND p.training_session_id = NEW.id),
      least(OLD.local_date, NEW.local_date), NULL, false);
  WHEN 'wellness' THEN
    IF TG_OP <> 'INSERT' THEN
      PERFORM "public"."derived_refresh_mark"(OLD.club_id, ARRAY[OLD.player_id], NULL, OLD.local_date, false);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      PERFORM "public"."derived_refresh_mark"(NEW.club_id, ARRAY[NEW.player_id], NULL, NEW.local_date, false);
    END IF;
  WHEN 'anthro_measurement', 'player_parent_height' THEN
    IF TG_OP <> 'INSERT' THEN
      PERFORM "public"."derived_refresh_mark"(OLD.club_id, ARRAY[OLD.player_id], NULL, NULL, true);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      PERFORM "public"."derived_refresh_mark"(NEW.club_id, ARRAY[NEW.player_id], NULL, NULL, true);
    END IF;
  WHEN 'player' THEN
    PERFORM "public"."derived_refresh_mark"(
      NEW.club_id, ARRAY[NEW.id],
      CASE WHEN OLD.left_on IS DISTINCT FROM NEW.left_on THEN least(OLD.left_on, NEW.left_on) END,
      NULL,
      OLD.birth_date IS DISTINCT FROM NEW.birth_date OR OLD.sex IS DISTINCT FROM NEW.sex);
  WHEN 'club' THEN
    IF OLD.settings -> 'derived' IS DISTINCT FROM NEW.settings -> 'derived' THEN
      PERFORM "public"."derived_refresh_mark"(
        NEW.id,
        ARRAY(SELECT p.id FROM "public"."player" p WHERE p.club_id = NEW.id),
        whole_series, whole_series, true);
    END IF;
  ELSE
    RAISE EXCEPTION 'derived_refresh_trigger is not attached to %', TG_TABLE_NAME;
  END CASE;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- Only the columns the load depends on.
CREATE TRIGGER "external_load_derived_refresh" AFTER INSERT OR DELETE OR UPDATE OF "player_id", "local_date", "minutes", "rpe", "archived_at" ON "external_load" FOR EACH ROW EXECUTE FUNCTION "public"."derived_refresh_trigger"();
--> statement-breakpoint

-- Load series stored before this migration have no external load (the columns default to
-- 0), which is exact: no external load existed.
COMMENT ON COLUMN "public"."player_load_daily"."external_load_au" IS 'Part of load_au reported by the player outside the club (external_load), in AU.';
