CREATE TYPE "medical"."menarche_date_precision" AS ENUM('day', 'month', 'year');--> statement-breakpoint
CREATE TYPE "medical"."menarche_reporter" AS ENUM('player', 'parent', 'medical');--> statement-breakpoint
CREATE TYPE "medical"."menarche_status" AS ENUM('not_yet', 'occurred');--> statement-breakpoint
CREATE TABLE "medical"."menarche_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"status" "medical"."menarche_status" NOT NULL,
	"occurred_on" date,
	"precision" "medical"."menarche_date_precision",
	"reported_on" date NOT NULL,
	"reported_by" "medical"."menarche_reporter" NOT NULL,
	CONSTRAINT "menarche_report_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "menarche_report_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "menarche_report_date" CHECK (("medical"."menarche_report"."status" = 'occurred') = ("medical"."menarche_report"."occurred_on" is not null) and ("medical"."menarche_report"."occurred_on" is null) = ("medical"."menarche_report"."precision" is null)),
	CONSTRAINT "menarche_report_date_truncated" CHECK ("medical"."menarche_report"."precision" is null or "medical"."menarche_report"."precision" = 'day' or (extract(day from "medical"."menarche_report"."occurred_on") = 1 and ("medical"."menarche_report"."precision" = 'month' or extract(month from "medical"."menarche_report"."occurred_on") = 1))),
	CONSTRAINT "menarche_report_date_not_after_report" CHECK ("medical"."menarche_report"."occurred_on" is null or "medical"."menarche_report"."occurred_on" <= "medical"."menarche_report"."reported_on")
);
--> statement-breakpoint
ALTER TABLE "medical"."menarche_report" ADD CONSTRAINT "menarche_report_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menarche_report" ADD CONSTRAINT "menarche_report_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menarche_report" ADD CONSTRAINT "menarche_report_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menarche_report" ADD CONSTRAINT "menarche_report_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menarche_report_player_idx" ON "medical"."menarche_report" USING btree ("club_id","player_id","created_at");
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════
-- Hand-written part (B-805, ADR 0087): the menarche of a girl, optional health data in the
-- `medical` schema with the rules of ADR 0029:
--
--   * The connection roles read nothing of it, not even the id. Reads go through
--     `medical.read_menarche_reports(...)`, which filters by club and scope (the player, the
--     guardian of a minor and the assigned medical staff, all with a current health consent)
--     and logs every read.
--   * The player, her guardian while she is a minor (both with `data` and `health`
--     consents) or the assigned medical staff (with `health`) write it, as its author and
--     with their validated role (`reported_by`), on the club's day. INSERT only:
--     append-only, the latest report counts.
--   * Only for girls (`player.sex = 'female'`).
--   * Every write is logged by `medical.log_write` (column names, never values).
DO $$
BEGIN
  IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
    RAISE EXCEPTION 'Migrations must run as a superuser or a role with BYPASSRLS (connected as %)', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
--> statement-breakpoint

-- ─── Write scope ─────────────────────────────────────────────────────────────────────
-- Matrix: menarche.report = player self+data+health, parent guardian+data+health+minor,
-- medical assigned+health. Called by the insert policy below, as the invoker.
CREATE FUNCTION "medical"."may_report_menarche"(player uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE "app"."current_role"()
    WHEN 'player' THEN
      player = ANY ("app"."visible_player_ids"())
      AND ARRAY['data', 'health']::"public"."consent_type"[] <@ "app"."current_consent_types"(player)
    WHEN 'parent' THEN
      player = ANY ("app"."visible_player_ids"())
      AND "medical"."is_minor"(player)
      AND ARRAY['data', 'health']::"public"."consent_type"[] <@ "app"."current_consent_types"(player)
    WHEN 'medical' THEN "medical"."may_write"(player, true)
    ELSE false
  END
$$;
--> statement-breakpoint

-- ─── Guards ──────────────────────────────────────────────────────────────────────────
-- A report is about a girl and dated on the club's day (the API cannot backdate it: the
-- "as of" of `not_yet` is the day it was said); the owner's maintenance writes may set the
-- day. A player the row does not reach (another club) is left to the policy and the
-- foreign key.
CREATE FUNCTION "medical"."menarche_report_insert_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  player_sex "public"."sex";
BEGIN
  SELECT p.sex INTO player_sex FROM "public"."player" p
   WHERE p.club_id = NEW.club_id AND p.id = NEW.player_id;
  IF FOUND AND player_sex <> 'female' THEN
    RAISE EXCEPTION 'Menarche is recorded only for girls'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'menarche_report_female', TABLE = 'menarche_report';
  END IF;
  IF NEW.reported_on IS DISTINCT FROM "app"."club_today"()
     AND NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) THEN
    RAISE EXCEPTION 'A menarche report is dated on the club''s day'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'menarche_report_today', TABLE = 'menarche_report';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Append-only: a report never changes. Its authors become NULL when their account is
