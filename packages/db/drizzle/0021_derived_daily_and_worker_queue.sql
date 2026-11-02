CREATE TYPE "public"."acwr_status" AS ENUM('ok', 'insufficient_history', 'zero_chronic_load');--> statement-breakpoint
CREATE TYPE "public"."monotony_status" AS ENUM('ok', 'insufficient_history', 'zero_variance');--> statement-breakpoint
CREATE TABLE "derived_refresh" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"load_from" date,
	"wellness_from" date,
	"maturation" boolean DEFAULT false NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "derived_refresh_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "derived_refresh_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "derived_refresh_club_id_player_id_key" UNIQUE("club_id","player_id"),
	CONSTRAINT "derived_refresh_something" CHECK ("derived_refresh"."load_from" is not null or "derived_refresh"."wellness_from" is not null or "derived_refresh"."maturation")
);
--> statement-breakpoint
CREATE TABLE "player_load_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"load_au" double precision NOT NULL,
	"has_data" boolean NOT NULL,
	"sessions_n" smallint NOT NULL,
	"pending_rpe_n" smallint NOT NULL,
	"history_days" integer NOT NULL,
	"acute_ewma_au" double precision NOT NULL,
	"chronic_ewma_au" double precision NOT NULL,
	"acwr" double precision,
	"acwr_status" "acwr_status" NOT NULL,
	"missing_days_acute" smallint NOT NULL,
	"missing_days_chronic" smallint NOT NULL,
	"window_load_au" double precision NOT NULL,
	"monotony" double precision,
	"strain_au" double precision,
	"monotony_status" "monotony_status" NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_load_daily_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "player_load_daily_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "player_load_daily_player_day_key" UNIQUE("club_id","player_id","local_date"),
	CONSTRAINT "player_load_daily_values" CHECK ("player_load_daily"."load_au" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_load_daily"."load_au" >= 0 and "player_load_daily"."acute_ewma_au" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_load_daily"."acute_ewma_au" >= 0 and "player_load_daily"."chronic_ewma_au" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_load_daily"."chronic_ewma_au" >= 0 and "player_load_daily"."window_load_au" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_load_daily"."window_load_au" >= 0 and "player_load_daily"."history_days" >= 1 and "player_load_daily"."sessions_n" >= 0 and "player_load_daily"."pending_rpe_n" >= 0 and "player_load_daily"."missing_days_acute" >= 0 and "player_load_daily"."missing_days_chronic" >= 0),
	CONSTRAINT "player_load_daily_acwr" CHECK (("player_load_daily"."acwr_status" = 'ok') = ("player_load_daily"."acwr" is not null) and ("player_load_daily"."acwr" is null or ("player_load_daily"."acwr" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_load_daily"."acwr" >= 0))),
	CONSTRAINT "player_load_daily_monotony" CHECK (("player_load_daily"."monotony_status" = 'ok') = ("player_load_daily"."monotony" is not null) and ("player_load_daily"."monotony" is null) = ("player_load_daily"."strain_au" is null) and ("player_load_daily"."monotony" is null or "player_load_daily"."monotony" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)) and ("player_load_daily"."strain_au" is null or "player_load_daily"."strain_au" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)))
);
--> statement-breakpoint
CREATE TABLE "player_wellness_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"item_count" smallint NOT NULL,
	"mean_score" double precision NOT NULL,
	"baseline_samples" smallint NOT NULL,
	"baseline_mean_score" double precision,
	"baseline_sd_score" double precision,
	"z_score" double precision,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_wellness_daily_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "player_wellness_daily_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "player_wellness_daily_player_day_key" UNIQUE("club_id","player_id","local_date"),
	CONSTRAINT "player_wellness_daily_item_count" CHECK ("player_wellness_daily"."item_count" in (3, 5)),
	CONSTRAINT "player_wellness_daily_values" CHECK ("player_wellness_daily"."mean_score" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_wellness_daily"."mean_score" between 1 and 5 and "player_wellness_daily"."baseline_samples" >= 0 and ("player_wellness_daily"."baseline_mean_score" is null or "player_wellness_daily"."baseline_mean_score" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)) and ("player_wellness_daily"."baseline_sd_score" is null or ("player_wellness_daily"."baseline_sd_score" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_wellness_daily"."baseline_sd_score" >= 0)) and ("player_wellness_daily"."z_score" is null or "player_wellness_daily"."z_score" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)))
);
--> statement-breakpoint
ALTER TABLE "anthro_measurement" ADD COLUMN "predicted_adult_height_cm" double precision;--> statement-breakpoint
ALTER TABLE "anthro_measurement" ADD COLUMN "khamis_roche_table_id" uuid;--> statement-breakpoint
ALTER TABLE "anthro_measurement" ADD COLUMN "growth_velocity_cm_year" double precision;--> statement-breakpoint
ALTER TABLE "derived_refresh" ADD CONSTRAINT "derived_refresh_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derived_refresh" ADD CONSTRAINT "derived_refresh_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derived_refresh" ADD CONSTRAINT "derived_refresh_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derived_refresh" ADD CONSTRAINT "derived_refresh_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_load_daily" ADD CONSTRAINT "player_load_daily_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_load_daily" ADD CONSTRAINT "player_load_daily_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_load_daily" ADD CONSTRAINT "player_load_daily_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_load_daily" ADD CONSTRAINT "player_load_daily_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wellness_daily" ADD CONSTRAINT "player_wellness_daily_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wellness_daily" ADD CONSTRAINT "player_wellness_daily_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wellness_daily" ADD CONSTRAINT "player_wellness_daily_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wellness_daily" ADD CONSTRAINT "player_wellness_daily_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "derived_refresh_requested_idx" ON "derived_refresh" USING btree ("club_id","requested_at");--> statement-breakpoint
CREATE INDEX "player_load_daily_day_idx" ON "player_load_daily" USING btree ("club_id","local_date");--> statement-breakpoint
CREATE INDEX "player_wellness_daily_day_idx" ON "player_wellness_daily" USING btree ("club_id","local_date");--> statement-breakpoint
ALTER TABLE "anthro_measurement" ADD CONSTRAINT "anthro_measurement_khamis_roche_table_id_fkey" FOREIGN KEY ("club_id","khamis_roche_table_id") REFERENCES "public"."khamis_roche_table"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anthro_measurement_khamis_roche_table_id_idx" ON "anthro_measurement" USING btree ("club_id","khamis_roche_table_id") WHERE "anthro_measurement"."khamis_roche_table_id" is not null;--> statement-breakpoint
ALTER TABLE "anthro_measurement" ADD CONSTRAINT "anthro_measurement_khamis_roche" CHECK (("anthro_measurement"."adult_height_pct" is null) = ("anthro_measurement"."predicted_adult_height_cm" is null) and ("anthro_measurement"."adult_height_pct" is null) = ("anthro_measurement"."khamis_roche_table_id" is null) and ("anthro_measurement"."predicted_adult_height_cm" is null or ("anthro_measurement"."predicted_adult_height_cm" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "anthro_measurement"."predicted_adult_height_cm" > 0)));--> statement-breakpoint
ALTER TABLE "anthro_measurement" ADD CONSTRAINT "anthro_measurement_growth_velocity_finite" CHECK ("anthro_measurement"."growth_velocity_cm_year" is null or "anthro_measurement"."growth_velocity_cm_year" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8));--> statement-breakpoint
-- ─── Hand-written (B-326, ADR 0045): triggers, outbox of recalculations, RLS and grants ──
-- `updated_at` triggers of the new club tables (see 0001).
CREATE TRIGGER "derived_refresh_set_updated_at" BEFORE UPDATE ON "derived_refresh" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "player_load_daily_set_updated_at" BEFORE UPDATE ON "player_load_daily" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "player_wellness_daily_set_updated_at" BEFORE UPDATE ON "player_wellness_daily" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint

