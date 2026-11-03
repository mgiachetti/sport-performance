CREATE TYPE "public"."club_data_export_status" AS ENUM('queued', 'running', 'ready', 'failed');--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'data_export';--> statement-breakpoint
CREATE TABLE "club_data_export" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" text,
	"requester_role" "membership_role" NOT NULL,
	"status" "club_data_export_status" DEFAULT 'queued' NOT NULL,
	"datasets" text[] NOT NULL,
	"from_date" date,
	"to_date" date,
	"requested_on" date NOT NULL,
	"player_ids" uuid[] NOT NULL,
	"excluded_players_n" integer DEFAULT 0 NOT NULL,
	"availability" jsonb,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"file_id" uuid,
	"row_counts" jsonb,
	"error_code" text,
	CONSTRAINT "club_data_export_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "club_data_export_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "club_data_export_requester_role" CHECK ("club_data_export"."requester_role" in ('sc', 'admin')),
	CONSTRAINT "club_data_export_datasets" CHECK (cardinality("club_data_export"."datasets") >= 1 and array_position("club_data_export"."datasets", null) is null),
	CONSTRAINT "club_data_export_range" CHECK ("club_data_export"."from_date" is null or "club_data_export"."to_date" is null or "club_data_export"."from_date" <= "club_data_export"."to_date"),
	CONSTRAINT "club_data_export_counts" CHECK ("club_data_export"."excluded_players_n" >= 0 and "club_data_export"."attempts" between 0 and 3),
	CONSTRAINT "club_data_export_lifecycle" CHECK (("club_data_export"."status" = 'queued' or "club_data_export"."started_at" is not null)
          and ("club_data_export"."status" in ('ready', 'failed')) = ("club_data_export"."completed_at" is not null)
          and ("club_data_export"."status" = 'ready') = ("club_data_export"."file_id" is not null and "club_data_export"."row_counts" is not null)
          and ("club_data_export"."status" = 'failed') = ("club_data_export"."error_code" is not null)
          and ("club_data_export"."availability" is null or "club_data_export"."status" in ('queued', 'running'))),
	CONSTRAINT "club_data_export_error_code" CHECK ("club_data_export"."error_code" is null or "club_data_export"."error_code" in ('generation_failed', 'too_large', 'storage_unavailable'))
);
--> statement-breakpoint
ALTER TABLE "club_data_export" ADD CONSTRAINT "club_data_export_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_data_export" ADD CONSTRAINT "club_data_export_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_data_export" ADD CONSTRAINT "club_data_export_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_data_export" ADD CONSTRAINT "club_data_export_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_data_export" ADD CONSTRAINT "club_data_export_file_id_fkey" FOREIGN KEY ("club_id","file_id") REFERENCES "public"."file"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "club_data_export_file_id_idx" ON "club_data_export" USING btree ("club_id","file_id") WHERE "club_data_export"."file_id" is not null;--> statement-breakpoint
CREATE INDEX "club_data_export_requested_by_idx" ON "club_data_export" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "club_data_export_created_idx" ON "club_data_export" USING btree ("club_id","created_at");--> statement-breakpoint
CREATE INDEX "club_data_export_pending_idx" ON "club_data_export" USING btree ("club_id","created_at") WHERE "club_data_export"."status" in ('queued', 'running');--> statement-breakpoint

-- ─── Hand-written (B-608, ADR 0072) ──────────────────────────────────────────────────
CREATE TRIGGER "club_data_export_set_updated_at" BEFORE UPDATE ON "club_data_export" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- RLS (ADR 0026, permission matrix `club_data_export`): whoever asked reads their own
-- exports (S&C), the administration every export of the club. Never the superadmin:
-- support does not take a club's data out. The API only inserts (below); the worker,
-- through `secure_club_table`, is the only one that changes the status.
DO $$
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.club_data_export',
    '(SELECT "app"."current_role"()) = ''admin'' OR (requested_by = (SELECT "app"."current_user_id"()) AND (SELECT "app"."current_role"()) = ''sc'')',
    '{}');
END
$$;
--> statement-breakpoint
-- Asking: S&C or the administration, as themselves with their role, a new request
-- (queued, nothing generated yet). The players it covers are fixed by the API with the
-- permission matrix; this is the backstop for who asks and in which state.
CREATE POLICY "club_data_export_app_insert" ON "public"."club_data_export" FOR INSERT TO "sport_performance_app" WITH CHECK (
  (SELECT "app"."current_role"()) IN ('sc', 'admin')
  AND requester_role::text = (SELECT "app"."current_role"())
  AND requested_by = (SELECT "app"."current_user_id"())
  AND status = 'queued' AND attempts = 0 AND started_at IS NULL AND completed_at IS NULL
  AND file_id IS NULL AND row_counts IS NULL AND error_code IS NULL);