-- deleted (`ON DELETE SET NULL`, ADR 0051): the only change allowed.
CREATE FUNCTION "medical"."menarche_report_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.club_id, NEW.client_uuid, NEW.player_id, NEW.status, NEW.occurred_on,
      NEW.precision, NEW.reported_on, NEW.reported_by, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.club_id, OLD.client_uuid, OLD.player_id, OLD.status, OLD.occurred_on,
      OLD.precision, OLD.reported_on, OLD.reported_by, OLD.created_at)
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL)
     OR (NEW.updated_by IS DISTINCT FROM OLD.updated_by AND NEW.updated_by IS NOT NULL) THEN
    RAISE EXCEPTION 'A menarche report is append-only: report again'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'menarche_report_append_only', TABLE = 'menarche_report';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "menarche_report_insert_guard" BEFORE INSERT ON "medical"."menarche_report"
  FOR EACH ROW EXECUTE FUNCTION "medical"."menarche_report_insert_guard"();
--> statement-breakpoint
CREATE TRIGGER "menarche_report_guard" BEFORE UPDATE ON "medical"."menarche_report"
  FOR EACH ROW EXECUTE FUNCTION "medical"."menarche_report_guard"();
--> statement-breakpoint

-- ─── RLS, grants and the write log ───────────────────────────────────────────────────
ALTER TABLE "medical"."menarche_report" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "medical"."menarche_report" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "menarche_report_app_club" ON "medical"."menarche_report" AS RESTRICTIVE FOR ALL TO "sport_performance_app"
  USING (club_id = (SELECT "app"."current_club_id"())) WITH CHECK (club_id = (SELECT "app"."current_club_id"()));
--> statement-breakpoint
-- The player, her guardian or the medical staff, as its author and with its validated role.
CREATE POLICY "menarche_report_app_insert" ON "medical"."menarche_report" FOR INSERT TO "sport_performance_app"
  WITH CHECK ("medical"."may_report_menarche"(player_id) AND created_by = "app"."current_user_id"()
              AND updated_by = created_by AND reported_by::text = "app"."current_role"());
--> statement-breakpoint
GRANT INSERT ("id", "club_id", "client_uuid", "player_id", "status", "occurred_on", "precision",
              "reported_on", "reported_by", "created_by", "updated_by")
  ON "medical"."menarche_report" TO "sport_performance_app";
--> statement-breakpoint
CREATE TRIGGER "menarche_report_set_updated_at" BEFORE UPDATE ON "medical"."menarche_report"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "menarche_report_log_write" AFTER INSERT OR UPDATE OR DELETE ON "medical"."menarche_report"
  FOR EACH ROW EXECUTE FUNCTION "medical"."log_write"();
--> statement-breakpoint

