CREATE TYPE "public"."pod_method_variant" AS ENUM('pod_live', 'pod_log', 'pod_ppk', 'pod_rtk', 'pod_uwb');--> statement-breakpoint
CREATE TYPE "public"."pod_raw_rejection_reason" AS ENUM('file_missing', 'invalid_container', 'manifest_mismatch', 'segment_missing', 'more_than_one_segment', 'page_range_mismatch', 'blocks_mismatch', 'pages_not_authentic', 'segment_not_closed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."pod_raw_upload_state" AS ENUM('uploading', 'pending', 'verified', 'trimmed', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'pod_raw';--> statement-breakpoint
CREATE TABLE "pod_raw_upload" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"pod_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"ingest_key" text NOT NULL,
	"chip_id" text NOT NULL,
	"pod_serial" text NOT NULL,
	"boot_counter" bigint NOT NULL,
	"segment_id" bigint NOT NULL,
	"first_page_seq" bigint NOT NULL,
	"last_page_seq" bigint NOT NULL,
	"pages_n" integer NOT NULL,
	"valid_pages_n" integer NOT NULL,
	"blocks" integer[] NOT NULL,
	"key_epochs" integer[] NOT NULL,
	"segment_closed" boolean NOT NULL,
	"declared_start_at" timestamp with time zone,
	"declared_end_at" timestamp with time zone,
	"size_bytes" bigint NOT NULL,
	"sha256_hex" text NOT NULL,
	"file_id" uuid NOT NULL,
	"state" "pod_raw_upload_state" DEFAULT 'uploading' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"pending_until" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"erase_command" text,
	"recorded_from" timestamp with time zone,
	"recorded_to" timestamp with time zone,
	"firmware_version" text,
	"gnss_firmware_version" text,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejection_reason" "pod_raw_rejection_reason",
	"rejected_at" timestamp with time zone,
	"trimmed_at" timestamp with time zone,
	"trimmed_players_n" integer,
	"trimmed_samples_n" integer,
	CONSTRAINT "pod_raw_upload_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "pod_raw_upload_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "pod_raw_upload_chip_id_format" CHECK ("pod_raw_upload"."chip_id" ~ '^[0-9a-f]{16}$'),
	CONSTRAINT "pod_raw_upload_sha256_format" CHECK ("pod_raw_upload"."sha256_hex" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pod_raw_upload_ingest_key_format" CHECK ("pod_raw_upload"."ingest_key" = "pod_raw_upload"."chip_id" || '/' || "pod_raw_upload"."boot_counter"::text || '/' || "pod_raw_upload"."segment_id"::text),
	CONSTRAINT "pod_raw_upload_manifest" CHECK ("pod_raw_upload"."boot_counter" between 0 and 4294967295 and "pod_raw_upload"."segment_id" between 0 and 4294967295
          and "pod_raw_upload"."first_page_seq" between 0 and 4294967295 and "pod_raw_upload"."last_page_seq" between "pod_raw_upload"."first_page_seq" and 4294967295
          and "pod_raw_upload"."pages_n" > 0 and "pod_raw_upload"."valid_pages_n" between 0 and "pod_raw_upload"."pages_n"
          and cardinality("pod_raw_upload"."blocks") between 1 and 65535 and cardinality("pod_raw_upload"."key_epochs") >= 1
          and "pod_raw_upload"."size_bytes" > 0 and char_length("pod_raw_upload"."pod_serial") between 1 and 64
          and ("pod_raw_upload"."declared_end_at" is null or "pod_raw_upload"."declared_start_at" is null or "pod_raw_upload"."declared_end_at" >= "pod_raw_upload"."declared_start_at")),
	CONSTRAINT "pod_raw_upload_lifecycle" CHECK (("pod_raw_upload"."state" = 'uploading') = ("pod_raw_upload"."confirmed_at" is null)
          and ("pod_raw_upload"."confirmed_at" is null) = ("pod_raw_upload"."pending_until" is null)
          and ("pod_raw_upload"."verified_at" is null) = ("pod_raw_upload"."erase_command" is null)
          and ("pod_raw_upload"."state" not in ('verified', 'trimmed') or "pod_raw_upload"."verified_at" is not null)
          and ("pod_raw_upload"."state" = 'rejected') = ("pod_raw_upload"."rejection_reason" is not null)
          and ("pod_raw_upload"."rejection_reason" is null) = ("pod_raw_upload"."rejected_at" is null)
          and ("pod_raw_upload"."state" = 'trimmed') = ("pod_raw_upload"."trimmed_at" is not null)
          and ("pod_raw_upload"."trimmed_at" is null) = ("pod_raw_upload"."trimmed_samples_n" is null)
          and ("pod_raw_upload"."trimmed_at" is null) = ("pod_raw_upload"."trimmed_players_n" is null)
          and ("pod_raw_upload"."recorded_to" is null or "pod_raw_upload"."recorded_from" is null or "pod_raw_upload"."recorded_to" >= "pod_raw_upload"."recorded_from")),
	CONSTRAINT "pod_raw_upload_erase_command_format" CHECK ("pod_raw_upload"."erase_command" is null or "pod_raw_upload"."erase_command" ~ '^([0-9a-f]{2})+$'),
	CONSTRAINT "pod_raw_upload_versions_format" CHECK (("pod_raw_upload"."firmware_version" is null or char_length("pod_raw_upload"."firmware_version") between 1 and 32)
          and ("pod_raw_upload"."gnss_firmware_version" is null or char_length("pod_raw_upload"."gnss_firmware_version") between 1 and 64))
);
--> statement-breakpoint
CREATE TABLE "pod_trace_segment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"training_session_id" uuid NOT NULL,
	"pod_id" uuid NOT NULL,
	"pod_raw_upload_id" uuid NOT NULL,
	"raw_file_id" uuid,
	"chunk_index" integer NOT NULL,
	"method_variant" "pod_method_variant" NOT NULL,
	"algorithm_version" text NOT NULL,
	"firmware_version" text,
	"gnss_firmware_version" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"samples_n" integer NOT NULL,
	"offsets_ms" integer[] NOT NULL,
	"lat_e7" integer[] NOT NULL,
	"lon_e7" integer[] NOT NULL,
	"speed_mm_s" integer[] NOT NULL,
	"h_acc_mm" integer[] NOT NULL,
	"fix_quality" smallint[] NOT NULL,
	"time_low_confidence" boolean NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pod_trace_segment_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "pod_trace_segment_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "pod_trace_segment_range" CHECK ("pod_trace_segment"."ends_at" > "pod_trace_segment"."starts_at" and "pod_trace_segment"."chunk_index" >= 0),
	CONSTRAINT "pod_trace_segment_samples" CHECK ("pod_trace_segment"."samples_n" between 1 and 3600
          and cardinality("pod_trace_segment"."offsets_ms") = "pod_trace_segment"."samples_n" and cardinality("pod_trace_segment"."lat_e7") = "pod_trace_segment"."samples_n"
          and cardinality("pod_trace_segment"."lon_e7") = "pod_trace_segment"."samples_n" and cardinality("pod_trace_segment"."speed_mm_s") = "pod_trace_segment"."samples_n"
          and cardinality("pod_trace_segment"."h_acc_mm") = "pod_trace_segment"."samples_n" and cardinality("pod_trace_segment"."fix_quality") = "pod_trace_segment"."samples_n"),
	CONSTRAINT "pod_trace_segment_versions_format" CHECK (char_length("pod_trace_segment"."algorithm_version") between 1 and 64
          and ("pod_trace_segment"."firmware_version" is null or char_length("pod_trace_segment"."firmware_version") between 1 and 32)
          and ("pod_trace_segment"."gnss_firmware_version" is null or char_length("pod_trace_segment"."gnss_firmware_version") between 1 and 64))
);
--> statement-breakpoint
ALTER TABLE "file" DROP CONSTRAINT "file_subject";--> statement-breakpoint
ALTER TABLE "pod_raw_upload" ADD CONSTRAINT "pod_raw_upload_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_raw_upload" ADD CONSTRAINT "pod_raw_upload_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_raw_upload" ADD CONSTRAINT "pod_raw_upload_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_raw_upload" ADD CONSTRAINT "pod_raw_upload_device_id_pod_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pod_device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_raw_upload" ADD CONSTRAINT "pod_raw_upload_pod_id_fkey" FOREIGN KEY ("club_id","pod_id") REFERENCES "public"."pod"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_raw_upload" ADD CONSTRAINT "pod_raw_upload_file_id_fkey" FOREIGN KEY ("club_id","file_id") REFERENCES "public"."file"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_trace_segment" ADD CONSTRAINT "pod_trace_segment_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_trace_segment" ADD CONSTRAINT "pod_trace_segment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_trace_segment" ADD CONSTRAINT "pod_trace_segment_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_trace_segment" ADD CONSTRAINT "pod_trace_segment_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_trace_segment" ADD CONSTRAINT "pod_trace_segment_training_session_id_fkey" FOREIGN KEY ("club_id","training_session_id") REFERENCES "public"."training_session"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_trace_segment" ADD CONSTRAINT "pod_trace_segment_pod_id_fkey" FOREIGN KEY ("club_id","pod_id") REFERENCES "public"."pod"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_trace_segment" ADD CONSTRAINT "pod_trace_segment_pod_raw_upload_id_fkey" FOREIGN KEY ("club_id","pod_raw_upload_id") REFERENCES "public"."pod_raw_upload"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_trace_segment" ADD CONSTRAINT "pod_trace_segment_raw_file_id_fkey" FOREIGN KEY ("club_id","raw_file_id") REFERENCES "public"."file"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pod_raw_upload_file_key" ON "pod_raw_upload" USING btree ("club_id","file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pod_raw_upload_ingest_key" ON "pod_raw_upload" USING btree ("club_id","ingest_key") WHERE "pod_raw_upload"."state" <> 'rejected';--> statement-breakpoint
CREATE INDEX "pod_raw_upload_pod_idx" ON "pod_raw_upload" USING btree ("club_id","pod_id","created_at");--> statement-breakpoint
CREATE INDEX "pod_raw_upload_device_id_idx" ON "pod_raw_upload" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "pod_raw_upload_open_idx" ON "pod_raw_upload" USING btree ("club_id","state") WHERE "pod_raw_upload"."state" in ('pending', 'verified');--> statement-breakpoint
CREATE UNIQUE INDEX "pod_trace_segment_chunk_key" ON "pod_trace_segment" USING btree ("club_id","pod_raw_upload_id","player_id","training_session_id","chunk_index");--> statement-breakpoint
CREATE INDEX "pod_trace_segment_player_idx" ON "pod_trace_segment" USING btree ("club_id","player_id","starts_at");--> statement-breakpoint
CREATE INDEX "pod_trace_segment_session_idx" ON "pod_trace_segment" USING btree ("club_id","training_session_id","player_id");--> statement-breakpoint
CREATE INDEX "pod_trace_segment_pod_id_idx" ON "pod_trace_segment" USING btree ("club_id","pod_id");--> statement-breakpoint
CREATE INDEX "pod_trace_segment_raw_file_id_idx" ON "pod_trace_segment" USING btree ("club_id","raw_file_id") WHERE "pod_trace_segment"."raw_file_id" is not null;--> statement-breakpoint
CREATE INDEX "pod_trace_segment_expires_idx" ON "pod_trace_segment" USING btree ("club_id","expires_at");--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_subject" CHECK (("file"."kind"::text in ('pod_raw') or ("file"."kind"::text in ('cmj_video', 'pdf_report')) = ("file"."player_id" is not null) or ("file"."status" = 'deleted' and "file"."player_id" is null)) and ("file"."category_id" is null or "file"."kind"::text in ('data_import', 'category_report')) and ("file"."kind"::text not in ('category_report') or "file"."category_id" is not null));--> statement-breakpoint

-- ─── Hand-written (B-916, ADR 0106, ADR 0108): ingestion of the pod's log ──────────
-- The value `pod_raw` added to `file_kind` above cannot be used as such in this transaction:
-- the policies and functions below compare the kind as text.
--
-- The guard and the functions below are SECURITY DEFINER (the guard reads the global
-- `pod_device`, the sweep lists clubs): the owner has to bypass RLS.
DO $$
BEGIN
  IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
    RAISE EXCEPTION 'Migrations must run as a superuser or a role with BYPASSRLS (connected as %)', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
--> statement-breakpoint

-- `updated_at` triggers of the new tables (see 0001).
CREATE TRIGGER "pod_raw_upload_set_updated_at" BEFORE UPDATE ON "pod_raw_upload" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "pod_trace_segment_set_updated_at" BEFORE UPDATE ON "pod_trace_segment" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- ─── RLS ─────────────────────────────────────────────────────────────────────────────
-- pod_raw_upload (pod.manage): S&C and the administration, who run the fleet and the dock.
--   They create an upload and confirm its bytes; everything else is the worker's. Never the
--   coach, the player, the guardian or the medical staff: it is the pod's, not a person's.
-- pod_trace_segment (position_trace.read, ADR 0106/0107): the player their own; the assigned
--   coach and S&C and the administration only while the player's `location` counts (granted
--   on the current text, 0053). Never the guardian, the medical staff nor support access.
--   The application writes nothing; the worker inserts and deletes (erasure, retention).
DO $$
DECLARE
  player_scope constant text := '((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.pod_raw_upload',
    "app_admin"."role_in"('{sc,admin,superadmin}'), '{sc,admin,superadmin}');
  PERFORM "app_admin"."secure_club_table"('public.pod_trace_segment',
    format('(%s AND player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[])) OR (%s AND %s AND %L = ANY (("app"."current_consent_types"(player_id))::text[]))',
           "app_admin"."role_in"('{player}'), "app_admin"."role_in"('{coach,sc,admin}'), player_scope, 'location'),
    '{}');
