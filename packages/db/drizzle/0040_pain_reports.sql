ALTER TYPE "public"."sync_operation" ADD VALUE 'pain_report.submit';--> statement-breakpoint
CREATE TABLE "medical"."pain_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"has_pain" boolean NOT NULL,
	"comment" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	CONSTRAINT "pain_report_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "pain_report_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "pain_report_club_id_id_player_id_key" UNIQUE("club_id","id","player_id"),
	CONSTRAINT "pain_report_comment" CHECK ("medical"."pain_report"."comment" is null or ("medical"."pain_report"."has_pain" and btrim("medical"."pain_report"."comment") <> '' and char_length("medical"."pain_report"."comment") <= 280)),
	CONSTRAINT "pain_report_review" CHECK (("medical"."pain_report"."reviewed_at" is null) = ("medical"."pain_report"."reviewed_by" is null))
);
--> statement-breakpoint
CREATE TABLE "medical"."pain_report_area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"body_region" "medical"."injury_body_region" NOT NULL,
	"side" "medical"."injury_side" NOT NULL,
	"intensity" smallint NOT NULL,
	CONSTRAINT "pain_report_area_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "pain_report_area_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "pain_report_area_key" UNIQUE("club_id","report_id","body_region","side"),
	CONSTRAINT "pain_report_area_region" CHECK ("medical"."pain_report_area"."body_region" <> 'other'),
	CONSTRAINT "pain_report_area_side" CHECK ("medical"."pain_report_area"."side" in ('left', 'right', 'central')),
	CONSTRAINT "pain_report_area_side_of_region" CHECK (("medical"."pain_report_area"."side" = 'central') = ("medical"."pain_report_area"."body_region" in ('head_face', 'neck', 'chest', 'thoracic_spine', 'lumbar_spine', 'abdomen'))),
	CONSTRAINT "pain_report_area_intensity" CHECK ("medical"."pain_report_area"."intensity" between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "medical"."pain_report" ADD CONSTRAINT "pain_report_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."pain_report" ADD CONSTRAINT "pain_report_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."pain_report" ADD CONSTRAINT "pain_report_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."pain_report" ADD CONSTRAINT "pain_report_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."pain_report" ADD CONSTRAINT "pain_report_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."pain_report_area" ADD CONSTRAINT "pain_report_area_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."pain_report_area" ADD CONSTRAINT "pain_report_area_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."pain_report_area" ADD CONSTRAINT "pain_report_area_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."pain_report_area" ADD CONSTRAINT "pain_report_area_report_id_fkey" FOREIGN KEY ("club_id","report_id","player_id") REFERENCES "medical"."pain_report"("club_id","id","player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pain_report_player_idx" ON "medical"."pain_report" USING btree ("club_id","player_id","local_date");--> statement-breakpoint
CREATE INDEX "pain_report_recent_idx" ON "medical"."pain_report" USING btree ("club_id","created_at","id");
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════
-- Hand-written part (B-609, ADR 0074): access to the pain reports of the wellness, in the
-- `medical` schema with the rules of ADR 0029, except that the writer is the player:
--
--   * The connection roles read no clinical column. Reads go through
--     `medical.read_pain_reports(...)`, which filters by club and scope (the assigned medical
--     staff; the holder with a health consent) and logs every read.
--   * Only the player writes their own report (validated role `player`, their own player,
--     current `data` and `health` consents, as the author), INSERT only and only the columns
--     of the answer: append-only. Areas go in with their report, in the same transaction, and
--     a report with pain has at least one (deferred trigger).
--   * The assigned medical staff marks a report as reviewed, once, signed by who reviews.
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

-- ─── Write scope of the player ───────────────────────────────────────────────────────
-- The validated role is `player`, `player` is the context's own player and has current
-- `data` and `health` consents (matrix: pain_report.submit = self+data+health). Called by
-- the policies below, as the invoker.
CREATE FUNCTION "medical"."may_report_pain"(player uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce("app"."current_role"() = 'player', false)
     AND player = ANY ("app"."visible_player_ids"())
     AND ARRAY['data', 'health']::"public"."consent_type"[] <@ "app"."current_consent_types"(player)
$$;
--> statement-breakpoint

-- ─── Guards ──────────────────────────────────────────────────────────────────────────
-- A report never changes but for its review: once, by the acting user, at the time of the
-- review (`now()`), never undone. The author becomes NULL when their account is deleted
-- (`ON DELETE SET NULL`, ADR 0051): that is the only change to it allowed.
CREATE FUNCTION "medical"."pain_report_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.player_id, NEW.local_date, NEW.has_pain, NEW.comment, NEW.client_uuid, NEW.created_at)
     IS DISTINCT FROM (OLD.player_id, OLD.local_date, OLD.has_pain, OLD.comment, OLD.client_uuid, OLD.created_at)
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL) THEN
    RAISE EXCEPTION 'A pain report is append-only: the player answers again'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pain_report_append_only', TABLE = 'pain_report';
  END IF;
  IF OLD.reviewed_at IS NOT NULL
     AND (NEW.reviewed_at, NEW.reviewed_by) IS DISTINCT FROM (OLD.reviewed_at, OLD.reviewed_by) THEN
    RAISE EXCEPTION 'A pain report is reviewed once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pain_report_review_final', TABLE = 'pain_report';
  END IF;
  IF NEW.reviewed_by IS NOT NULL AND OLD.reviewed_by IS NULL
     AND NOT "medical"."acting_user_is"(NEW.reviewed_by) THEN
    RAISE EXCEPTION 'A pain report is reviewed by the user who reviews it'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pain_report_review_signer', TABLE = 'pain_report';
  END IF;
  IF NEW.reviewed_at IS NOT NULL AND OLD.reviewed_at IS NULL AND NEW.reviewed_at <> now()
     AND NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) THEN
    RAISE EXCEPTION 'A pain report is reviewed at the time of the review'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pain_report_review_now', TABLE = 'pain_report';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- An area goes in with its report: in the same transaction (the report's `created_at` is
-- this transaction's start, a column the API cannot write), only on a report with pain, at
-- most 12 per report (PAIN_AREAS_MAX of the domain). The report is locked, so concurrent
-- inserts count each other. Areas never change (no UPDATE grant).
CREATE FUNCTION "medical"."pain_report_area_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  parent "medical"."pain_report";
BEGIN
  SELECT * INTO parent FROM "medical"."pain_report" r
   WHERE r.club_id = NEW.club_id AND r.id = NEW.report_id FOR UPDATE;
  IF parent.id IS NULL THEN
    -- The foreign key answers.
    RETURN NEW;
  END IF;
  IF NOT parent.has_pain THEN
    RAISE EXCEPTION 'An answer without pain has no areas'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pain_report_area_needs_pain', TABLE = 'pain_report_area';
  END IF;
  IF parent.created_at <> now()
     AND NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) THEN
    RAISE EXCEPTION 'The areas of a pain report go in with the report'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pain_report_area_with_report', TABLE = 'pain_report_area';
  END IF;
  IF (SELECT count(*) FROM "medical"."pain_report_area" a
       WHERE a.club_id = NEW.club_id AND a.report_id = NEW.report_id) >= 12 THEN
    RAISE EXCEPTION 'A pain report has at most 12 areas'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pain_report_area_max', TABLE = 'pain_report_area';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- At commit: a report with pain has at least one area.
