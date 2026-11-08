CREATE TYPE "public"."pod_loan_status" AS ENUM('pending', 'active', 'declined', 'cancelled', 'returned');--> statement-breakpoint
CREATE TYPE "public"."pod_provisioning_state" AS ENUM('unprovisioned', 'provisioned', 'decommissioned');--> statement-breakpoint
CREATE TYPE "public"."pod_status" AS ENUM('active', 'lent', 'lost', 'stolen', 'retired');--> statement-breakpoint
ALTER TYPE "public"."change_tracked_table" ADD VALUE 'pod';--> statement-breakpoint
ALTER TYPE "public"."change_tracked_table" ADD VALUE 'pod_loan';--> statement-breakpoint
ALTER TYPE "public"."change_tracked_table" ADD VALUE 'pod_assignment';--> statement-breakpoint
ALTER TYPE "public"."sync_collection" ADD VALUE 'pod_assignment';--> statement-breakpoint
ALTER TYPE "public"."sync_operation" ADD VALUE 'pod_assignment.create';--> statement-breakpoint
ALTER TYPE "public"."sync_operation" ADD VALUE 'pod_assignment.end';--> statement-breakpoint
CREATE TABLE "pod" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"short_id" integer NOT NULL,
	"number" smallint NOT NULL,
	"label" text,
	"status" "pod_status" DEFAULT 'active' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key_epoch" integer DEFAULT 0 NOT NULL,
	"keys_revoked_at" timestamp with time zone,
	"borrowed_from_club_id" uuid,
	"loan_id" uuid,
	"firmware_version" text,
	"gnss_firmware_version" text,
	"last_seen_at" timestamp with time zone,
	"battery_cycles" integer,
	"battery_capacity_pct" real,
	"nand_bad_blocks" integer,
	"health_reported_at" timestamp with time zone,
	CONSTRAINT "pod_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "pod_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "pod_short_id_range" CHECK ("pod"."short_id" between 1 and 65534),
	CONSTRAINT "pod_number_range" CHECK ("pod"."number" between 1 and 999),
	CONSTRAINT "pod_label_format" CHECK ("pod"."label" is null or ("pod"."label" = btrim("pod"."label") and char_length("pod"."label") between 1 and 60)),
	CONSTRAINT "pod_key_epoch" CHECK ("pod"."key_epoch" >= 0),
	CONSTRAINT "pod_loan_pair" CHECK (("pod"."borrowed_from_club_id" is null) = ("pod"."loan_id" is null) and "pod"."borrowed_from_club_id" is distinct from "pod"."club_id"),
	CONSTRAINT "pod_health_values" CHECK (("pod"."battery_cycles" is null or "pod"."battery_cycles" >= 0)
          and ("pod"."battery_capacity_pct" is null or "pod"."battery_capacity_pct" between 0 and 100)
          and ("pod"."nand_bad_blocks" is null or "pod"."nand_bad_blocks" >= 0)),
	CONSTRAINT "pod_versions_format" CHECK (("pod"."firmware_version" is null or char_length("pod"."firmware_version") between 1 and 32)
          and ("pod"."gnss_firmware_version" is null or char_length("pod"."gnss_firmware_version") between 1 and 32))
);
--> statement-breakpoint
CREATE TABLE "pod_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"pod_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"training_session_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"note" text,
	"reprocess_requested_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "pod_assignment_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "pod_assignment_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "pod_assignment_range" CHECK ("pod_assignment"."ends_at" is null or "pod_assignment"."ends_at" > "pod_assignment"."starts_at"),
	CONSTRAINT "pod_assignment_note_format" CHECK ("pod_assignment"."note" is null or ("pod_assignment"."note" = btrim("pod_assignment"."note") and char_length("pod_assignment"."note") between 1 and 200))
);
--> statement-breakpoint
CREATE TABLE "pod_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial_number" text NOT NULL,
	"chip_id" text NOT NULL,
	"hardware_revision" text NOT NULL,
	"provisioning_state" "pod_provisioning_state" DEFAULT 'unprovisioned' NOT NULL,
	"owner_club_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	CONSTRAINT "pod_device_serial_number_key" UNIQUE("serial_number"),
	CONSTRAINT "pod_device_chip_id_key" UNIQUE("chip_id"),
	CONSTRAINT "pod_device_client_uuid_key" UNIQUE("client_uuid"),
	CONSTRAINT "pod_device_serial_format" CHECK ("pod_device"."serial_number" ~ '^[A-Z0-9][A-Z0-9-]{2,30}[A-Z0-9]$'),
	CONSTRAINT "pod_device_chip_id_format" CHECK ("pod_device"."chip_id" ~ '^[0-9a-f]{16}$'),
	CONSTRAINT "pod_device_hardware_revision_format" CHECK ("pod_device"."hardware_revision" ~ '^[a-z0-9][a-z0-9._-]{0,15}$')
);
--> statement-breakpoint
CREATE TABLE "pod_loan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"pod_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"status" "pod_loan_status" DEFAULT 'pending' NOT NULL,
	"borrower_club_slug" text NOT NULL,
	"borrower_club_id" uuid,
	"borrower_pod_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"planned_ends_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	CONSTRAINT "pod_loan_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "pod_loan_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "pod_loan_other_club" CHECK ("pod_loan"."borrower_club_id" is null or "pod_loan"."borrower_club_id" <> "pod_loan"."club_id"),
	CONSTRAINT "pod_loan_slug_format" CHECK ("pod_loan"."borrower_club_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("pod_loan"."borrower_club_slug") <= 63),
	CONSTRAINT "pod_loan_lifecycle" CHECK (("pod_loan"."status" in ('pending', 'active')) = ("pod_loan"."ended_at" is null)
          and ("pod_loan"."status" in ('active', 'returned')) = ("pod_loan"."accepted_at" is not null)
          and ("pod_loan"."accepted_at" is null or ("pod_loan"."borrower_club_id" is not null and "pod_loan"."borrower_pod_id" is not null))),
	CONSTRAINT "pod_loan_range" CHECK (("pod_loan"."planned_ends_at" is null or "pod_loan"."planned_ends_at" > "pod_loan"."requested_at")
          and ("pod_loan"."accepted_at" is null or "pod_loan"."accepted_at" >= "pod_loan"."requested_at")
          and ("pod_loan"."ended_at" is null or "pod_loan"."ended_at" >= "pod_loan"."requested_at"))
);
--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "pods_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pod" ADD CONSTRAINT "pod_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod" ADD CONSTRAINT "pod_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod" ADD CONSTRAINT "pod_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod" ADD CONSTRAINT "pod_device_id_pod_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pod_device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod" ADD CONSTRAINT "pod_borrowed_from_club_id_club_id_fk" FOREIGN KEY ("borrowed_from_club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_assignment" ADD CONSTRAINT "pod_assignment_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_assignment" ADD CONSTRAINT "pod_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_assignment" ADD CONSTRAINT "pod_assignment_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_assignment" ADD CONSTRAINT "pod_assignment_pod_id_fkey" FOREIGN KEY ("club_id","pod_id") REFERENCES "public"."pod"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_assignment" ADD CONSTRAINT "pod_assignment_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_assignment" ADD CONSTRAINT "pod_assignment_training_session_id_fkey" FOREIGN KEY ("club_id","training_session_id") REFERENCES "public"."training_session"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_device" ADD CONSTRAINT "pod_device_owner_club_id_club_id_fk" FOREIGN KEY ("owner_club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_device" ADD CONSTRAINT "pod_device_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_device" ADD CONSTRAINT "pod_device_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_loan" ADD CONSTRAINT "pod_loan_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_loan" ADD CONSTRAINT "pod_loan_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_loan" ADD CONSTRAINT "pod_loan_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_loan" ADD CONSTRAINT "pod_loan_device_id_pod_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pod_device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_loan" ADD CONSTRAINT "pod_loan_borrower_club_id_club_id_fk" FOREIGN KEY ("borrower_club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_loan" ADD CONSTRAINT "pod_loan_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_loan" ADD CONSTRAINT "pod_loan_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_loan" ADD CONSTRAINT "pod_loan_pod_id_fkey" FOREIGN KEY ("club_id","pod_id") REFERENCES "public"."pod"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pod_device_id_idx" ON "pod" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "pod_borrowed_from_club_id_idx" ON "pod" USING btree ("borrowed_from_club_id") WHERE "pod"."borrowed_from_club_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pod_device_live_key" ON "pod" USING btree ("club_id","device_id") WHERE "pod"."status" <> 'retired';--> statement-breakpoint
CREATE UNIQUE INDEX "pod_short_id_live_key" ON "pod" USING btree ("club_id","short_id") WHERE "pod"."status" <> 'retired';--> statement-breakpoint
CREATE UNIQUE INDEX "pod_number_live_key" ON "pod" USING btree ("club_id","number") WHERE "pod"."status" <> 'retired';--> statement-breakpoint
CREATE INDEX "pod_assignment_pod_idx" ON "pod_assignment" USING btree ("club_id","pod_id","starts_at");--> statement-breakpoint
CREATE INDEX "pod_assignment_player_idx" ON "pod_assignment" USING btree ("club_id","player_id","starts_at");--> statement-breakpoint
CREATE INDEX "pod_assignment_training_session_id_idx" ON "pod_assignment" USING btree ("club_id","training_session_id") WHERE "pod_assignment"."training_session_id" is not null;--> statement-breakpoint
CREATE INDEX "pod_assignment_reprocess_idx" ON "pod_assignment" USING btree ("club_id","reprocess_requested_at") WHERE "pod_assignment"."reprocess_requested_at" is not null;--> statement-breakpoint
CREATE INDEX "pod_device_owner_club_id_idx" ON "pod_device" USING btree ("owner_club_id") WHERE "pod_device"."owner_club_id" is not null;--> statement-breakpoint
CREATE INDEX "pod_loan_pod_idx" ON "pod_loan" USING btree ("club_id","pod_id","requested_at");--> statement-breakpoint
CREATE INDEX "pod_loan_device_id_idx" ON "pod_loan" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "pod_loan_borrower_club_id_idx" ON "pod_loan" USING btree ("borrower_club_id") WHERE "pod_loan"."borrower_club_id" is not null;--> statement-breakpoint
CREATE INDEX "pod_loan_accepted_by_idx" ON "pod_loan" USING btree ("accepted_by") WHERE "pod_loan"."accepted_by" is not null;--> statement-breakpoint
CREATE INDEX "pod_loan_ended_by_idx" ON "pod_loan" USING btree ("ended_by") WHERE "pod_loan"."ended_by" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pod_loan_open_key" ON "pod_loan" USING btree ("club_id","pod_id") WHERE "pod_loan"."status" in ('pending', 'active');--> statement-breakpoint

-- ─── Hand-written (B-912, ADR 0106): the pod fleet and its assignment ─────────────────
-- The enum values added above (`change_tracked_table`, `sync_collection`, `sync_operation`)
-- and `location` of `consent_type` (0053, same transaction on a new database) cannot be used
-- in this transaction: the policies and functions below compare them as text.
--
-- The trigger and the functions below are SECURITY DEFINER and write tables with forced
-- RLS (a loan writes two clubs): the owner has to bypass it.
DO $$
BEGIN
  IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
    RAISE EXCEPTION 'Migrations must run as a superuser or a role with BYPASSRLS (connected as %)', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
--> statement-breakpoint

-- Never two live assignments at once for the same pod nor for the same player: half-open
-- ranges `[starts_at, ends_at)`, open-ended while `ends_at` is NULL. Voided ones are out.
-- btree_gist (0013) compares the uuids with `=` next to the range's `&&`.
ALTER TABLE "pod_assignment" ADD CONSTRAINT "pod_assignment_pod_no_overlap" EXCLUDE USING gist (
  "club_id" WITH =, "pod_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&
) WHERE ("archived_at" IS NULL);
--> statement-breakpoint
ALTER TABLE "pod_assignment" ADD CONSTRAINT "pod_assignment_player_no_overlap" EXCLUDE USING gist (
  "club_id" WITH =, "player_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&
) WHERE ("archived_at" IS NULL);
--> statement-breakpoint

-- `updated_at` triggers of the new tables (see 0001).
CREATE TRIGGER "pod_device_set_updated_at" BEFORE UPDATE ON "pod_device" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "pod_set_updated_at" BEFORE UPDATE ON "pod" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "pod_loan_set_updated_at" BEFORE UPDATE ON "pod_loan" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "pod_assignment_set_updated_at" BEFORE UPDATE ON "pod_assignment" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- ─── Categories with pods ────────────────────────────────────────────────────────────
-- M19 by default (DEFAULT_POD_AGE_BAND_CODES of the domain; the bootstrap seeds new clubs
-- the same way). The first team joins with its age band (B-920). The administration
-- turns it on or off per category, like the rest of the category.
UPDATE "public"."category" SET "pods_enabled" = true WHERE "age_band_code" = 'm19';
--> statement-breakpoint
GRANT UPDATE ("pods_enabled") ON "public"."category" TO "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint

-- ─── pod_device: global, the superadmin's registry ───────────────────────────────────
-- No club_id (ADR 0106): read and written only by a superadmin on the registry (no club in
-- the context), like the registry of clubs. A club reads its own devices only through
-- app.club_pod_devices(). The serial number and the chip id never change. The worker never
-- reads it.
ALTER TABLE "public"."pod_device" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."pod_device" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "pod_device_app_select" ON "public"."pod_device" FOR SELECT TO "sport_performance_app"
  USING ((SELECT "app"."current_club_id"()) IS NULL AND (SELECT "app"."is_superadmin"()));
--> statement-breakpoint
CREATE POLICY "pod_device_app_insert" ON "public"."pod_device" FOR INSERT TO "sport_performance_app"
  WITH CHECK ((SELECT "app"."current_club_id"()) IS NULL AND (SELECT "app"."is_superadmin"()));
--> statement-breakpoint
CREATE POLICY "pod_device_app_update" ON "public"."pod_device" FOR UPDATE TO "sport_performance_app"
  USING ((SELECT "app"."current_club_id"()) IS NULL AND (SELECT "app"."is_superadmin"()))
  WITH CHECK ((SELECT "app"."current_club_id"()) IS NULL AND (SELECT "app"."is_superadmin"()));
--> statement-breakpoint
GRANT SELECT, INSERT ON "public"."pod_device" TO "sport_performance_app";
--> statement-breakpoint
GRANT UPDATE ("hardware_revision", "provisioning_state", "owner_club_id", "updated_at", "updated_by")
  ON "public"."pod_device" TO "sport_performance_app";
--> statement-breakpoint

-- The devices of the context's club, for the staff that reads the fleet (pod.read: coach,
-- sc, admin, support): those it owns (in stock or in the fleet) and those it has a pod of
-- that is not retired (a loan it received, while it lasts). Never another club's stock, and
-- never the chip id (the keys are derived from it).
CREATE FUNCTION "app"."club_pod_devices"()
RETURNS TABLE (id uuid, serial_number text, hardware_revision text,
               provisioning_state "public"."pod_provisioning_state", owned boolean)
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT d.id, d.serial_number, d.hardware_revision, d.provisioning_state,
         d.owner_club_id IS NOT DISTINCT FROM "app"."current_club_id"()
    FROM "public"."pod_device" d
   WHERE "app"."current_club_id"() IS NOT NULL
     AND "app"."current_role"() IN ('coach', 'sc', 'admin', 'superadmin')
     AND (d.owner_club_id = "app"."current_club_id"()
          OR EXISTS (SELECT 1 FROM "public"."pod" p
                      WHERE p.club_id = "app"."current_club_id"() AND p.device_id = d.id
                        AND p.status <> 'retired'))
   ORDER BY d.serial_number
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."club_pod_devices"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."club_pod_devices"() TO "sport_performance_app";
--> statement-breakpoint

-- ─── RLS of the club tables ──────────────────────────────────────────────────────────
-- pod (pod.read / pod.manage): the staff that assigns pods reads the fleet (coach, sc,
--   admin); S&C and the administration run it. Never the player, the guardian or the
--   medical staff.
-- pod_loan: S&C and the administration of the lending club read them; the application
--   writes nothing: app.lend_pod and app.end_pod_loan write both clubs.
-- pod_assignment (pod_assignment.read / assign): the player their own, the staff of their
--   assigned players, the administration the whole club; never the guardian nor the
--   medical staff. coach, sc and the administration write; a new one needs the player's
--   `data` and `location` consents (below).
DO $$
DECLARE
  player_scope constant text := '((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.pod',
    "app_admin"."role_in"('{coach,sc,admin,superadmin}'), '{sc,admin,superadmin}');
  PERFORM "app_admin"."secure_club_table"('public.pod_loan',
    "app_admin"."role_in"('{sc,admin,superadmin}'), '{}');
  PERFORM "app_admin"."secure_club_table"('public.pod_assignment',
    format('%s AND %s', "app_admin"."role_in"('{player,coach,sc,admin,superadmin}'), player_scope),
    '{coach,sc,admin,superadmin}');
END
$$;
--> statement-breakpoint
-- The device and the loan of a pod never change; nor the pod or the player of an assignment
-- (a wrong one is voided and made again).
REVOKE UPDATE ON "public"."pod", "public"."pod_assignment" FROM "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint
GRANT UPDATE ("short_id", "number", "label", "status", "status_changed_at", "key_epoch", "keys_revoked_at",
              "firmware_version", "gnss_firmware_version", "last_seen_at", "battery_cycles",
              "battery_capacity_pct", "nand_bad_blocks", "health_reported_at", "updated_at", "updated_by")
  ON "public"."pod" TO "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint
GRANT UPDATE ("training_session_id", "starts_at", "ends_at", "note", "reprocess_requested_at", "archived_at",
              "updated_at", "updated_by")
  ON "public"."pod_assignment" TO "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint
-- A new assignment needs the player's `data` and `location` consents that count (location only
-- granted on the current text, 0053): the matrix asks the same, this is the last barrier. Ending,
-- correcting or voiding one does not: a revoked consent must never keep a pod assigned.
CREATE POLICY "pod_assignment_app_insert_consents" ON "public"."pod_assignment" AS RESTRICTIVE
  FOR INSERT TO "sport_performance_app"
  WITH CHECK (ARRAY['data', 'location'] <@ ("app"."current_consent_types"(player_id))::text[]);