END
$$;
--> statement-breakpoint
-- The application only confirms an upload; the worker runs its life. Traces never change.
REVOKE UPDATE ON "public"."pod_raw_upload", "public"."pod_trace_segment" FROM "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint
GRANT UPDATE ("state", "confirmed_at", "pending_until", "updated_at", "updated_by")
  ON "public"."pod_raw_upload" TO "sport_performance_app";
--> statement-breakpoint
GRANT UPDATE ("state", "confirmed_at", "pending_until", "verified_at", "erase_command", "recorded_from",
              "recorded_to", "firmware_version", "gnss_firmware_version", "issues", "rejection_reason",
              "rejected_at", "trimmed_at", "trimmed_players_n", "trimmed_samples_n", "updated_at", "updated_by")
  ON "public"."pod_raw_upload" TO "sport_performance_worker";
--> statement-breakpoint
GRANT DELETE ON "public"."pod_trace_segment" TO "sport_performance_worker";
--> statement-breakpoint

-- A `pod_raw` file (pending or trimmed) is seen only by who runs the fleet (0038 for the rest):
-- never the coach, the player, the guardian nor the medical staff. Nobody downloads it (the API
-- has no read permission for the kind); the worker reads the object.
CREATE POLICY "file_app_pod_raw" ON "public"."file" AS RESTRICTIVE FOR ALL TO "sport_performance_app"
  USING (kind::text <> 'pod_raw' OR (SELECT "app"."current_role"()) IN ('sc', 'admin', 'superadmin'))
  WITH CHECK (kind::text <> 'pod_raw' OR (SELECT "app"."current_role"()) IN ('sc', 'admin', 'superadmin'));