CREATE FUNCTION "medical"."pain_report_has_areas"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.has_pain AND NOT EXISTS (SELECT 1 FROM "medical"."pain_report_area" a
                                   WHERE a.club_id = NEW.club_id AND a.report_id = NEW.id) THEN
    RAISE EXCEPTION 'A pain report with pain has at least one area'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pain_report_areas_required', TABLE = 'pain_report';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "pain_report_guard" BEFORE UPDATE ON "medical"."pain_report"
  FOR EACH ROW EXECUTE FUNCTION "medical"."pain_report_guard"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "pain_report_has_areas" AFTER INSERT ON "medical"."pain_report"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "medical"."pain_report_has_areas"();
--> statement-breakpoint
CREATE TRIGGER "pain_report_area_guard" BEFORE INSERT ON "medical"."pain_report_area"
  FOR EACH ROW EXECUTE FUNCTION "medical"."pain_report_area_guard"();
--> statement-breakpoint

-- ─── RLS, grants and the write log ───────────────────────────────────────────────────
ALTER TABLE "medical"."pain_report" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "medical"."pain_report" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "medical"."pain_report_area" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "medical"."pain_report_area" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "pain_report_app_club" ON "medical"."pain_report" AS RESTRICTIVE FOR ALL TO "sport_performance_app"
  USING (club_id = (SELECT "app"."current_club_id"())) WITH CHECK (club_id = (SELECT "app"."current_club_id"()));
