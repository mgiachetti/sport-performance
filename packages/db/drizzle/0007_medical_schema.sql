-- Generated part (drizzle-kit, from src/schema/medical.ts): schema, enums, tables,
-- constraints and indexes. The hand-written part below (access, audit, triggers) is
-- in the same migration so the whole medical schema lands as one migration (index 0007).
CREATE SCHEMA "medical";
--> statement-breakpoint
CREATE TYPE "medical"."access_action" AS ENUM('read', 'insert', 'update');--> statement-breakpoint
CREATE TYPE "medical"."availability_status" AS ENUM('available', 'limited', 'unavailable');--> statement-breakpoint
CREATE TYPE "medical"."concussion_stage_outcome" AS ENUM('in_progress', 'passed', 'symptomatic');--> statement-breakpoint
CREATE TYPE "medical"."injury_body_region" AS ENUM('head_face', 'neck', 'shoulder', 'upper_arm', 'elbow', 'forearm', 'wrist_hand', 'chest', 'thoracic_spine', 'lumbar_spine', 'abdomen', 'pelvis_hip_groin', 'thigh_anterior', 'thigh_posterior', 'knee', 'lower_leg', 'ankle', 'foot', 'other');--> statement-breakpoint
CREATE TYPE "medical"."injury_context" AS ENUM('training', 'match', 'other');--> statement-breakpoint
CREATE TYPE "medical"."injury_mechanism" AS ENUM('contact', 'non_contact', 'unknown');--> statement-breakpoint
CREATE TYPE "medical"."injury_onset" AS ENUM('acute', 'gradual');--> statement-breakpoint
CREATE TYPE "medical"."injury_side" AS ENUM('left', 'right', 'bilateral', 'central', 'not_applicable');--> statement-breakpoint
CREATE TYPE "medical"."note_visibility" AS ENUM('medical', 'shared');--> statement-breakpoint
CREATE TABLE "medical"."access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"actor_user_id" text,
	"actor_role" text,
	"db_role" text NOT NULL,
	"action" "medical"."access_action" NOT NULL,
	"resource" text NOT NULL,
	"player_id" uuid,
	"record_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"changed_columns" text[],
	"request_id" text,
	"transaction_id" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medical"."concussion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"injury_id" uuid,
	"occurred_on" date NOT NULL,
	"context" "medical"."injury_context" NOT NULL,
	"training_session_id" uuid,
	"removed_from_play" boolean DEFAULT true NOT NULL,
	"protocol" text DEFAULT 'world_rugby_grtp' NOT NULL,
	"protocol_version" text NOT NULL,
	"cleared_on" date,
	"cleared_by" text,
	CONSTRAINT "concussion_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "concussion_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "concussion_club_id_id_player_id_key" UNIQUE("club_id","id","player_id"),
	CONSTRAINT "concussion_clearance" CHECK (("medical"."concussion"."cleared_on" is null) = ("medical"."concussion"."cleared_by" is null)),
	CONSTRAINT "concussion_cleared_after" CHECK ("medical"."concussion"."cleared_on" is null or "medical"."concussion"."cleared_on" >= "medical"."concussion"."occurred_on"),
	CONSTRAINT "concussion_session_is_club_activity" CHECK ("medical"."concussion"."training_session_id" is null or "medical"."concussion"."context" <> 'other')
);
--> statement-breakpoint
CREATE TABLE "medical"."concussion_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"concussion_id" uuid NOT NULL,
	"stage" smallint NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"outcome" "medical"."concussion_stage_outcome" DEFAULT 'in_progress' NOT NULL,
	CONSTRAINT "concussion_stage_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "concussion_stage_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "concussion_stage_range" CHECK ("medical"."concussion_stage"."stage" between 1 and 5),
	CONSTRAINT "concussion_stage_end" CHECK (("medical"."concussion_stage"."outcome" = 'in_progress') = ("medical"."concussion_stage"."ended_on" is null) and ("medical"."concussion_stage"."ended_on" is null or "medical"."concussion_stage"."ended_on" >= "medical"."concussion_stage"."started_on"))
);
--> statement-breakpoint
CREATE TABLE "medical"."hold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"training" "medical"."availability_status" NOT NULL,
	"match" "medical"."availability_status" NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"staff_note" text,
	"injury_id" uuid,
	"concussion_id" uuid,
	"lifted_at" timestamp with time zone,
	"lifted_by" text,
	CONSTRAINT "hold_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "hold_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "hold_validity" CHECK ("medical"."hold"."valid_to" is null or "medical"."hold"."valid_to" > "medical"."hold"."valid_from"),
	CONSTRAINT "hold_restricts" CHECK ("medical"."hold"."training" <> 'available' or "medical"."hold"."match" <> 'available'),
	CONSTRAINT "hold_lift" CHECK (("medical"."hold"."lifted_at" is null) = ("medical"."hold"."lifted_by" is null) and ("medical"."hold"."lifted_at" is null or "medical"."hold"."valid_to" is not null))
);
--> statement-breakpoint
CREATE TABLE "medical"."injury" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"onset_on" date NOT NULL,
	"context" "medical"."injury_context" NOT NULL,
	"training_session_id" uuid,
	"body_region" "medical"."injury_body_region" NOT NULL,
	"side" "medical"."injury_side" NOT NULL,
	"onset" "medical"."injury_onset" NOT NULL,
	"mechanism" "medical"."injury_mechanism" NOT NULL,
	"diagnosis" text,
	"osiics_code" text,
	"is_recurrence" boolean DEFAULT false NOT NULL,
	"expected_return_on" date,
	"returned_on" date,
	CONSTRAINT "injury_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "injury_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "injury_club_id_id_player_id_key" UNIQUE("club_id","id","player_id"),
	CONSTRAINT "injury_returned_after_onset" CHECK ("medical"."injury"."returned_on" is null or "medical"."injury"."returned_on" >= "medical"."injury"."onset_on"),
	CONSTRAINT "injury_expected_after_onset" CHECK ("medical"."injury"."expected_return_on" is null or "medical"."injury"."expected_return_on" >= "medical"."injury"."onset_on"),
	CONSTRAINT "injury_session_is_club_activity" CHECK ("medical"."injury"."training_session_id" is null or "medical"."injury"."context" <> 'other'),
	CONSTRAINT "injury_osiics_code_format" CHECK ("medical"."injury"."osiics_code" is null or "medical"."injury"."osiics_code" ~ '^[A-Z0-9.]{1,16}$')
);
--> statement-breakpoint
CREATE TABLE "medical"."note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"body" text NOT NULL,
	"visibility" "medical"."note_visibility" DEFAULT 'medical' NOT NULL,
	"injury_id" uuid,
	"concussion_id" uuid,
	"amends_note_id" uuid,
	CONSTRAINT "note_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "note_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "note_club_id_id_player_id_key" UNIQUE("club_id","id","player_id"),
	CONSTRAINT "note_body_not_blank" CHECK (btrim("medical"."note"."body") <> '')
);
--> statement-breakpoint
ALTER TABLE "medical"."access_log" ADD CONSTRAINT "access_log_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."concussion" ADD CONSTRAINT "concussion_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."concussion" ADD CONSTRAINT "concussion_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."concussion" ADD CONSTRAINT "concussion_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."concussion" ADD CONSTRAINT "concussion_cleared_by_user_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."concussion" ADD CONSTRAINT "concussion_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."concussion" ADD CONSTRAINT "concussion_training_session_id_fkey" FOREIGN KEY ("club_id","training_session_id") REFERENCES "public"."training_session"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."concussion" ADD CONSTRAINT "concussion_injury_id_fkey" FOREIGN KEY ("club_id","injury_id","player_id") REFERENCES "medical"."injury"("club_id","id","player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."concussion_stage" ADD CONSTRAINT "concussion_stage_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."concussion_stage" ADD CONSTRAINT "concussion_stage_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."concussion_stage" ADD CONSTRAINT "concussion_stage_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."concussion_stage" ADD CONSTRAINT "concussion_stage_concussion_id_fkey" FOREIGN KEY ("club_id","concussion_id","player_id") REFERENCES "medical"."concussion"("club_id","id","player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."hold" ADD CONSTRAINT "hold_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."hold" ADD CONSTRAINT "hold_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."hold" ADD CONSTRAINT "hold_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."hold" ADD CONSTRAINT "hold_lifted_by_user_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."hold" ADD CONSTRAINT "hold_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."hold" ADD CONSTRAINT "hold_injury_id_fkey" FOREIGN KEY ("club_id","injury_id","player_id") REFERENCES "medical"."injury"("club_id","id","player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."hold" ADD CONSTRAINT "hold_concussion_id_fkey" FOREIGN KEY ("club_id","concussion_id","player_id") REFERENCES "medical"."concussion"("club_id","id","player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."injury" ADD CONSTRAINT "injury_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."injury" ADD CONSTRAINT "injury_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."injury" ADD CONSTRAINT "injury_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."injury" ADD CONSTRAINT "injury_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."injury" ADD CONSTRAINT "injury_training_session_id_fkey" FOREIGN KEY ("club_id","training_session_id") REFERENCES "public"."training_session"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."note" ADD CONSTRAINT "note_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."note" ADD CONSTRAINT "note_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."note" ADD CONSTRAINT "note_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."note" ADD CONSTRAINT "note_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."note" ADD CONSTRAINT "note_injury_id_fkey" FOREIGN KEY ("club_id","injury_id","player_id") REFERENCES "medical"."injury"("club_id","id","player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."note" ADD CONSTRAINT "note_concussion_id_fkey" FOREIGN KEY ("club_id","concussion_id","player_id") REFERENCES "medical"."concussion"("club_id","id","player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."note" ADD CONSTRAINT "note_amends_note_id_fkey" FOREIGN KEY ("club_id","amends_note_id","player_id") REFERENCES "medical"."note"("club_id","id","player_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_player_idx" ON "medical"."access_log" USING btree ("club_id","player_id","occurred_at");--> statement-breakpoint
CREATE INDEX "access_log_occurred_idx" ON "medical"."access_log" USING btree ("club_id","occurred_at");--> statement-breakpoint
CREATE INDEX "access_log_request_idx" ON "medical"."access_log" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "concussion_training_session_id_idx" ON "medical"."concussion" USING btree ("club_id","training_session_id") WHERE "medical"."concussion"."training_session_id" is not null;--> statement-breakpoint
CREATE INDEX "concussion_injury_id_idx" ON "medical"."concussion" USING btree ("club_id","injury_id","player_id") WHERE "medical"."concussion"."injury_id" is not null;--> statement-breakpoint
CREATE INDEX "concussion_player_idx" ON "medical"."concussion" USING btree ("club_id","player_id","occurred_on");--> statement-breakpoint
CREATE INDEX "concussion_stage_concussion_idx" ON "medical"."concussion_stage" USING btree ("club_id","concussion_id","player_id","started_on");--> statement-breakpoint
CREATE UNIQUE INDEX "concussion_stage_one_in_progress_key" ON "medical"."concussion_stage" USING btree ("club_id","concussion_id") WHERE "medical"."concussion_stage"."outcome" = 'in_progress';--> statement-breakpoint
CREATE INDEX "hold_injury_id_idx" ON "medical"."hold" USING btree ("club_id","injury_id","player_id") WHERE "medical"."hold"."injury_id" is not null;--> statement-breakpoint
CREATE INDEX "hold_concussion_id_idx" ON "medical"."hold" USING btree ("club_id","concussion_id","player_id") WHERE "medical"."hold"."concussion_id" is not null;--> statement-breakpoint
CREATE INDEX "hold_player_idx" ON "medical"."hold" USING btree ("club_id","player_id","valid_from");--> statement-breakpoint
CREATE INDEX "injury_training_session_id_idx" ON "medical"."injury" USING btree ("club_id","training_session_id") WHERE "medical"."injury"."training_session_id" is not null;--> statement-breakpoint
CREATE INDEX "injury_player_idx" ON "medical"."injury" USING btree ("club_id","player_id","onset_on");--> statement-breakpoint
CREATE INDEX "note_injury_id_idx" ON "medical"."note" USING btree ("club_id","injury_id","player_id") WHERE "medical"."note"."injury_id" is not null;--> statement-breakpoint
CREATE INDEX "note_concussion_id_idx" ON "medical"."note" USING btree ("club_id","concussion_id","player_id") WHERE "medical"."note"."concussion_id" is not null;--> statement-breakpoint
CREATE INDEX "note_amends_note_id_idx" ON "medical"."note" USING btree ("club_id","amends_note_id","player_id") WHERE "medical"."note"."amends_note_id" is not null;--> statement-breakpoint
CREATE INDEX "note_player_idx" ON "medical"."note" USING btree ("club_id","player_id","created_at");
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════
-- Hand-written part (ADR 0008, ADR 0026, ADR 0029): access to the `medical` schema
-- created above, its append-only access log, and the support audit of
-- the superadmin that #33 left to B-304.
--
--   * The connection roles cannot read clinical columns. Reads go through SECURITY DEFINER
--     functions (`medical.read_*`, `medical.availability`) that filter by club and scope
--     and write `medical.access_log` in the same transaction: no read without its row.
--   * Writes are INSERT/UPDATE under forced RLS (role `medical`, assigned players, current
--     health consent where the matrix asks for it) and an AFTER trigger logs every row,
--     the owner's maintenance writes included. Nothing is deleted.
--   * Every access needs `app.request_id`; the log keeps actor, validated role, login,
--     club, player, action, resource, rows, changed column names (never values),
--     request, transaction and time. Nobody can change or delete it, not even the owner.
--   * A superadmin acts only after `app.begin_support_access(reason)` recorded the access
--     in `support.access_log` within the same transaction.
--
-- Like 0004 it must run as a superuser or a role with BYPASSRLS: the SECURITY DEFINER
-- functions below read tables with FORCE ROW LEVEL SECURITY.
DO $$
BEGIN
  IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
    RAISE EXCEPTION 'Migrations must run as a superuser or a role with BYPASSRLS (connected as %)', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
--> statement-breakpoint

-- ─── Request id ──────────────────────────────────────────────────────────────────────
-- The API sets `app.request_id` with set_config(..., true) next to the tenant context (the
-- id of its logs, ADR 0016). Audited operations refuse to run without it.
CREATE FUNCTION "app"."current_request_id"() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(pg_catalog.current_setting('app.request_id', true), '')
$$;
--> statement-breakpoint

-- Raised by every append-only log: not even the owner rewrites history.
CREATE FUNCTION "app_admin"."reject_log_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege', TABLE = TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app_admin"."reject_log_change"() FROM PUBLIC;
--> statement-breakpoint

-- ─── Support access of the superadmin (ADR 0026: audited, ADR 0029) ─────────────────
CREATE SCHEMA "support";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "support" FROM PUBLIC;
--> statement-breakpoint
-- One row per transaction (request) in which a superadmin acts, with the club it acts in
-- (NULL: the registry of clubs) and why. `started_at` is the transaction's start time
-- (now()): app.current_role() matches the row of the current transaction by it.
CREATE TABLE "support"."access_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "club_id" uuid REFERENCES "public"."club" ("id") ON DELETE RESTRICT,
  "reason" text NOT NULL,
  "request_id" text NOT NULL,
  "db_role" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "logged_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "transaction_id" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
  CONSTRAINT "access_log_reason" CHECK (btrim("reason") <> '' AND char_length("reason") <= 500)
);
--> statement-breakpoint
CREATE INDEX "access_log_session_idx" ON "support"."access_log" ("user_id", "started_at", "club_id");
--> statement-breakpoint
CREATE INDEX "access_log_club_idx" ON "support"."access_log" ("club_id", "started_at");
--> statement-breakpoint
ALTER TABLE "support"."access_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "support"."access_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER "access_log_append_only" BEFORE UPDATE OR DELETE ON "support"."access_log"
  FOR EACH ROW EXECUTE FUNCTION "app_admin"."reject_log_change"();
--> statement-breakpoint
CREATE TRIGGER "access_log_no_truncate" BEFORE TRUNCATE ON "support"."access_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "app_admin"."reject_log_change"();
--> statement-breakpoint

-- Records that the superadmin of the context acts now, in the context's club (or without a
-- club), for `reason`. Returns the id of the row.
CREATE FUNCTION "app"."begin_support_access"(reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := "app"."current_user_id"();
  request text := "app"."current_request_id"();
  entry uuid;
BEGIN
  IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM "public"."user" u WHERE u.id = actor AND u.is_superadmin) THEN
    RAISE EXCEPTION 'Support access is only for a superadmin user in the context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF request IS NULL THEN
    RAISE EXCEPTION 'Support access needs app.request_id'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO "support"."access_log" ("user_id", "club_id", "reason", "request_id", "db_role")
  VALUES (actor, "app"."current_club_id"(), reason, request, session_user)
  RETURNING "id" INTO entry;
  RETURN entry;
END;
$$;
--> statement-breakpoint

-- As in 0004, plus: `superadmin` holds only in a transaction that recorded its support
-- access to this club.
CREATE OR REPLACE FUNCTION "app"."current_role"() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT ctx.claimed
    FROM (SELECT "app"."current_club_id"() AS club_id,
                 "app"."current_user_id"() AS user_id,
                 nullif(current_setting('app.role', true), '') AS claimed) ctx
   WHERE ctx.club_id IS NOT NULL
     AND ctx.user_id IS NOT NULL
     AND CASE
           WHEN ctx.claimed = 'superadmin' THEN
             EXISTS (SELECT 1 FROM "public"."user" u WHERE u.id = ctx.user_id AND u.is_superadmin)
             AND EXISTS (SELECT 1 FROM "public"."club" c WHERE c.id = ctx.club_id)
             AND EXISTS (SELECT 1 FROM "support"."access_log" s
                          WHERE s.user_id = ctx.user_id AND s.started_at = now() AND s.club_id = ctx.club_id)
           ELSE
             EXISTS (SELECT 1 FROM "public"."membership" m
                      WHERE m.club_id = ctx.club_id
                        AND m.user_id = ctx.user_id
                        AND m.role::text = ctx.claimed
                        AND m.started_at <= now()
                        AND (m.ended_at IS NULL OR m.ended_at > now()))
         END
$$;
--> statement-breakpoint

-- Without a club (registry of clubs): the flag, and a support access without club recorded
-- in this transaction.
CREATE OR REPLACE FUNCTION "app"."is_superadmin"() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "public"."user" u
                  WHERE u.id = "app"."current_user_id"() AND u.is_superadmin)
     AND EXISTS (SELECT 1 FROM "support"."access_log" s
                  WHERE s.user_id = "app"."current_user_id"() AND s.started_at = now() AND s.club_id IS NULL)
$$;
--> statement-breakpoint

-- `test_result.not_done_reason` as the viewer sees it (ADR 0026, ADR 0029): `injured`
-- reveals health, so everyone but the medical staff reads `unavailable`. Same rule as
-- `notDoneReasonForViewer` of the domain.
CREATE FUNCTION "app"."not_done_reason_for_viewer"(reason "public"."test_not_done_reason") RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
           WHEN reason = 'injured' AND "app"."current_role"() IS DISTINCT FROM 'medical' THEN 'unavailable'
           ELSE reason::text
         END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."current_request_id"(), "app"."begin_support_access"(text),
  "app"."not_done_reason_for_viewer"("public"."test_not_done_reason") FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."current_request_id"(),
  "app"."not_done_reason_for_viewer"("public"."test_not_done_reason")
  TO "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint
-- The worker never acts as a superadmin.
GRANT EXECUTE ON FUNCTION "app"."begin_support_access"(text) TO "sport_performance_app";
--> statement-breakpoint

-- ─── medical: schema privileges ──────────────────────────────────────────────────────
-- The API may call the medical functions and write rows; the worker and Better Auth do
-- not reach the schema at all.
REVOKE ALL ON SCHEMA "medical" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "medical" TO "sport_performance_app";
--> statement-breakpoint

-- ─── medical: scope helpers ──────────────────────────────────────────────────────────
-- A current health consent of the player (B-312). Owner only: called from the functions
-- and policies below, which only answer for the medical role or the holder.
CREATE FUNCTION "medical"."has_health_consent"(player uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "public"."consent" c
                  WHERE c.club_id = "app"."current_club_id"() AND c.player_id = player
                    AND c.type = 'health' AND c.revoked_at IS NULL AND c.signed_at <= now())
$$;
--> statement-breakpoint

-- The player is under 18 on the club's day (AGE_OF_MAJORITY_YEARS of the domain).
CREATE FUNCTION "medical"."is_minor"(player uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT (p.birth_date + interval '18 years')::date > "app"."club_today"()
                     FROM "public"."player" p
                    WHERE p.club_id = "app"."current_club_id"() AND p.id = player), false)
$$;
--> statement-breakpoint

-- Write scope (policies): the validated role is `medical`, the player is in its current
-- assignments and, when `needs_consent`, has a current health consent (matrix:
-- medical_record.record / update need `health`; a block does not, it protects the player).
CREATE FUNCTION "medical"."may_write"(player uuid, needs_consent boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce("app"."current_role"() = 'medical', false)
     AND player = ANY ("app"."visible_player_ids"())
     AND (NOT needs_consent OR "medical"."has_health_consent"(player))
$$;
--> statement-breakpoint

-- Players whose `resource` the context may read, among `requested` (NULL: all it may).
-- Raises for a role that may not read the resource at all (the API's matrix denies first;
-- reaching this is a bug) and without tenant context or request id.
--   availability                  every validated role: admin/superadmin the club, the rest
--                                 their visible players (assignments, own, guardian);
--   injury, concussion(_stage), note  `medical` (assigned) and the holder: the player, and
--                                 the guardian of a minor, both with a health consent;
--   hold                          `medical` only.
CREATE FUNCTION "medical"."readable_players"(resource text, requested uuid[]) RETURNS uuid[]
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
  ELSIF ctx_role = 'medical' AND resource IN ('injury', 'concussion', 'concussion_stage', 'hold', 'note') THEN
    SELECT array_agg(v) INTO scope FROM unnest("app"."visible_player_ids"()) v
     WHERE requested IS NULL OR v = ANY (requested);
  ELSIF ctx_role IN ('player', 'parent') AND resource IN ('injury', 'concussion', 'concussion_stage', 'note') THEN
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

-- One `read` row per player read (with the ids of the rows returned) and per player asked
-- for (even if nothing came back), or one row without player when the read found nothing.
CREATE FUNCTION "medical"."log_read"(resource text, requested uuid[], players uuid[], records uuid[]) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  WITH pairs AS (
    SELECT r.player_id, r.record_id FROM unnest(players, records) AS r(player_id, record_id)
    UNION ALL
    SELECT q, NULL::uuid FROM unnest(coalesce(requested, '{}'::uuid[])) AS q
  ), grouped AS (
    SELECT player_id,
           coalesce(array_agg(record_id ORDER BY record_id) FILTER (WHERE record_id IS NOT NULL), '{}') AS ids
      FROM pairs GROUP BY player_id
  ), entries AS (
    SELECT player_id, ids FROM grouped
    UNION ALL
    SELECT NULL::uuid, '{}'::uuid[] WHERE NOT EXISTS (SELECT 1 FROM grouped)
  )
  INSERT INTO "medical"."access_log"
    ("club_id", "actor_user_id", "actor_role", "db_role", "action", "resource", "player_id", "record_ids", "request_id")
  SELECT "app"."current_club_id"(), "app"."current_user_id"(), "app"."current_role"(), session_user,
         'read', resource, e.player_id, e.ids, "app"."current_request_id"()
    FROM entries e
$$;
--> statement-breakpoint

-- ─── medical: write log, guards and policies ─────────────────────────────────────────
-- AFTER INSERT/UPDATE of every medical row: one log row with the names of the columns an
-- update changed. A login that is not the owner must be inside a request.
CREATE FUNCTION "medical"."log_write"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  request text := "app"."current_request_id"();
  changed text[];
BEGIN
  IF request IS NULL AND NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) THEN
    RAISE EXCEPTION 'Medical data is written only within a request (app.request_id is not set)'
      USING ERRCODE = 'insufficient_privilege', TABLE = TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}') INTO changed
      FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
     WHERE n.value IS DISTINCT FROM o.value AND n.key NOT IN ('updated_at');
  END IF;
  INSERT INTO "medical"."access_log"
    ("club_id", "actor_user_id", "actor_role", "db_role", "action", "resource", "player_id",
     "record_ids", "changed_columns", "request_id")
  VALUES (NEW.club_id, "app"."current_user_id"(), "app"."current_role"(), session_user,
          lower(TG_OP)::"medical"."access_action", TG_TABLE_NAME, NEW.player_id,
          ARRAY[NEW.id], changed, request);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Who signs a clearance or lifts a block is the user acting, never someone else (the
-- owner's maintenance writes excepted).
CREATE FUNCTION "medical"."acting_user_is"(signer text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT signer IS NOT DISTINCT FROM "app"."current_user_id"()
      OR (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = session_user)
$$;
--> statement-breakpoint

-- GRTP stages (World Rugby): only added, in order. The next stage is at most one above the
-- current level (the last closed stage if passed, one below it if symptoms came back) and
-- starts after it ended; a closed stage never changes; nothing is added after clearance.
CREATE FUNCTION "medical"."concussion_stage_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  parent "medical"."concussion";
  last_closed "medical"."concussion_stage";
  current_level integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.outcome <> 'in_progress' THEN
      RAISE EXCEPTION 'A closed GRTP stage cannot change: record a new stage'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'concussion_stage_closed', TABLE = 'concussion_stage';
    END IF;
    IF (NEW.player_id, NEW.concussion_id, NEW.stage, NEW.started_on)
       IS DISTINCT FROM (OLD.player_id, OLD.concussion_id, OLD.stage, OLD.started_on) THEN
      RAISE EXCEPTION 'Only the end and the outcome of a GRTP stage can be recorded'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'concussion_stage_append_only', TABLE = 'concussion_stage';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO parent FROM "medical"."concussion" c WHERE c.club_id = NEW.club_id AND c.id = NEW.concussion_id;
  IF parent.cleared_on IS NOT NULL THEN
    RAISE EXCEPTION 'The concussion is cleared: no more GRTP stages'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'concussion_stage_after_clearance', TABLE = 'concussion_stage';
  END IF;
  IF NEW.started_on < parent.occurred_on THEN
    RAISE EXCEPTION 'A GRTP stage cannot start before the concussion'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'concussion_stage_after_concussion', TABLE = 'concussion_stage';
  END IF;
  SELECT * INTO last_closed FROM "medical"."concussion_stage" s
   WHERE s.club_id = NEW.club_id AND s.concussion_id = NEW.concussion_id AND s.outcome <> 'in_progress'
   ORDER BY s.ended_on DESC, s.created_at DESC, s.stage DESC LIMIT 1;
  current_level := CASE
             WHEN last_closed.id IS NULL THEN 0
             WHEN last_closed.outcome = 'passed' THEN last_closed.stage
             ELSE greatest(last_closed.stage - 1, 0)
           END;
  IF NEW.stage > current_level + 1 THEN
    RAISE EXCEPTION 'GRTP stage % cannot follow level % (one stage at a time)', NEW.stage, current_level
      USING ERRCODE = 'check_violation', CONSTRAINT = 'concussion_stage_order', TABLE = 'concussion_stage';
  END IF;
  IF last_closed.id IS NOT NULL AND NEW.started_on < last_closed.ended_on THEN
    RAISE EXCEPTION 'A GRTP stage starts after the previous one ended'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'concussion_stage_order', TABLE = 'concussion_stage';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Mandatory clearance (GRTP stage 6): only after stage 5 was the last stage and passed, no
-- stage in progress, on or after its end, signed by the acting user; final once given.
CREATE FUNCTION "medical"."concussion_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  last_closed "medical"."concussion_stage";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.cleared_on IS NOT NULL
       AND (NEW.cleared_on, NEW.cleared_by) IS DISTINCT FROM (OLD.cleared_on, OLD.cleared_by) THEN
      RAISE EXCEPTION 'A concussion clearance is final'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'concussion_clearance_final', TABLE = 'concussion';
    END IF;
    IF (NEW.player_id, NEW.occurred_on) IS DISTINCT FROM (OLD.player_id, OLD.occurred_on)
       AND EXISTS (SELECT 1 FROM "medical"."concussion_stage" s WHERE s.club_id = NEW.club_id AND s.concussion_id = NEW.id) THEN
      RAISE EXCEPTION 'The player and the day of a concussion with GRTP stages cannot change'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'concussion_stages_recorded', TABLE = 'concussion';
    END IF;
  END IF;
  IF NEW.cleared_on IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.cleared_on IS NULL) THEN
    SELECT * INTO last_closed FROM "medical"."concussion_stage" s
     WHERE s.club_id = NEW.club_id AND s.concussion_id = NEW.id AND s.outcome <> 'in_progress'
     ORDER BY s.ended_on DESC, s.created_at DESC, s.stage DESC LIMIT 1;
    IF last_closed.id IS NULL OR last_closed.stage <> 5 OR last_closed.outcome <> 'passed'
       OR EXISTS (SELECT 1 FROM "medical"."concussion_stage" s
                   WHERE s.club_id = NEW.club_id AND s.concussion_id = NEW.id AND s.outcome = 'in_progress') THEN
      RAISE EXCEPTION 'Clearance needs GRTP stage 5 passed as the last stage'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'concussion_clearance_needs_grtp', TABLE = 'concussion';
    END IF;
    IF NEW.cleared_on < last_closed.ended_on THEN
      RAISE EXCEPTION 'Clearance cannot be before the end of GRTP stage 5'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'concussion_clearance_needs_grtp', TABLE = 'concussion';
    END IF;
    IF NOT "medical"."acting_user_is"(NEW.cleared_by) THEN
      RAISE EXCEPTION 'A clearance is signed by the user who gives it'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'concussion_clearance_signer', TABLE = 'concussion';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- A lifted block stays lifted and names who lifted it.
CREATE FUNCTION "medical"."hold_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.lifted_at IS NOT NULL
     AND (NEW.lifted_at, NEW.lifted_by, NEW.valid_to, NEW.training, NEW.match, NEW.valid_from)
         IS DISTINCT FROM (OLD.lifted_at, OLD.lifted_by, OLD.valid_to, OLD.training, OLD.match, OLD.valid_from) THEN
    RAISE EXCEPTION 'A lifted medical block cannot change: record a new one'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hold_lift_final', TABLE = 'hold';
  END IF;
  IF NEW.lifted_by IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.lifted_by IS NULL)
     AND NOT "medical"."acting_user_is"(NEW.lifted_by) THEN
    RAISE EXCEPTION 'A block is lifted by the user who lifts it'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hold_lift_signer', TABLE = 'hold';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "concussion_stage_guard" BEFORE INSERT OR UPDATE ON "medical"."concussion_stage"
  FOR EACH ROW EXECUTE FUNCTION "medical"."concussion_stage_guard"();