-- RLS (ADR 0026). The derived tables are read with the player scope (the assigned staff,
-- the player, their guardians, admin); pending recalculations only by the staff. The API
-- writes none of them: the worker computes them. They are a cache rebuilt from the source
-- rows, so the worker (and only the worker) may DELETE them.
DO $$
DECLARE
  staff constant text := "app_admin"."role_in"('{coach,sc,medical,admin,superadmin}');
  player_scope constant text := '((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.player_load_daily', player_scope, '{}');
  PERFORM "app_admin"."secure_club_table"('public.player_wellness_daily', player_scope, '{}');
  PERFORM "app_admin"."secure_club_table"('public.derived_refresh',
    format('%s AND %s', staff, player_scope), '{}');
END
$$;
--> statement-breakpoint
GRANT DELETE ON "public"."player_load_daily", "public"."player_wellness_daily", "public"."derived_refresh" TO "sport_performance_worker";
--> statement-breakpoint

-- secure_club_table (0004) granted UPDATE per column when the table was created: the new
-- derived columns of anthro_measurement are the worker's to write.
GRANT UPDATE ("predicted_adult_height_cm", "khamis_roche_table_id", "growth_velocity_cm_year") ON "public"."anthro_measurement" TO "sport_performance_worker";
--> statement-breakpoint

-- The maturation the worker writes is derived: its changes are recorded but never count as a
-- correction (0008). Same trigger as before plus the new derived columns.
DROP TRIGGER "anthro_measurement_change_history" ON "anthro_measurement";
--> statement-breakpoint
CREATE TRIGGER "anthro_measurement_change_history" AFTER UPDATE OR DELETE ON "anthro_measurement" FOR EACH ROW EXECUTE FUNCTION "public"."change_history_record"('player_id', '{phv_offset_years,maturity_offset_equation,adult_height_pct,predicted_adult_height_cm,khamis_roche_table_id,growth_velocity_cm_year,derived_at}');
--> statement-breakpoint