--> statement-breakpoint

-- ─── The manifest is of the pod's device; the life of an upload ──────────────────────
-- After the insert or update (RLS has already checked the row). On insert (the API, as the dock's staff): the pod's device, its chip id and serial number
-- are the manifest's (the API never reads the chip id: `pod_device` is the registry's), the
-- file is a `pod_raw` of no player with the declared size, and it starts `uploading`.
-- On update: only forward (`uploading` → `pending` | `rejected`, `pending` → `verified` |
-- `rejected`, `verified` → `trimmed` | `rejected`), and the application only confirms
-- (`uploading` → `pending`). The owner (fixtures, operators) is not limited.
CREATE FUNCTION "public"."pod_raw_upload_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  privileged boolean := EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                                 WHERE r.rolname = session_user AND (r.rolsuper OR r.rolbypassrls));
  from_app boolean := NOT privileged AND pg_has_role(session_user, 'sport_performance_app', 'MEMBER');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "public"."pod" p
        JOIN "public"."pod_device" d ON d.id = p.device_id
       WHERE p.club_id = NEW.club_id AND p.id = NEW.pod_id AND p.device_id = NEW.device_id
         AND d.chip_id = NEW.chip_id AND d.serial_number = NEW.pod_serial) THEN
      RAISE EXCEPTION 'The manifest is not of the pod''s device'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_raw_upload_device', TABLE = 'pod_raw_upload';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "public"."file" f
       WHERE f.club_id = NEW.club_id AND f.id = NEW.file_id AND f.kind::text = 'pod_raw'
         AND f.player_id IS NULL AND f.size_bytes = NEW.size_bytes) THEN
      RAISE EXCEPTION 'The file of an upload is a pod_raw of no player with the declared size'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_raw_upload_file', TABLE = 'pod_raw_upload';
    END IF;
    IF NOT privileged AND NEW.state <> 'uploading' THEN
      RAISE EXCEPTION 'An upload starts uploading'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_raw_upload_transition', TABLE = 'pod_raw_upload';
    END IF;
    RETURN NULL;
  END IF;
  IF NOT privileged AND NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'uploading' AND NEW.state = 'pending')
    OR (NOT from_app AND OLD.state = 'uploading' AND NEW.state = 'rejected')
    OR (NOT from_app AND OLD.state = 'pending' AND NEW.state IN ('verified', 'rejected'))
    OR (NOT from_app AND OLD.state = 'verified' AND NEW.state IN ('trimmed', 'rejected'))) THEN
    RAISE EXCEPTION 'An upload cannot go from % to %', OLD.state, NEW.state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_raw_upload_transition', TABLE = 'pod_raw_upload';
  END IF;
  IF from_app AND NEW.state = OLD.state THEN
    RAISE EXCEPTION 'The application only confirms an upload'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_raw_upload_transition', TABLE = 'pod_raw_upload';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."pod_raw_upload_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "pod_raw_upload_guard" AFTER INSERT OR UPDATE ON "public"."pod_raw_upload"
  FOR EACH ROW EXECUTE FUNCTION "public"."pod_raw_upload_guard"();