--> statement-breakpoint
CREATE TRIGGER "concussion_guard" BEFORE INSERT OR UPDATE ON "medical"."concussion"
  FOR EACH ROW EXECUTE FUNCTION "medical"."concussion_guard"();
--> statement-breakpoint
CREATE TRIGGER "hold_guard" BEFORE INSERT OR UPDATE ON "medical"."hold"
  FOR EACH ROW EXECUTE FUNCTION "medical"."hold_guard"();
--> statement-breakpoint

-- Same shape for every clinical table (the catalog tests check it):
--   * ENABLE + FORCE ROW LEVEL SECURITY; `updated_at` trigger; AFTER trigger `log_write`.
--   * <t>_app_club: RESTRICTIVE, every command, `club_id` is the context's club.
--   * <t>_app_select: the writers' scope, only for the `id` column the API may filter
--     updates by. Reading anything else goes through `medical.read_*`.
--   * <t>_app_insert / <t>_app_update: `medical.may_write(player_id, needs_consent)`.
--     Without `updatable`, insert only (clinical notes).
--   * Grants: SELECT (id), INSERT, UPDATE on every column but the identity ones and
--     `player_id`. No DELETE, TRUNCATE, REFERENCES or TRIGGER. Nothing for the worker.
CREATE FUNCTION "app_admin"."secure_medical_table"(target regclass, needs_consent boolean, updatable boolean)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t text := (SELECT c.relname FROM pg_catalog.pg_class c WHERE c.oid = target);
  columns_to_update text;
  club_check constant text := 'club_id = (SELECT "app"."current_club_id"())';
  write_scope text := format('"medical"."may_write"(player_id, %L)', needs_consent);
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO columns_to_update
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = target AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     AND a.attname NOT IN ('id', 'club_id', 'created_at', 'created_by', 'client_uuid', 'player_id');

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR ALL TO "sport_performance_app" USING (%s) WITH CHECK (%s)',
                 t || '_app_club', target, club_check, club_check);
  EXECUTE format('CREATE POLICY %I ON %s FOR SELECT TO "sport_performance_app" USING ("medical"."may_write"(player_id, false))',
                 t || '_app_select', target);
  EXECUTE format('CREATE POLICY %I ON %s FOR INSERT TO "sport_performance_app" WITH CHECK (%s)',
                 t || '_app_insert', target, write_scope);
  EXECUTE format('GRANT SELECT ("id"), INSERT ON %s TO "sport_performance_app"', target);
  IF updatable THEN
    EXECUTE format('CREATE POLICY %I ON %s FOR UPDATE TO "sport_performance_app" USING (%s) WITH CHECK (%s)',
                   t || '_app_update', target, write_scope, write_scope);
    EXECUTE format('GRANT UPDATE (%s) ON %s TO "sport_performance_app"', columns_to_update, target);
  END IF;

  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"()',
                 t || '_set_updated_at', target);
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION "medical"."log_write"()',
                 t || '_log_write', target);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app_admin"."secure_medical_table"(regclass, boolean, boolean) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  PERFORM "app_admin"."secure_medical_table"('medical.injury', true, true);
  PERFORM "app_admin"."secure_medical_table"('medical.concussion', true, true);
  PERFORM "app_admin"."secure_medical_table"('medical.concussion_stage', true, true);
  -- A block protects the player: no consent needed to set or lift it (matrix: medical_block).
  PERFORM "app_admin"."secure_medical_table"('medical.hold', false, true);
  -- Clinical notes are append-only: a correction is a new note that amends the previous one.
  PERFORM "app_admin"."secure_medical_table"('medical.note', true, false);