--> statement-breakpoint

-- ─── A pod is of a device the club owns, or has on loan ──────────────────────────────
-- After the insert (RLS has already checked the row): the device is the club's (and not
-- decommissioned), or the club is receiving it on an open loan.
CREATE FUNCTION "public"."pod_device_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "public"."pod_device" d
     WHERE d.id = NEW.device_id AND d.provisioning_state <> 'decommissioned'
       AND ((NEW.borrowed_from_club_id IS NULL AND d.owner_club_id = NEW.club_id)
            OR (NEW.borrowed_from_club_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM "public"."pod_loan" l
                   WHERE l.id = NEW.loan_id AND l.club_id = NEW.borrowed_from_club_id
                     AND l.device_id = NEW.device_id AND l.borrower_club_id = NEW.club_id
                     AND l.status = 'active')))) THEN
    RAISE EXCEPTION 'The device of a pod must be owned by the club or lent to it'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_device_owner', TABLE = 'pod';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."pod_device_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "pod_device_guard" AFTER INSERT ON "public"."pod"
  FOR EACH ROW EXECUTE FUNCTION "public"."pod_device_guard"();
--> statement-breakpoint

-- ─── Change history (ADR 0030) ───────────────────────────────────────────────────────
-- A pod: the status, the keys and the health are its life, written freely; renumbering it
-- (the number on the vest, the short id in the network) says why. A loan: its status is its
-- life, the rest fills empty columns. An assignment: ending it fills `ends_at`; correcting its range says why
-- (the API requires a reason); voiding and the reprocessing flag are its lifecycle.
CREATE TRIGGER "pod_change_history" AFTER UPDATE OR DELETE ON "pod" FOR EACH ROW EXECUTE FUNCTION "public"."change_history_record"('', '{label,status,status_changed_at,key_epoch,keys_revoked_at,firmware_version,gnss_firmware_version,last_seen_at,battery_cycles,battery_capacity_pct,nand_bad_blocks,health_reported_at}');--> statement-breakpoint
CREATE TRIGGER "pod_loan_change_history" AFTER UPDATE OR DELETE ON "pod_loan" FOR EACH ROW EXECUTE FUNCTION "public"."change_history_record"('', '{status}');--> statement-breakpoint
CREATE TRIGGER "pod_assignment_change_history" AFTER UPDATE OR DELETE ON "pod_assignment" FOR EACH ROW EXECUTE FUNCTION "public"."change_history_record"('player_id', '{reprocess_requested_at,archived_at}');--> statement-breakpoint

