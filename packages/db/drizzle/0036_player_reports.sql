CREATE TYPE "public"."player_report_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "player_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"test_window_id" uuid NOT NULL,
	"status" "player_report_status" DEFAULT 'pending' NOT NULL,
	"format_version" smallint NOT NULL,
	"content" jsonb NOT NULL,
	"file_id" uuid,
	"generated_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_code" text,
	CONSTRAINT "player_report_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "player_report_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "player_report_format_version" CHECK ("player_report"."format_version" >= 1),
	CONSTRAINT "player_report_content_object" CHECK (jsonb_typeof("player_report"."content") = 'object'),
	CONSTRAINT "player_report_attempts" CHECK ("player_report"."attempts" >= 0),
	CONSTRAINT "player_report_ready" CHECK (("player_report"."status" = 'ready') = ("player_report"."file_id" is not null and "player_report"."generated_at" is not null)),
	CONSTRAINT "player_report_failed" CHECK (("player_report"."status" = 'failed') = ("player_report"."failure_code" is not null) and ("player_report"."failure_code" is null or "player_report"."failure_code" in ('invalid_content', 'render_failed', 'too_large', 'storage_failed')))
);
--> statement-breakpoint
ALTER TABLE "player_report" ADD CONSTRAINT "player_report_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_report" ADD CONSTRAINT "player_report_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_report" ADD CONSTRAINT "player_report_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_report" ADD CONSTRAINT "player_report_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_report" ADD CONSTRAINT "player_report_test_window_id_fkey" FOREIGN KEY ("club_id","test_window_id") REFERENCES "public"."test_window"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_report" ADD CONSTRAINT "player_report_file_id_fkey" FOREIGN KEY ("club_id","file_id") REFERENCES "public"."file"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_report_player_idx" ON "player_report" USING btree ("club_id","player_id","created_at");--> statement-breakpoint
CREATE INDEX "player_report_test_window_id_idx" ON "player_report" USING btree ("club_id","test_window_id");--> statement-breakpoint
CREATE INDEX "player_report_file_id_idx" ON "player_report" USING btree ("club_id","file_id") WHERE "player_report"."file_id" is not null;--> statement-breakpoint
CREATE INDEX "player_report_due_idx" ON "player_report" USING btree ("club_id","next_attempt_at") WHERE "player_report"."status" = 'pending';--> statement-breakpoint

-- ─── Hand-written (B-602, ADR 0069) ──────────────────────────────────────────────────
-- `updated_at` trigger of the new club table (see 0001).
CREATE TRIGGER "player_report_set_updated_at" BEFORE UPDATE ON "player_report" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- RLS (ADR 0026): a report is of a player, read with the player scope (the player their own,
-- a guardian their children's, the staff of their assignments, the administration the whole
-- club). The API inserts it as the user who asks for it (sc, admin, superadmin under the
-- matrix), pending and without a file; only the worker completes it. Never deleted: it goes
-- with the player (ADR 0051).
DO $$
DECLARE
  player_scope constant text := '((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.player_report', player_scope,
    '{sc,admin,superadmin}',
    'status = ''pending'' AND file_id IS NULL AND generated_at IS NULL AND attempts = 0 AND failure_code IS NULL AND created_by = (SELECT "app"."current_user_id"())');
END
$$;
--> statement-breakpoint
-- The API never edits a report (the snapshot is what was asked for); the worker only its
-- outcome. Neither rewrites the player, the window or the content.
REVOKE UPDATE ON "public"."player_report" FROM "sport_performance_app";
--> statement-breakpoint
DROP POLICY "player_report_app_update" ON "public"."player_report";
--> statement-breakpoint
REVOKE UPDATE ON "public"."player_report" FROM "sport_performance_worker";
--> statement-breakpoint
GRANT UPDATE ("status", "file_id", "generated_at", "attempts", "next_attempt_at", "failure_code", "updated_at", "updated_by") ON "public"."player_report" TO "sport_performance_worker";
--> statement-breakpoint

-- A finished report (ready or failed) never changes; a pending one only moves forward. The
-- file of a ready report is a `pdf_report` of the same player.
CREATE FUNCTION "public"."player_report_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.player_id, NEW.test_window_id, NEW.format_version, NEW.content)
         IS DISTINCT FROM (OLD.player_id, OLD.test_window_id, OLD.format_version, OLD.content) THEN
      RAISE EXCEPTION 'The player, window and content of a report never change'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'player_report_immutable', TABLE = 'player_report';
    END IF;
    IF OLD.status <> 'pending' AND (NEW.status, NEW.file_id, NEW.generated_at, NEW.failure_code)
         IS DISTINCT FROM (OLD.status, OLD.file_id, OLD.generated_at, OLD.failure_code) THEN
      RAISE EXCEPTION 'A finished report never changes'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'player_report_finished', TABLE = 'player_report';
    END IF;
  END IF;
  IF NEW.file_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "public"."file" f
        WHERE f.club_id = NEW.club_id AND f.id = NEW.file_id
          AND f.kind = 'pdf_report' AND f.player_id = NEW.player_id) THEN
    RAISE EXCEPTION 'The file of a report is a PDF report of the same player'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'player_report_file', TABLE = 'player_report';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."player_report_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "player_report_guard" BEFORE INSERT OR UPDATE ON "public"."player_report"
  FOR EACH ROW EXECUTE FUNCTION "public"."player_report_guard"();
--> statement-breakpoint

-- Low-latency path to the worker: a new report notifies on commit (payload: the club id),
-- like the derived outbox (0021). Correctness does not depend on it: the worker's sweep
-- lists the clubs with due reports every minute through `app.worker_report_clubs()`.
CREATE FUNCTION "public"."player_report_notify"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_notify('sport_performance_player_report', NEW.club_id::text);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."player_report_notify"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "player_report_notify" AFTER INSERT ON "public"."player_report"
  FOR EACH ROW EXECUTE FUNCTION "public"."player_report_notify"();
--> statement-breakpoint

-- The clubs with a pending report that is due: the worker's only cross-club read of reports
-- (ids, nothing else), like `app.worker_clubs()`.
CREATE FUNCTION "app"."worker_report_clubs"()
RETURNS TABLE (club_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT DISTINCT r.club_id FROM "public"."player_report" r
   WHERE r.status = 'pending' AND r.next_attempt_at <= now()
   ORDER BY r.club_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."worker_report_clubs"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."worker_report_clubs"() TO "sport_performance_worker";