END
$$;
--> statement-breakpoint

-- ─── medical.access_log: append-only, no access for the connection roles ────────────
ALTER TABLE "medical"."access_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "medical"."access_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER "access_log_append_only" BEFORE UPDATE OR DELETE ON "medical"."access_log"
  FOR EACH ROW EXECUTE FUNCTION "app_admin"."reject_log_change"();
--> statement-breakpoint
CREATE TRIGGER "access_log_no_truncate" BEFORE TRUNCATE ON "medical"."access_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "app_admin"."reject_log_change"();
--> statement-breakpoint

-- ─── medical: logged reads ───────────────────────────────────────────────────────────
-- Each returns the rows the context may read (`player_ids` NULL: all of them) and writes
-- the `read` rows of the log before returning.
CREATE FUNCTION "medical"."read_injuries"(player_ids uuid[] DEFAULT NULL) RETURNS SETOF "medical"."injury"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope uuid[] := "medical"."readable_players"('injury', player_ids);
  result "medical"."injury"[];
BEGIN
  SELECT coalesce(array_agg(x ORDER BY x.onset_on DESC, x.id), '{}') INTO result
    FROM "medical"."injury" x
   WHERE x.club_id = "app"."current_club_id"() AND x.player_id = ANY (scope);
  PERFORM "medical"."log_read"('injury', player_ids,
    ARRAY(SELECT r.player_id FROM unnest(result) r), ARRAY(SELECT r.id FROM unnest(result) r));
  RETURN QUERY SELECT * FROM unnest(result);
