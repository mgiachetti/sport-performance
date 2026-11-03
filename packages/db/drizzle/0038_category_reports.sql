ALTER TYPE "public"."file_kind" ADD VALUE 'category_report';--> statement-breakpoint
CREATE TABLE "category_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"test_window_id" uuid NOT NULL,
	"status" "player_report_status" DEFAULT 'pending' NOT NULL,
	"format_version" smallint NOT NULL,
	"content" jsonb NOT NULL,
	"file_id" uuid,
	"generated_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_code" text,
	CONSTRAINT "category_report_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "category_report_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "category_report_format_version" CHECK ("category_report"."format_version" >= 1),
	CONSTRAINT "category_report_content_object" CHECK (jsonb_typeof("category_report"."content") = 'object'),
	CONSTRAINT "category_report_attempts" CHECK ("category_report"."attempts" >= 0),
	CONSTRAINT "category_report_ready" CHECK (("category_report"."status" = 'ready') = ("category_report"."file_id" is not null and "category_report"."generated_at" is not null)),
	CONSTRAINT "category_report_failed" CHECK (("category_report"."status" = 'failed') = ("category_report"."failure_code" is not null) and ("category_report"."failure_code" is null or "category_report"."failure_code" in ('invalid_content', 'render_failed', 'too_large', 'storage_failed', 'attempts_exhausted', 'internal_error')))
);
--> statement-breakpoint
ALTER TABLE "file" DROP CONSTRAINT "file_subject";--> statement-breakpoint
ALTER TABLE "category_report" ADD CONSTRAINT "category_report_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_report" ADD CONSTRAINT "category_report_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_report" ADD CONSTRAINT "category_report_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_report" ADD CONSTRAINT "category_report_category_id_fkey" FOREIGN KEY ("club_id","category_id") REFERENCES "public"."category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_report" ADD CONSTRAINT "category_report_test_window_id_fkey" FOREIGN KEY ("club_id","test_window_id") REFERENCES "public"."test_window"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_report" ADD CONSTRAINT "category_report_file_id_fkey" FOREIGN KEY ("club_id","file_id") REFERENCES "public"."file"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_report_category_idx" ON "category_report" USING btree ("club_id","category_id","created_at");--> statement-breakpoint
CREATE INDEX "category_report_test_window_id_idx" ON "category_report" USING btree ("club_id","test_window_id");--> statement-breakpoint
CREATE INDEX "category_report_file_id_idx" ON "category_report" USING btree ("club_id","file_id") WHERE "category_report"."file_id" is not null;--> statement-breakpoint
CREATE INDEX "category_report_due_idx" ON "category_report" USING btree ("club_id","next_attempt_at") WHERE "category_report"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_subject" CHECK ((("file"."kind"::text in ('cmj_video', 'pdf_report')) = ("file"."player_id" is not null) or ("file"."status" = 'deleted' and "file"."player_id" is null)) and ("file"."category_id" is null or "file"."kind"::text in ('data_import', 'category_report')) and ("file"."kind"::text not in ('category_report') or "file"."category_id" is not null));--> statement-breakpoint

-- ─── Hand-written (B-603, ADR 0073) ──────────────────────────────────────────────────
-- `updated_at` trigger of the new club table (see 0001).
CREATE TRIGGER "category_report_set_updated_at" BEFORE UPDATE ON "category_report" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- RLS (ADR 0026, permission matrix `category_report`): a report is of a category, read by the
-- staff assigned to it (coach, sc, medical: `app.assigned_category_ids()`) and by the
-- administration; never by a player or a guardian. The API inserts it as the user who asks
-- for it (sc, admin, superadmin under the matrix), pending and without a file; only the
-- worker completes it. Never deleted: it holds aggregates only, of no player.
DO $$
DECLARE
  category_scope constant text := '((SELECT "app"."sees_whole_club"()) OR category_id = ANY ((SELECT "app"."assigned_category_ids"())::uuid[]))';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.category_report', category_scope,
    '{sc,admin,superadmin}',
    'status = ''pending'' AND file_id IS NULL AND generated_at IS NULL AND attempts = 0 AND failure_code IS NULL AND created_by = (SELECT "app"."current_user_id"())');
END
$$;
--> statement-breakpoint
-- The API never edits a report (the snapshot is what was asked for); the worker only its
-- outcome. Neither rewrites the category, the window or the content.
REVOKE UPDATE ON "public"."category_report" FROM "sport_performance_app";
--> statement-breakpoint
DROP POLICY "category_report_app_update" ON "public"."category_report";
--> statement-breakpoint
REVOKE UPDATE ON "public"."category_report" FROM "sport_performance_worker";
--> statement-breakpoint
GRANT UPDATE ("status", "file_id", "generated_at", "attempts", "next_attempt_at", "failure_code", "updated_at", "updated_by") ON "public"."category_report" TO "sport_performance_worker";
--> statement-breakpoint

