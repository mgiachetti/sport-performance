-- Backups and recovery (B-702, ADR 0094). The `ops` schema belongs to the owner only: no
-- connection role (API, worker, Better Auth) has USAGE on it, like `support` (ADR 0029).
--
-- - `restore_drill_marker`: a row written on the source database before and after the point
--   a drill restores to. The restored copy must hold the first and not the second: that is
--   what proves the restore landed on the point that was asked for.
-- - `restore_event`: written on a restored database, once, before it serves traffic. Its
--   latest id is the database's sync epoch (`app.sync_epoch()`), part of the fingerprint of
--   every sync cursor (ADR 0050): a cursor issued before the restore restarts with `reset`.
--
-- Both tables are append-only and keep no personal data.
CREATE SCHEMA "ops";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "ops" FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE "ops"."restore_drill_marker" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "environment" text NOT NULL,
  "label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "restore_drill_marker_environment" CHECK ("environment" ~ '^[a-z][a-z0-9-]{0,39}$'),
  CONSTRAINT "restore_drill_marker_label" CHECK ("label" IS NULL OR (btrim("label") <> '' AND char_length("label") <= 200))
);
--> statement-breakpoint
CREATE INDEX "restore_drill_marker_created_idx" ON "ops"."restore_drill_marker" ("created_at");
--> statement-breakpoint
CREATE TABLE "ops"."restore_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "environment" text NOT NULL,
  "recovery_target_at" timestamp with time zone NOT NULL,
  "reason" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "restore_event_kind" CHECK ("kind" IN ('drill', 'incident')),
  CONSTRAINT "restore_event_environment" CHECK ("environment" ~ '^[a-z][a-z0-9-]{0,39}$'),
  CONSTRAINT "restore_event_reason" CHECK (btrim("reason") <> '' AND char_length("reason") <= 500),
  CONSTRAINT "restore_event_target_before_record" CHECK ("recovery_target_at" <= "recorded_at")
);
--> statement-breakpoint
CREATE INDEX "restore_event_recorded_idx" ON "ops"."restore_event" ("recorded_at", "id");
--> statement-breakpoint
-- No policies: with RLS enabled and no grants, only the owner (who bypasses RLS) reads or
-- writes. Not FORCE: the owner's tooling (`sport-performance-db-restore`) writes here.
ALTER TABLE "ops"."restore_drill_marker" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ops"."restore_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER "restore_drill_marker_append_only" BEFORE UPDATE OR DELETE ON "ops"."restore_drill_marker"
  FOR EACH ROW EXECUTE FUNCTION "app_admin"."reject_log_change"();
--> statement-breakpoint
CREATE TRIGGER "restore_drill_marker_no_truncate" BEFORE TRUNCATE ON "ops"."restore_drill_marker"
  FOR EACH STATEMENT EXECUTE FUNCTION "app_admin"."reject_log_change"();
--> statement-breakpoint
CREATE TRIGGER "restore_event_append_only" BEFORE UPDATE OR DELETE ON "ops"."restore_event"
  FOR EACH ROW EXECUTE FUNCTION "app_admin"."reject_log_change"();
--> statement-breakpoint
CREATE TRIGGER "restore_event_no_truncate" BEFORE TRUNCATE ON "ops"."restore_event"
  FOR EACH STATEMENT EXECUTE FUNCTION "app_admin"."reject_log_change"();
--> statement-breakpoint
-- The sync epoch: the id of the latest restore recorded on this database, or '' if it was
-- never restored. The API adds it to the fingerprint of the sync cursor (ADR 0050, 0094).
CREATE FUNCTION "app"."sync_epoch"() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    (SELECT e.id::text FROM "ops"."restore_event" e ORDER BY e.recorded_at DESC, e.id DESC LIMIT 1),
    ''
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."sync_epoch"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."sync_epoch"() TO "sport_performance_app";