END;
$$;
--> statement-breakpoint

CREATE FUNCTION "medical"."read_concussions"(player_ids uuid[] DEFAULT NULL) RETURNS SETOF "medical"."concussion"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope uuid[] := "medical"."readable_players"('concussion', player_ids);
  result "medical"."concussion"[];
BEGIN
  SELECT coalesce(array_agg(x ORDER BY x.occurred_on DESC, x.id), '{}') INTO result
    FROM "medical"."concussion" x
   WHERE x.club_id = "app"."current_club_id"() AND x.player_id = ANY (scope);
  PERFORM "medical"."log_read"('concussion', player_ids,
    ARRAY(SELECT r.player_id FROM unnest(result) r), ARRAY(SELECT r.id FROM unnest(result) r));
  RETURN QUERY SELECT * FROM unnest(result);
END;
$$;
--> statement-breakpoint

CREATE FUNCTION "medical"."read_concussion_stages"(player_ids uuid[] DEFAULT NULL) RETURNS SETOF "medical"."concussion_stage"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope uuid[] := "medical"."readable_players"('concussion_stage', player_ids);
  result "medical"."concussion_stage"[];
BEGIN
  SELECT coalesce(array_agg(x ORDER BY x.concussion_id, x.started_on, x.created_at), '{}') INTO result
    FROM "medical"."concussion_stage" x
   WHERE x.club_id = "app"."current_club_id"() AND x.player_id = ANY (scope);
  PERFORM "medical"."log_read"('concussion_stage', player_ids,
    ARRAY(SELECT r.player_id FROM unnest(result) r), ARRAY(SELECT r.id FROM unnest(result) r));
  RETURN QUERY SELECT * FROM unnest(result);