-- ─── Read scope (0040), now with the menarche ────────────────────────────────────────
--   menarche_report  the player, the guardian of a minor and the assigned `medical`, all
--                    of them with a health consent (revoking it hides the record from the
--                    medical staff too: the record exists only by the holder's opt-in).
-- The rest is unchanged.
CREATE OR REPLACE FUNCTION "medical"."readable_players"(resource text, requested uuid[]) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  club uuid := "app"."current_club_id"();
  ctx_role text := "app"."current_role"();
  scope uuid[];
BEGIN
  IF club IS NULL OR ctx_role IS NULL THEN
    RAISE EXCEPTION 'Medical data needs a validated tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF "app"."current_request_id"() IS NULL THEN
    RAISE EXCEPTION 'Medical data is read only within a request (app.request_id is not set)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF resource = 'availability' THEN
    IF "app"."sees_whole_club"() THEN
      SELECT array_agg(p.id) INTO scope FROM "public"."player" p
       WHERE p.club_id = club AND (requested IS NULL OR p.id = ANY (requested));
    ELSE
      SELECT array_agg(v) INTO scope FROM unnest("app"."visible_player_ids"()) v
       WHERE requested IS NULL OR v = ANY (requested);
    END IF;
  ELSIF ctx_role = 'medical' AND resource = 'menarche_report' THEN
    SELECT array_agg(v) INTO scope FROM unnest("app"."visible_player_ids"()) v
     WHERE (requested IS NULL OR v = ANY (requested))
       AND "medical"."has_health_consent"(v);
  ELSIF ctx_role = 'medical' AND resource IN ('injury', 'concussion', 'concussion_stage', 'hold', 'note', 'pain_report') THEN
    SELECT array_agg(v) INTO scope FROM unnest("app"."visible_player_ids"()) v
     WHERE requested IS NULL OR v = ANY (requested);
  ELSIF ctx_role IN ('player', 'parent') AND resource IN ('injury', 'concussion', 'concussion_stage', 'note', 'pain_report', 'menarche_report') THEN
    SELECT array_agg(v) INTO scope FROM unnest("app"."visible_player_ids"()) v
     WHERE (requested IS NULL OR v = ANY (requested))
       AND "medical"."has_health_consent"(v)
       AND (ctx_role = 'player' OR "medical"."is_minor"(v));
  ELSE
    RAISE EXCEPTION 'The % role cannot read medical %', ctx_role, resource
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN coalesce(scope, '{}');
END;
$$;
--> statement-breakpoint

-- ─── medical.read_menarche_reports: the logged read ──────────────────────────────────
CREATE TYPE "medical"."menarche_report_entry" AS (
  "id" uuid,
  "client_uuid" uuid,
  "player_id" uuid,
  "status" "medical"."menarche_status",
  "occurred_on" date,
  "precision" "medical"."menarche_date_precision",
  "reported_on" date,
  "reported_by" "medical"."menarche_reporter",
  "created_at" timestamp with time zone,
  "created_by" text
);
--> statement-breakpoint

-- The reports the context may read (`player_ids` NULL: all of them), newest first by
-- (created_at, id), after the keyset (`before_at`, `before_id`) when given, at most
-- `max_rows` (1 to 101: a page and one more), and only the ones created with `client_uuids`
-- (a repeated send) or with the ids `report_ids` when given. Logs a `read` row per player
-- read and asked for.
CREATE FUNCTION "medical"."read_menarche_reports"(
  player_ids uuid[] DEFAULT NULL,
  before_at timestamp with time zone DEFAULT NULL,
  before_id uuid DEFAULT NULL,
  max_rows integer DEFAULT 101,
  client_uuids uuid[] DEFAULT NULL,
  report_ids uuid[] DEFAULT NULL
) RETURNS SETOF "medical"."menarche_report_entry"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope uuid[] := "medical"."readable_players"('menarche_report', player_ids);
  club constant uuid := "app"."current_club_id"();
  result "medical"."menarche_report_entry"[];
BEGIN
  IF max_rows IS NULL OR max_rows < 1 OR max_rows > 101 THEN
    RAISE EXCEPTION 'max_rows is from 1 to 101' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (before_at IS NULL) <> (before_id IS NULL) THEN
    RAISE EXCEPTION 'The keyset is both before_at and before_id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT coalesce(array_agg(ROW(x.id, x.client_uuid, x.player_id, x.status, x.occurred_on, x.precision,
                                x.reported_on, x.reported_by, x.created_at,
                                x.created_by)::"medical"."menarche_report_entry"
                            ORDER BY x.created_at DESC, x.id DESC), '{}')
    INTO result
    FROM (
      SELECT r.id, r.client_uuid, r.player_id, r.status, r.occurred_on, r.precision, r.reported_on,
             r.reported_by, r.created_at, r.created_by
        FROM "medical"."menarche_report" r
       WHERE r.club_id = club AND r.player_id = ANY (scope)
         AND (before_at IS NULL OR (r.created_at, r.id) < (before_at, before_id))
         AND (client_uuids IS NULL OR r.client_uuid = ANY (client_uuids))
         AND (report_ids IS NULL OR r.id = ANY (report_ids))
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT max_rows
    ) x;
  PERFORM "medical"."log_read"('menarche_report', player_ids,
    ARRAY(SELECT r.player_id FROM unnest(result) r), ARRAY(SELECT r.id FROM unnest(result) r));
  RETURN QUERY SELECT * FROM unnest(result);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  "medical"."may_report_menarche"(uuid),
  "medical"."menarche_report_insert_guard"(),
  "medical"."menarche_report_guard"(),
  "medical"."read_menarche_reports"(uuid[], timestamp with time zone, uuid, integer, uuid[], uuid[])
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  "medical"."may_report_menarche"(uuid),
  "medical"."read_menarche_reports"(uuid[], timestamp with time zone, uuid, integer, uuid[], uuid[])
  TO "sport_performance_app";