--> statement-breakpoint

-- A confirmed upload wakes the worker up at commit (payload: the club). The sweep finds it
-- within a minute anyway: correctness depends on the table, not on the notification.
CREATE FUNCTION "public"."pod_raw_upload_notify"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_notify('sport_performance_pod_raw', NEW.club_id::text);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "pod_raw_upload_notify" AFTER UPDATE OF "state" ON "public"."pod_raw_upload"
  FOR EACH ROW WHEN (NEW.state = 'pending' AND OLD.state = 'uploading')
  EXECUTE FUNCTION "public"."pod_raw_upload_notify"();
--> statement-breakpoint

-- Clubs with ingestion work, for the worker's sweep (only ids, like app.worker_clubs()): an
-- upload to verify or to trim, one whose upload window closed, an assignment of a pod with
-- uploads waiting to be reprocessed, or traces past their retention. Worker only.
CREATE FUNCTION "app"."worker_pod_raw_clubs"() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT u.club_id FROM "public"."pod_raw_upload" u WHERE u.state IN ('pending', 'verified')
  UNION
  SELECT u.club_id FROM "public"."pod_raw_upload" u
    JOIN "public"."file" f ON f.club_id = u.club_id AND f.id = u.file_id
   WHERE u.state = 'uploading' AND f.expires_at <= now()
  UNION
  SELECT a.club_id FROM "public"."pod_assignment" a
   WHERE a.reprocess_requested_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM "public"."pod_raw_upload" u WHERE u.club_id = a.club_id AND u.pod_id = a.pod_id)
  UNION
  SELECT t.club_id FROM "public"."pod_trace_segment" t WHERE t.expires_at <= now()
  ORDER BY 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."worker_pod_raw_clubs"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."worker_pod_raw_clubs"() TO "sport_performance_worker";