END;
$$;
--> statement-breakpoint

CREATE FUNCTION "medical"."read_holds"(player_ids uuid[] DEFAULT NULL) RETURNS SETOF "medical"."hold"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope uuid[] := "medical"."readable_players"('hold', player_ids);
  result "medical"."hold"[];
BEGIN
  SELECT coalesce(array_agg(x ORDER BY x.valid_from DESC, x.id), '{}') INTO result
    FROM "medical"."hold" x
   WHERE x.club_id = "app"."current_club_id"() AND x.player_id = ANY (scope);
  PERFORM "medical"."log_read"('hold', player_ids,
    ARRAY(SELECT r.player_id FROM unnest(result) r), ARRAY(SELECT r.id FROM unnest(result) r));
  RETURN QUERY SELECT * FROM unnest(result);
END;
$$;
--> statement-breakpoint

-- The holder reads `shared` notes only; the medical staff reads all of them.
CREATE FUNCTION "medical"."read_notes"(player_ids uuid[] DEFAULT NULL) RETURNS SETOF "medical"."note"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope uuid[] := "medical"."readable_players"('note', player_ids);
  all_notes boolean := "app"."current_role"() = 'medical';
  result "medical"."note"[];
BEGIN
  SELECT coalesce(array_agg(x ORDER BY x.created_at DESC, x.id), '{}') INTO result
    FROM "medical"."note" x
   WHERE x.club_id = "app"."current_club_id"() AND x.player_id = ANY (scope)
     AND (all_notes OR x.visibility = 'shared');
  PERFORM "medical"."log_read"('note', player_ids,
    ARRAY(SELECT r.player_id FROM unnest(result) r), ARRAY(SELECT r.id FROM unnest(result) r));
  RETURN QUERY SELECT * FROM unnest(result);