--> statement-breakpoint
CREATE POLICY "pain_report_area_app_club" ON "medical"."pain_report_area" AS RESTRICTIVE FOR ALL TO "sport_performance_app"
  USING (club_id = (SELECT "app"."current_club_id"())) WITH CHECK (club_id = (SELECT "app"."current_club_id"()));
--> statement-breakpoint
-- The player writes their own answer, as its author.
CREATE POLICY "pain_report_app_insert" ON "medical"."pain_report" FOR INSERT TO "sport_performance_app"
  WITH CHECK ("medical"."may_report_pain"(player_id) AND created_by = "app"."current_user_id"()
              AND updated_by = created_by);
--> statement-breakpoint
CREATE POLICY "pain_report_area_app_insert" ON "medical"."pain_report_area" FOR INSERT TO "sport_performance_app"
  WITH CHECK ("medical"."may_report_pain"(player_id) AND created_by = "app"."current_user_id"()
              AND updated_by = created_by);
--> statement-breakpoint
-- The assigned medical staff finds (by id only) and reviews a report.
CREATE POLICY "pain_report_app_select" ON "medical"."pain_report" FOR SELECT TO "sport_performance_app"
  USING ("medical"."may_write"(player_id, false));
--> statement-breakpoint
CREATE POLICY "pain_report_app_update" ON "medical"."pain_report" FOR UPDATE TO "sport_performance_app"
  USING ("medical"."may_write"(player_id, false)) WITH CHECK ("medical"."may_write"(player_id, false));
--> statement-breakpoint
GRANT SELECT ("id"),
  INSERT ("id", "club_id", "client_uuid", "player_id", "local_date", "has_pain", "comment", "created_by", "updated_by"),
  UPDATE ("reviewed_at", "reviewed_by", "updated_by")
  ON "medical"."pain_report" TO "sport_performance_app";
--> statement-breakpoint
GRANT INSERT ("id", "club_id", "client_uuid", "player_id", "report_id", "body_region", "side", "intensity", "created_by", "updated_by")
  ON "medical"."pain_report_area" TO "sport_performance_app";
--> statement-breakpoint
CREATE TRIGGER "pain_report_set_updated_at" BEFORE UPDATE ON "medical"."pain_report"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "pain_report_area_set_updated_at" BEFORE UPDATE ON "medical"."pain_report_area"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "pain_report_log_write" AFTER INSERT OR UPDATE ON "medical"."pain_report"
  FOR EACH ROW EXECUTE FUNCTION "medical"."log_write"();
--> statement-breakpoint
CREATE TRIGGER "pain_report_area_log_write" AFTER INSERT OR UPDATE ON "medical"."pain_report_area"
  FOR EACH ROW EXECUTE FUNCTION "medical"."log_write"();
--> statement-breakpoint

-- ─── Read scope (0007), now with the pain reports ────────────────────────────────────
--   pain_report   `medical` (assigned) and the holder: the player, and the guardian of a
--                 minor, both with a health consent (like the record, ADR 0029).
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
  ELSIF ctx_role = 'medical' AND resource IN ('injury', 'concussion', 'concussion_stage', 'hold', 'note', 'pain_report') THEN
    SELECT array_agg(v) INTO scope FROM unnest("app"."visible_player_ids"()) v
     WHERE requested IS NULL OR v = ANY (requested);
  ELSIF ctx_role IN ('player', 'parent') AND resource IN ('injury', 'concussion', 'concussion_stage', 'note', 'pain_report') THEN
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