--> statement-breakpoint
GRANT INSERT ON "public"."club_data_export" TO "sport_performance_app";
--> statement-breakpoint

-- A new request wakes the worker up at commit (payload: the club). The sweep of the worker
-- finds it within a minute anyway: correctness depends on the table, not on the notification.
CREATE FUNCTION "public"."club_data_export_notify"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_notify('sport_performance_data_export', NEW.club_id::text);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."club_data_export_notify"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "club_data_export_notify" AFTER INSERT ON "public"."club_data_export"
  FOR EACH ROW EXECUTE FUNCTION "public"."club_data_export_notify"();
--> statement-breakpoint

-- Clubs with an export for the worker to take: queued, or running for longer than
-- CLUB_DATA_EXPORT_STALE_RUNNING_MINUTES (30) of the domain (a worker that died). Only ids,
-- like app.worker_clubs(). Worker only.
CREATE FUNCTION "app"."worker_data_export_clubs"() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT DISTINCT e.club_id FROM "public"."club_data_export" e
   WHERE e.status = 'queued'
      OR (e.status = 'running' AND e.started_at < now() - interval '30 minutes')
   ORDER BY e.club_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."worker_data_export_clubs"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."worker_data_export_clubs"() TO "sport_performance_worker";
--> statement-breakpoint

-- Erasing a player (app.erase_player, ADR 0051) also reaches the exports: a ready ZIP that
-- includes them is deleted (unavailable at once; written by the server, so no upload URL
-- can land a late PUT and the retention job may purge it right away), and they leave the
-- scope and the availability of every export. A ZIP being generated with them is discarded
-- by the worker when it sees they left the scope. `player_ids` has no foreign key (it is a
-- set): this trigger is its `ON DELETE`.
--
-- Order matters under READ COMMITTED. The exports are updated (and locked) first: if the
-- worker's final transaction is marking one of them ready at that moment, this statement
-- waits for it and, re-checking the row, returns the `file_id` it committed. The files are
-- deleted by a second statement, with a new snapshot that sees that file ready. The other
-- way round, a ZIP committed between the two would stay ready with the erased player.
CREATE FUNCTION "public"."club_data_export_forget_player"() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  file_ids uuid[];
BEGIN
  WITH forgotten AS (
    UPDATE "public"."club_data_export" e
       SET player_ids = array_remove(e.player_ids, OLD.id),
           availability = CASE WHEN e.availability IS NULL THEN NULL ELSE e.availability - OLD.id::text END
     WHERE e.club_id = OLD.club_id AND OLD.id = ANY (e.player_ids)
    RETURNING e.file_id
  )
  SELECT array_agg(file_id) FILTER (WHERE file_id IS NOT NULL) INTO file_ids FROM forgotten;
  IF file_ids IS NOT NULL THEN
    UPDATE "public"."file" f
       SET status = 'deleted', deleted_at = now(), expires_at = now()
     WHERE f.club_id = OLD.club_id AND f.id = ANY (file_ids) AND f.status <> 'deleted';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."club_data_export_forget_player"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "player_club_data_export_forget" BEFORE DELETE ON "public"."player"
  FOR EACH ROW EXECUTE FUNCTION "public"."club_data_export_forget_player"();
--> statement-breakpoint

-- Who reads a file (0020, 0035), now with the exports: a `data_export` ZIP is read by whoever
-- reads its export (the requester, the administration), so the file follows the RLS of
-- `club_data_export`. Compared as text: a value added to an enum cannot be used as such in
-- the transaction that adds it.
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
  read_using text;
  write_using text;
BEGIN
  read_using := format('CASE WHEN player_id IS NOT NULL THEN %s WHEN kind::text IN (%L, %L) THEN %s WHEN kind::text = %L THEN %s ELSE %s END',
                       player_scope, 'data_import', 'protocol_media', staff, 'data_export', export_scope, member);
  write_using := format('%s AND (%s)', writers, read_using);
  EXECUTE format('CREATE POLICY "file_app_select" ON "public"."file" FOR SELECT TO "sport_performance_app" USING (%s)', read_using);
  EXECUTE format('CREATE POLICY "file_app_insert" ON "public"."file" FOR INSERT TO "sport_performance_app" WITH CHECK (%s)', write_using);
  EXECUTE format('CREATE POLICY "file_app_update" ON "public"."file" FOR UPDATE TO "sport_performance_app" USING (%s) WITH CHECK (%s)', write_using, write_using);
END
$$;