END;
$$;
--> statement-breakpoint

-- ─── medical.availability: the derived status, never the cause ──────────────────────
CREATE TYPE "medical"."player_availability" AS (
  "player_id" uuid,
  "on_date" date,
  "training" "medical"."availability_status",
  "match" "medical"."availability_status",
  "overall" "medical"."availability_status",
  "staff_notes" text[]
);
--> statement-breakpoint

-- Availability of the players the context may see on a club day (default: today), for
-- training and for matches, and the worst of both. The worst of the blocks in force and of
-- every concussion not cleared that day (CONCUSSION_GRTP_STAGES of the domain: never a
-- match; training unavailable without a stage, at stage 1 or after symptoms, limited from
-- stage 2). `staff_notes` are the blocks' notes for the staff. No diagnosis, no cause.
CREATE FUNCTION "medical"."availability"(player_ids uuid[] DEFAULT NULL, on_date date DEFAULT NULL)
RETURNS SETOF "medical"."player_availability"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope uuid[] := "medical"."readable_players"('availability', player_ids);
  club uuid := "app"."current_club_id"();
  club_day date := coalesce(on_date, "app"."club_today"());
  result "medical"."player_availability"[];
BEGIN
  WITH holds AS (
    SELECT h.player_id AS pid, max(h.training) AS training, max(h."match") AS "match",
           array_agg(h.staff_note ORDER BY h.valid_from, h.id) FILTER (WHERE h.staff_note IS NOT NULL) AS notes
      FROM "medical"."hold" h
     WHERE h.club_id = club AND h.player_id = ANY (scope)
       AND h.valid_from <= club_day AND (h.valid_to IS NULL OR h.valid_to > club_day)
     GROUP BY h.player_id
  ), concussions AS (
    SELECT c.player_id AS pid,
           max(CASE WHEN ls.stage IS NULL OR ls.stage = 1 OR ls.outcome = 'symptomatic'
                    THEN 'unavailable' ELSE 'limited' END::"medical"."availability_status") AS training
      FROM "medical"."concussion" c
      LEFT JOIN LATERAL (
        SELECT s.stage, s.outcome FROM "medical"."concussion_stage" s
         WHERE s.club_id = c.club_id AND s.concussion_id = c.id AND s.started_on <= club_day
         ORDER BY s.started_on DESC, s.created_at DESC LIMIT 1
      ) ls ON true
     WHERE c.club_id = club AND c.player_id = ANY (scope)
       AND c.occurred_on <= club_day AND (c.cleared_on IS NULL OR c.cleared_on > club_day)
     GROUP BY c.player_id
  ), statuses AS (
    SELECT p.pid,
           greatest(coalesce(h.training, 'available'), coalesce(c.training, 'available')) AS training,
           greatest(coalesce(h."match", 'available'),
                    CASE WHEN c.pid IS NULL THEN 'available' ELSE 'unavailable' END::"medical"."availability_status") AS "match",
           coalesce(h.notes, '{}') AS notes
      FROM unnest(scope) AS p(pid)
      LEFT JOIN holds h ON h.pid = p.pid
      LEFT JOIN concussions c ON c.pid = p.pid
  )
  SELECT coalesce(array_agg(ROW(s.pid, club_day, s.training, s."match", greatest(s.training, s."match"), s.notes)::"medical"."player_availability"
                            ORDER BY s.pid), '{}')
    INTO result FROM statuses s;
  PERFORM "medical"."log_read"('availability', player_ids,
    ARRAY(SELECT r.player_id FROM unnest(result) r), ARRAY(SELECT NULL::uuid FROM unnest(result) r));
  RETURN QUERY SELECT * FROM unnest(result);
END;
$$;
--> statement-breakpoint

-- Only the public entry points are executable by the API; the helpers run as the owner
-- from inside them. may_write is called by the policies, as the invoker.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "medical" FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  "medical"."read_injuries"(uuid[]),
  "medical"."read_concussions"(uuid[]),
  "medical"."read_concussion_stages"(uuid[]),
  "medical"."read_holds"(uuid[]),
  "medical"."read_notes"(uuid[]),
  "medical"."availability"(uuid[], date),
  "medical"."may_write"(uuid, boolean)
  TO "sport_performance_app";