-- ─── Outbox of recalculations ────────────────────────────────────────────────────────
-- Marks players for the worker in the transaction of the write, whoever writes (API, offline
-- sync, imports, operators): if the transaction rolls back, nothing is pending. Notifies the
-- worker on commit (`pg_notify` is transactional; the payload is the club id). The earliest
-- day wins (`least` ignores NULL); `requested_at` is the time of the latest mark, so the
-- worker can tell a write that came in while it was computing (ADR 0045).
-- Not callable by any connection role: only the triggers below (run as the owner) use it.
CREATE FUNCTION "public"."derived_refresh_mark"(
  club uuid, players uuid[], load_from date, wellness_from date, maturation boolean
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF club IS NULL OR players IS NULL OR cardinality(players) = 0
     OR (load_from IS NULL AND wellness_from IS NULL AND NOT coalesce(maturation, false)) THEN
    RETURN;
  END IF;
  INSERT INTO "public"."derived_refresh" AS r
    (club_id, player_id, load_from, wellness_from, maturation, requested_at)
  SELECT club, p.id, load_from, wellness_from, coalesce(maturation, false), clock_timestamp()
    FROM "public"."player" p
   WHERE p.club_id = club AND p.id = ANY (players)
  ON CONFLICT (club_id, player_id) DO UPDATE
     SET load_from = least(r.load_from, EXCLUDED.load_from),
         wellness_from = least(r.wellness_from, EXCLUDED.wellness_from),
         maturation = r.maturation OR EXCLUDED.maturation,
         requested_at = EXCLUDED.requested_at;
  IF FOUND THEN
    PERFORM pg_notify('sport_performance_derived_refresh', club::text);
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."derived_refresh_mark"(uuid, uuid[], date, date, boolean) FROM PUBLIC;
--> statement-breakpoint

-- One trigger function for every source table. The day of a participation is its
-- session's; a session that moves day or is archived marks all its participants from the
-- earlier day; the load series of a player ends the day they leave (`left_on`).
-- `1900-01-01` means "the whole series" (the worker clamps it to the first day of history).
CREATE FUNCTION "public"."derived_refresh_trigger"() RETURNS trigger
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
REVOKE ALL ON FUNCTION "public"."derived_refresh_trigger"() FROM PUBLIC;
--> statement-breakpoint
-- Only the columns the derived values depend on: the worker's own writes (maturation
-- columns of anthro_measurement) never mark again.
CREATE TRIGGER "participation_derived_refresh" AFTER INSERT OR DELETE OR UPDATE OF "training_session_id", "player_id", "status", "minutes", "rpe" ON "participation" FOR EACH ROW EXECUTE FUNCTION "public"."derived_refresh_trigger"();
--> statement-breakpoint
CREATE TRIGGER "training_session_derived_refresh" AFTER UPDATE OF "local_date", "archived_at" ON "training_session" FOR EACH ROW EXECUTE FUNCTION "public"."derived_refresh_trigger"();
--> statement-breakpoint
CREATE TRIGGER "wellness_derived_refresh" AFTER INSERT OR DELETE OR UPDATE OF "player_id", "local_date", "item_count", "sleep", "fatigue", "soreness", "stress", "mood" ON "wellness" FOR EACH ROW EXECUTE FUNCTION "public"."derived_refresh_trigger"();
--> statement-breakpoint
CREATE TRIGGER "anthro_measurement_derived_refresh" AFTER INSERT OR DELETE OR UPDATE OF "player_id", "measured_on", "height_cm", "sitting_height_cm", "weight_kg" ON "anthro_measurement" FOR EACH ROW EXECUTE FUNCTION "public"."derived_refresh_trigger"();
--> statement-breakpoint
CREATE TRIGGER "player_parent_height_derived_refresh" AFTER INSERT OR DELETE OR UPDATE OF "player_id", "parent", "height_cm" ON "player_parent_height" FOR EACH ROW EXECUTE FUNCTION "public"."derived_refresh_trigger"();
--> statement-breakpoint
CREATE TRIGGER "player_derived_refresh" AFTER UPDATE OF "birth_date", "sex", "left_on" ON "player" FOR EACH ROW EXECUTE FUNCTION "public"."derived_refresh_trigger"();
--> statement-breakpoint
CREATE TRIGGER "club_derived_refresh" AFTER UPDATE OF "settings" ON "club" FOR EACH ROW EXECUTE FUNCTION "public"."derived_refresh_trigger"();
--> statement-breakpoint

-- The worker has no club in its context to start from (it only sees the club of the job):
-- this lists the clubs it fans jobs out to, with their zone (the club's day) and whether
-- recalculations are pending. Nothing else about the clubs. Worker only.
CREATE FUNCTION "app"."worker_clubs"()
RETURNS TABLE (club_id uuid, time_zone text, has_pending_refresh boolean)
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.id, c.time_zone,
         EXISTS (SELECT 1 FROM "public"."derived_refresh" r WHERE r.club_id = c.id)
    FROM "public"."club" c
   ORDER BY c.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."worker_clubs"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."worker_clubs"() TO "sport_performance_worker";