-- A finished report (ready or failed) never changes; a pending one only moves forward. The
-- file of a ready report is a `category_report` file of the same category (compared as text:
-- the enum value is added by this migration).
CREATE FUNCTION "public"."category_report_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.category_id, NEW.test_window_id, NEW.format_version, NEW.content)
         IS DISTINCT FROM (OLD.category_id, OLD.test_window_id, OLD.format_version, OLD.content) THEN
      RAISE EXCEPTION 'The category, window and content of a report never change'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'category_report_immutable', TABLE = 'category_report';
    END IF;
    IF OLD.status <> 'pending' AND (NEW.status, NEW.file_id, NEW.generated_at, NEW.failure_code)
         IS DISTINCT FROM (OLD.status, OLD.file_id, OLD.generated_at, OLD.failure_code) THEN
      RAISE EXCEPTION 'A finished report never changes'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'category_report_finished', TABLE = 'category_report';
    END IF;
  END IF;
  IF NEW.file_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "public"."file" f
        WHERE f.club_id = NEW.club_id AND f.id = NEW.file_id
          AND f.kind::text = 'category_report' AND f.category_id = NEW.category_id) THEN
    RAISE EXCEPTION 'The file of a report is a category report of the same category'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'category_report_file', TABLE = 'category_report';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."category_report_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "category_report_guard" BEFORE INSERT OR UPDATE ON "public"."category_report"
  FOR EACH ROW EXECUTE FUNCTION "public"."category_report_guard"();
--> statement-breakpoint

-- Low-latency path to the worker, on the channel of the player reports (0036): the same job
-- renders both. Correctness does not depend on it: the sweep below lists the clubs anyway.
CREATE FUNCTION "public"."category_report_notify"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_notify('sport_performance_player_report', NEW.club_id::text);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."category_report_notify"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "category_report_notify" AFTER INSERT ON "public"."category_report"
  FOR EACH ROW EXECUTE FUNCTION "public"."category_report_notify"();
--> statement-breakpoint

-- The clubs with a pending report that is due, of a player or of a category (0036): still
-- the worker's only cross-club read of reports (ids, nothing else).
CREATE OR REPLACE FUNCTION "app"."worker_report_clubs"()
RETURNS TABLE (club_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT r.club_id FROM "public"."player_report" r
   WHERE r.status = 'pending' AND r.next_attempt_at <= now()
  UNION
  SELECT r.club_id FROM "public"."category_report" r
   WHERE r.status = 'pending' AND r.next_attempt_at <= now()
  ORDER BY 1
$$;
--> statement-breakpoint

-- Who reads a file (0020, 0035, 0037), now with the category reports: a `category_report`
-- PDF is read by whoever reads its report (the staff of the category, the administration),
-- so the file follows the RLS of `category_report`. Compared as text: a value added to an
-- enum cannot be used as such in the transaction that adds it.
DROP POLICY "file_app_select" ON "public"."file";
--> statement-breakpoint
DROP POLICY "file_app_insert" ON "public"."file";
--> statement-breakpoint
DROP POLICY "file_app_update" ON "public"."file";
--> statement-breakpoint
DO $$
DECLARE
  member constant text := '(SELECT "app"."current_role"()) IS NOT NULL';
  staff constant text := "app_admin"."role_in"('{coach,sc,medical,admin,superadmin}');
  writers constant text := "app_admin"."role_in"('{sc,admin,superadmin}');
  player_scope constant text := '((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))';
  export_scope constant text := 'EXISTS (SELECT 1 FROM "public"."club_data_export" e WHERE e.club_id = "file".club_id AND e.file_id = "file".id)';
  category_report_scope constant text := 'EXISTS (SELECT 1 FROM "public"."category_report" r WHERE r.club_id = "file".club_id AND r.file_id = "file".id)';
  read_using text;
  write_using text;
BEGIN
  read_using := format('CASE WHEN player_id IS NOT NULL THEN %s WHEN kind::text IN (%L, %L) THEN %s WHEN kind::text = %L THEN %s WHEN kind::text = %L THEN %s ELSE %s END',
                       player_scope, 'data_import', 'protocol_media', staff, 'data_export', export_scope,
                       'category_report', category_report_scope, member);
  write_using := format('%s AND (%s)', writers, read_using);
  EXECUTE format('CREATE POLICY "file_app_select" ON "public"."file" FOR SELECT TO "sport_performance_app" USING (%s)', read_using);
  EXECUTE format('CREATE POLICY "file_app_insert" ON "public"."file" FOR INSERT TO "sport_performance_app" WITH CHECK (%s)', write_using);
  EXECUTE format('CREATE POLICY "file_app_update" ON "public"."file" FOR UPDATE TO "sport_performance_app" USING (%s) WITH CHECK (%s)', write_using, write_using);
END
$$;