-- ─── medical.read_pain_reports: the logged read ──────────────────────────────────────
-- A report with its areas (JSON, in the vocabulary's order of regions and sides).
CREATE TYPE "medical"."pain_report_entry" AS (
  "id" uuid,
  "client_uuid" uuid,
  "player_id" uuid,
  "local_date" date,
  "has_pain" boolean,
  "comment" text,
  "created_at" timestamp with time zone,
  "created_by" text,
  "reviewed_at" timestamp with time zone,
  "reviewed_by" text,
  "areas" jsonb
);
--> statement-breakpoint

-- The reports the context may read (`player_ids` NULL: all of them) with `local_date` in
-- [from_date, to_date] (each optional), only the ones not reviewed yet when `only_pending`,
-- newest first by (created_at, id), after the keyset (`before_at`, `before_id`; exact to the
-- microsecond, as the API cursor carries it), at most
-- `max_rows` (1 to 101: a page and one more), and only the reports created with `client_uuids`
-- (a replay of the offline queue) or with the ids `report_ids` when given. Logs a `read` row per player read and asked for.
CREATE FUNCTION "medical"."read_pain_reports"(
  player_ids uuid[] DEFAULT NULL,
  from_date date DEFAULT NULL,
  to_date date DEFAULT NULL,
  only_pending boolean DEFAULT false,
  before_at timestamp with time zone DEFAULT NULL,
  before_id uuid DEFAULT NULL,
  max_rows integer DEFAULT 101,
  client_uuids uuid[] DEFAULT NULL,
  report_ids uuid[] DEFAULT NULL
) RETURNS SETOF "medical"."pain_report_entry"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope uuid[] := "medical"."readable_players"('pain_report', player_ids);
  club constant uuid := "app"."current_club_id"();
  result "medical"."pain_report_entry"[];
BEGIN
  IF max_rows IS NULL OR max_rows < 1 OR max_rows > 101 THEN
    RAISE EXCEPTION 'max_rows is from 1 to 101' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (before_at IS NULL) <> (before_id IS NULL) THEN
    RAISE EXCEPTION 'The keyset is both before_at and before_id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT coalesce(array_agg(ROW(x.id, x.client_uuid, x.player_id, x.local_date, x.has_pain, x.comment,
                                x.created_at, x.created_by, x.reviewed_at, x.reviewed_by,
                                x.areas)::"medical"."pain_report_entry"
                            ORDER BY x.created_at DESC, x.id DESC), '{}')
    INTO result
    FROM (
      SELECT r.id, r.client_uuid, r.player_id, r.local_date, r.has_pain, r.comment, r.created_at,
             r.created_by, r.reviewed_at, r.reviewed_by,
             coalesce((SELECT jsonb_agg(jsonb_build_object('region', a.body_region, 'side', a.side,
                                                           'intensity', a.intensity)
                                        ORDER BY a.body_region, a.side)
                         FROM "medical"."pain_report_area" a
                        WHERE a.club_id = r.club_id AND a.report_id = r.id), '[]'::jsonb) AS areas
        FROM "medical"."pain_report" r
       WHERE r.club_id = club AND r.player_id = ANY (scope)
         AND (from_date IS NULL OR r.local_date >= from_date)
         AND (to_date IS NULL OR r.local_date <= to_date)
         AND (NOT coalesce(only_pending, false) OR r.reviewed_at IS NULL)
         AND (before_at IS NULL OR (r.created_at, r.id) < (before_at, before_id))
         AND (client_uuids IS NULL OR r.client_uuid = ANY (client_uuids))
         AND (report_ids IS NULL OR r.id = ANY (report_ids))
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT max_rows
    ) x;
  PERFORM "medical"."log_read"('pain_report', player_ids,
    ARRAY(SELECT r.player_id FROM unnest(result) r), ARRAY(SELECT r.id FROM unnest(result) r));
  RETURN QUERY SELECT * FROM unnest(result);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  "medical"."may_report_pain"(uuid),
  "medical"."pain_report_guard"(),
  "medical"."pain_report_area_guard"(),
  "medical"."pain_report_has_areas"(),
  "medical"."read_pain_reports"(uuid[], date, date, boolean, timestamp with time zone, uuid, integer, uuid[], uuid[])
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  "medical"."may_report_pain"(uuid),
  "medical"."read_pain_reports"(uuid[], date, date, boolean, timestamp with time zone, uuid, integer, uuid[], uuid[])
  TO "sport_performance_app";