-- The history of an assignment is read like the assignment: never by the medical staff
-- (who read the history of their assigned players, 0008).
CREATE POLICY "change_history_app_pod_assignment" ON "public"."change_history" AS RESTRICTIVE
  FOR SELECT TO "sport_performance_app"
  USING (table_name::text <> 'pod_assignment'
         OR (SELECT "app"."current_role"()) IN ('coach', 'sc', 'admin', 'superadmin'));
--> statement-breakpoint

-- ─── Offline sync (ADR 0050, ADR 0106) ───────────────────────────────────────────────
-- Logged under its player; no field clocks: an offline create that overlaps is rejected
-- (409), never resolved by "last writer wins".
CREATE TRIGGER "pod_assignment_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "public"."pod_assignment"
  FOR EACH ROW EXECUTE FUNCTION "public"."sync_change_record"('pod_assignment', 'id', 'player_id', '');--> statement-breakpoint

-- ─── Loans (ADR 0106): asked by the lender, accepted by the receiving club ───────────
-- Every function below writes rows of both clubs and checks who is asking. Errors:
-- P0002 (not found), insufficient_privilege, check_violation with a constraint
-- `pod_loan_*`, unique_violation on pod_number_live_key (accepting with a number the
-- receiving club already uses).

-- Asks to lend the context club's pod (S&C or the administration; the matrix's pod.manage,
-- asked by the API first). The receiving club is named by its slug and never looked up for
-- the caller: an unknown slug gives a loan that stays pending, like a known one, so the
-- answer never tells whether a club exists. The pod has to be the club's own, active and not
-- worn now or later. Idempotent by the loan's client uuid.
CREATE FUNCTION "app"."lend_pod"(target_pod uuid, borrower_slug text, planned_end timestamptz,
                                 loan_client_uuid uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  lender constant uuid := "app"."current_club_id"();
  me constant text := (SELECT u.id FROM "public"."user" u WHERE u.id = "app"."current_user_id"());
  source "public"."pod"%ROWTYPE;
  borrower uuid;
  existing uuid;
  new_loan uuid := gen_random_uuid();
BEGIN
  IF lender IS NULL OR coalesce("app"."current_role"() IN ('sc', 'admin', 'superadmin'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'lend_pod needs S&C or the administration of the club' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT l.id INTO existing FROM "public"."pod_loan" l
   WHERE l.club_id = lender AND l.client_uuid = loan_client_uuid;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;
  SELECT * INTO source FROM "public"."pod" p WHERE p.club_id = lender AND p.id = target_pod FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pod not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF source.status <> 'active' OR source.borrowed_from_club_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM "public"."pod_loan" l
                 WHERE l.club_id = lender AND l.pod_id = target_pod AND l.status IN ('pending', 'active')) THEN
    RAISE EXCEPTION 'Only an active pod of the club itself, without another loan, is lent'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_loan_pod_unavailable', TABLE = 'pod_loan';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."pod_assignment" a
              WHERE a.club_id = lender AND a.pod_id = target_pod AND a.archived_at IS NULL
                AND (a.ends_at IS NULL OR a.ends_at > pg_catalog.now())) THEN
    RAISE EXCEPTION 'The pod is assigned now or later: end its assignments first'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_loan_pod_in_use', TABLE = 'pod_loan';
  END IF;
  IF borrower_slug = (SELECT c.slug FROM "public"."club" c WHERE c.id = lender) THEN
    RAISE EXCEPTION 'A club does not lend to itself'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_loan_other_club', TABLE = 'pod_loan';
  END IF;
  SELECT c.id INTO borrower FROM "public"."club" c WHERE c.slug = borrower_slug;
  INSERT INTO "public"."pod_loan"
    (id, club_id, client_uuid, pod_id, device_id, status, borrower_club_slug, borrower_club_id,
     planned_ends_at, created_by, updated_by)
  VALUES
    (new_loan, lender, coalesce(loan_client_uuid, gen_random_uuid()), target_pod, source.device_id,
     'pending', borrower_slug, borrower, planned_end, me, me);
  RETURN new_loan;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."lend_pod"(uuid, text, timestamptz, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."lend_pod"(uuid, text, timestamptz, uuid) TO "sport_performance_app";
--> statement-breakpoint

-- The loans other clubs asked to make to the context's club, for its administration (who
-- accepts or declines them): the lender's name, the pod's number and serial, never more.
CREATE FUNCTION "app"."incoming_pod_loans"()
RETURNS TABLE (id uuid, lender_club_id uuid, lender_club_name text, pod_number smallint,
               serial_number text, hardware_revision text, status "public"."pod_loan_status",
               requested_at timestamptz, planned_ends_at timestamptz, accepted_at timestamptz,
               ended_at timestamptz, borrower_pod_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT l.id, l.club_id, c.name, p.number, d.serial_number, d.hardware_revision, l.status,
         l.requested_at, l.planned_ends_at, l.accepted_at, l.ended_at, l.borrower_pod_id
    FROM "public"."pod_loan" l
    JOIN "public"."club" c ON c.id = l.club_id
    JOIN "public"."pod" p ON p.club_id = l.club_id AND p.id = l.pod_id
    JOIN "public"."pod_device" d ON d.id = l.device_id
   WHERE "app"."current_club_id"() IS NOT NULL
     AND l.borrower_club_id = "app"."current_club_id"()
     AND "app"."current_role"() IN ('admin', 'superadmin')
   ORDER BY l.requested_at DESC, l.id DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."incoming_pod_loans"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."incoming_pod_loans"() TO "sport_performance_app";
--> statement-breakpoint

-- The administration of the receiving club accepts a pending loan: its pod for the loan
-- (`pod_number`, or the lender's number; the lowest free short id of its network) and the
-- lender's pod `lent`. The lender's pod has to be still active and free.
CREATE FUNCTION "app"."accept_pod_loan"(target_loan uuid, pod_number integer) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  borrower constant uuid := "app"."current_club_id"();
  me constant text := (SELECT u.id FROM "public"."user" u WHERE u.id = "app"."current_user_id"());
  loan "public"."pod_loan"%ROWTYPE;
  source "public"."pod"%ROWTYPE;
  free_short_id integer;
  new_pod uuid := gen_random_uuid();
BEGIN
  IF borrower IS NULL OR coalesce("app"."current_role"() IN ('admin', 'superadmin'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'accept_pod_loan needs the administration of the club' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO loan FROM "public"."pod_loan" l
   WHERE l.id = target_loan AND l.borrower_club_id = borrower FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF loan.status = 'active' THEN
    RETURN loan.borrower_pod_id;
  END IF;
  IF loan.status <> 'pending' THEN
    RAISE EXCEPTION 'The loan is no longer pending'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_loan_not_pending', TABLE = 'pod_loan';
  END IF;
  SELECT * INTO source FROM "public"."pod" p WHERE p.club_id = loan.club_id AND p.id = loan.pod_id FOR UPDATE;
  IF source.status <> 'active' THEN
    RAISE EXCEPTION 'The pod is not available anymore'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_loan_pod_unavailable', TABLE = 'pod_loan';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."pod_assignment" a
              WHERE a.club_id = loan.club_id AND a.pod_id = loan.pod_id AND a.archived_at IS NULL
                AND (a.ends_at IS NULL OR a.ends_at > pg_catalog.now())) THEN
    RAISE EXCEPTION 'The pod is assigned in the lending club'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_loan_pod_in_use', TABLE = 'pod_loan';
  END IF;
  -- One write at a time into the receiving club's network: its short ids are taken in order
  -- (the API takes the same lock to register a pod).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pod_short_id:' || borrower::text, 0));
  SELECT min(s) INTO free_short_id FROM pg_catalog.generate_series(1, 65534) s
   WHERE NOT EXISTS (SELECT 1 FROM "public"."pod" p
                      WHERE p.club_id = borrower AND p.short_id = s AND p.status <> 'retired');
  IF free_short_id IS NULL THEN
    RAISE EXCEPTION 'The network of the club is full'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_short_id_range', TABLE = 'pod';
  END IF;
  UPDATE "public"."pod_loan"
     SET status = 'active', accepted_at = pg_catalog.now(), accepted_by = me, borrower_pod_id = new_pod,
         updated_by = me
   WHERE id = loan.id;
  INSERT INTO "public"."pod"
    (id, club_id, device_id, short_id, number, label, borrowed_from_club_id, loan_id,
     firmware_version, gnss_firmware_version, created_by, updated_by)
  VALUES
    (new_pod, borrower, loan.device_id, free_short_id, coalesce(pod_number, source.number), source.label,
     loan.club_id, loan.id, source.firmware_version, source.gnss_firmware_version, me, me);
  UPDATE "public"."pod" SET status = 'lent', status_changed_at = pg_catalog.now(), updated_by = me
   WHERE club_id = loan.club_id AND id = loan.pod_id;
  RETURN new_pod;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."accept_pod_loan"(uuid, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."accept_pod_loan"(uuid, integer) TO "sport_performance_app";
--> statement-breakpoint

-- Ends a loan of the context's club, as either side (idempotent once ended):
--   * the lender (S&C or the administration): cancels a pending one, or ends an active one;
--   * the receiving club (the administration): declines a pending one, or returns an
--     active one.
-- Ending an active one retires the receiving club's pod (its assignment in course ends now;
-- those that had not started are voided) and makes the lender's active again with the next
-- key epoch (provisioned again with the lender's keys, ADR 0106).
CREATE FUNCTION "app"."end_pod_loan"(target_loan uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  here constant uuid := "app"."current_club_id"();
  caller_role constant text := "app"."current_role"();
  me constant text := (SELECT u.id FROM "public"."user" u WHERE u.id = "app"."current_user_id"());
  loan "public"."pod_loan"%ROWTYPE;
  previous_reason constant text := pg_catalog.current_setting('app.change_reason', true);
  as_lender boolean;
BEGIN
  IF here IS NULL OR caller_role IS NULL THEN
    RAISE EXCEPTION 'end_pod_loan needs a club' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO loan FROM "public"."pod_loan" l
   WHERE l.id = target_loan AND (l.club_id = here OR l.borrower_club_id = here) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan not found' USING ERRCODE = 'no_data_found';
  END IF;
  as_lender := loan.club_id = here;
  IF (as_lender AND caller_role NOT IN ('sc', 'admin', 'superadmin'))
     OR (NOT as_lender AND caller_role NOT IN ('admin', 'superadmin')) THEN
    RAISE EXCEPTION 'end_pod_loan needs S&C or the administration of the club' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF loan.status NOT IN ('pending', 'active') THEN
    RETURN;
  END IF;
  IF loan.status = 'pending' THEN
    UPDATE "public"."pod_loan"
       SET status = CASE WHEN as_lender THEN 'cancelled' ELSE 'declined' END::"public"."pod_loan_status",
           ended_at = pg_catalog.now(), ended_by = me, updated_by = me
     WHERE id = loan.id;
    RETURN;
  END IF;
  -- The end of the loan is the reason of the assignments it ends early (ADR 0030).
  PERFORM pg_catalog.set_config('app.change_reason', 'pod loan ended', true);
  UPDATE "public"."pod_assignment" a
     SET archived_at = pg_catalog.now(), reprocess_requested_at = pg_catalog.now(), updated_by = me
   WHERE a.club_id = loan.borrower_club_id AND a.pod_id = loan.borrower_pod_id
     AND a.archived_at IS NULL AND a.starts_at >= pg_catalog.now();
  UPDATE "public"."pod_assignment" a
     SET ends_at = pg_catalog.now(), updated_by = me
   WHERE a.club_id = loan.borrower_club_id AND a.pod_id = loan.borrower_pod_id
     AND a.archived_at IS NULL AND (a.ends_at IS NULL OR a.ends_at > pg_catalog.now());
  PERFORM pg_catalog.set_config('app.change_reason', coalesce(previous_reason, ''), true);
  UPDATE "public"."pod" SET status = 'retired', status_changed_at = pg_catalog.now(), updated_by = me
   WHERE club_id = loan.borrower_club_id AND id = loan.borrower_pod_id AND status <> 'retired';
  UPDATE "public"."pod"
     SET status = 'active', status_changed_at = pg_catalog.now(), key_epoch = key_epoch + 1, updated_by = me
   WHERE club_id = loan.club_id AND id = loan.pod_id AND status = 'lent';
  UPDATE "public"."pod_loan" SET status = 'returned', ended_at = pg_catalog.now(), ended_by = me, updated_by = me
   WHERE id = loan.id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."end_pod_loan"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."end_pod_loan"(uuid) TO "sport_performance_app";
--> statement-breakpoint

-- ─── A pod out of the fleet releases its assignments ─────────────────────────────────
-- A pod that left the fleet (lost, stolen, retired): its live assignments, whoever wears
-- it. S&C and the administration run the fleet for the whole club (pod.manage) but see only
-- the players of their assignments (RLS), so this reaches the rest. With `dry_run`, only
-- counts them, for any status (retiring refuses a pod in use). Otherwise only for a pod that
-- already left the fleet: ends the one being worn now and voids those that had not started
-- (flagged for reprocessing), with `reason` in the change history. Returns how many. P0002
-- when the pod is not of the club.
CREATE FUNCTION "app"."release_pod_assignments"(target_pod uuid, reason text, dry_run boolean)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  club constant uuid := "app"."current_club_id"();
  me constant text := (SELECT u.id FROM "public"."user" u WHERE u.id = "app"."current_user_id"());
  previous_reason constant text := pg_catalog.current_setting('app.change_reason', true);
  pod_status "public"."pod_status";
  live integer;
  voided integer;
  ended integer;
BEGIN
  IF club IS NULL OR coalesce("app"."current_role"() IN ('sc', 'admin', 'superadmin'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'release_pod_assignments needs S&C or the administration of the club' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.status INTO pod_status FROM "public"."pod" p WHERE p.club_id = club AND p.id = target_pod;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pod not found' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT count(*) INTO live FROM "public"."pod_assignment" a
   WHERE a.club_id = club AND a.pod_id = target_pod AND a.archived_at IS NULL
     AND (a.ends_at IS NULL OR a.ends_at > pg_catalog.now());
  IF dry_run OR live = 0 THEN
    RETURN live;
  END IF;
  IF pod_status NOT IN ('lost', 'stolen', 'retired') THEN
    RAISE EXCEPTION 'Only a pod out of the fleet releases its assignments'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_release_in_fleet', TABLE = 'pod';
  END IF;
  PERFORM pg_catalog.set_config('app.change_reason', reason, true);
  UPDATE "public"."pod_assignment" a
     SET archived_at = pg_catalog.now(), reprocess_requested_at = pg_catalog.now(), updated_by = me
   WHERE a.club_id = club AND a.pod_id = target_pod AND a.archived_at IS NULL
     AND a.starts_at >= pg_catalog.now();
  GET DIAGNOSTICS voided = ROW_COUNT;
  UPDATE "public"."pod_assignment" a
     SET ends_at = pg_catalog.now(), updated_by = me
   WHERE a.club_id = club AND a.pod_id = target_pod AND a.archived_at IS NULL
     AND (a.ends_at IS NULL OR a.ends_at > pg_catalog.now());
  GET DIAGNOSTICS ended = ROW_COUNT;
  PERFORM pg_catalog.set_config('app.change_reason', coalesce(previous_reason, ''), true);
  RETURN voided + ended;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."release_pod_assignments"(uuid, text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."release_pod_assignments"(uuid, text, boolean) TO "sport_performance_app";
--> statement-breakpoint

-- ─── An assignment never grows without its checks ────────────────────────────────────
-- Ending, shrinking and voiding an assignment are free (a revoked consent must never keep a
-- pod assigned). Growing it (an earlier start, a later or open end) is a new collection of
-- the player's position: it needs, like a new one, the `data` and `location` consents that
-- count and the pod active. A voided assignment never comes back. Before the update, under
-- the caller's own RLS (it reads the pod and the consents as the caller sees them; the
-- worker and the owner, without a role, cannot grow one either).
CREATE FUNCTION "public"."pod_assignment_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'A voided pod assignment never comes back'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_assignment_voided', TABLE = 'pod_assignment';
  END IF;
  IF NEW.archived_at IS NULL
     AND (NEW.starts_at < OLD.starts_at
          OR (OLD.ends_at IS NOT NULL AND (NEW.ends_at IS NULL OR NEW.ends_at > OLD.ends_at))) THEN
    IF NOT (ARRAY['data', 'location'] <@ ("app"."current_consent_types"(NEW.player_id))::text[])
       OR NOT EXISTS (SELECT 1 FROM "public"."pod" p
                       WHERE p.club_id = NEW.club_id AND p.id = NEW.pod_id AND p.status = 'active') THEN
      RAISE EXCEPTION 'Growing a pod assignment needs the data and location consents and the pod active'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_assignment_extension', TABLE = 'pod_assignment';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."pod_assignment_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "pod_assignment_guard" BEFORE UPDATE ON "public"."pod_assignment"
  FOR EACH ROW EXECUTE FUNCTION "public"."pod_assignment_guard"();
--> statement-breakpoint

-- ─── A device in use keeps its owner ─────────────────────────────────────────────────
-- The registry never moves a device to another club, nor decommissions it, while a club has
-- a pod of it that is not retired or a loan of it is open: the same device would be
-- attributed in two clubs. Reads every club, so SECURITY DEFINER.
CREATE FUNCTION "public"."pod_device_owner_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.owner_club_id IS DISTINCT FROM OLD.owner_club_id
      OR (NEW.provisioning_state = 'decommissioned' AND OLD.provisioning_state <> 'decommissioned'))
     AND (EXISTS (SELECT 1 FROM "public"."pod" p WHERE p.device_id = NEW.id AND p.status <> 'retired')
          OR EXISTS (SELECT 1 FROM "public"."pod_loan" l
                      WHERE l.device_id = NEW.id AND l.status IN ('pending', 'active'))) THEN
    RAISE EXCEPTION 'The device is in a fleet: retire its pod first'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pod_device_in_use', TABLE = 'pod_device';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."pod_device_owner_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "pod_device_owner_guard" BEFORE UPDATE OF "owner_club_id", "provisioning_state" ON "public"."pod_device"
  FOR EACH ROW EXECUTE FUNCTION "public"."pod_device_owner_guard"();
--> statement-breakpoint

-- ─── Revoking a consent releases the player's pod ────────────────────────────────────
-- In the transaction of the revocation of `location` or `data` (whoever revokes it): the
-- assignment the player wears ends now and those that had not started are voided (flagged
-- for reprocessing). The revocation is the reason in the change history.
CREATE FUNCTION "public"."consent_pod_assignments_release"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  previous_reason constant text := pg_catalog.current_setting('app.change_reason', true);
BEGIN
  -- Another signature of the same type that still counts (the adult's and the guardian's)
  -- keeps it.
  IF NEW.type::text = ANY (("app"."current_consent_types"(NEW.player_id))::text[]) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "public"."pod_assignment" a
                  WHERE a.club_id = NEW.club_id AND a.player_id = NEW.player_id AND a.archived_at IS NULL
                    AND (a.ends_at IS NULL OR a.ends_at > pg_catalog.now())) THEN
    RETURN NULL;
  END IF;
  PERFORM pg_catalog.set_config('app.change_reason', NEW.type::text || ' consent revoked', true);
  UPDATE "public"."pod_assignment" a
     SET archived_at = pg_catalog.now(), reprocess_requested_at = pg_catalog.now(), updated_by = NEW.revoked_by
   WHERE a.club_id = NEW.club_id AND a.player_id = NEW.player_id AND a.archived_at IS NULL
     AND a.starts_at >= pg_catalog.now();
  UPDATE "public"."pod_assignment" a
     SET ends_at = pg_catalog.now(), updated_by = NEW.revoked_by
   WHERE a.club_id = NEW.club_id AND a.player_id = NEW.player_id AND a.archived_at IS NULL
     AND (a.ends_at IS NULL OR a.ends_at > pg_catalog.now());
  PERFORM pg_catalog.set_config('app.change_reason', coalesce(previous_reason, ''), true);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."consent_pod_assignments_release"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "consent_pod_assignments_release" AFTER UPDATE OF revoked_at ON "public"."consent"
  FOR EACH ROW
  WHEN (NEW.type::text IN ('location', 'data') AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION "public"."consent_pod_assignments_release"();
