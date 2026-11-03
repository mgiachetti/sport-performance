CREATE TYPE "public"."data_subject_request_kind" AS ENUM('access', 'erasure');--> statement-breakpoint
CREATE TYPE "public"."data_subject_request_status" AS ENUM('pending', 'completed', 'rejected', 'cancelled');--> statement-breakpoint
ALTER TYPE "medical"."access_action" ADD VALUE 'delete';--> statement-breakpoint
CREATE TABLE "data_subject_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"kind" "data_subject_request_kind" NOT NULL,
	"status" "data_subject_request_status" NOT NULL,
	"requested_by" text,
	"requester_role" "membership_role" NOT NULL,
	"note" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text,
	"erased_rows" jsonb,
	CONSTRAINT "data_subject_request_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "data_subject_request_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "data_subject_request_requester_role" CHECK ("data_subject_request"."requester_role" in ('player', 'parent', 'admin')),
	CONSTRAINT "data_subject_request_access_completed" CHECK ("data_subject_request"."kind" <> 'access' or "data_subject_request"."status" = 'completed'),
	CONSTRAINT "data_subject_request_resolution" CHECK (("data_subject_request"."status" = 'pending') = ("data_subject_request"."resolved_at" is null)
          and ("data_subject_request"."status" <> 'rejected' or btrim(coalesce("data_subject_request"."resolution_note", '')) <> '')
          and ("data_subject_request"."erased_rows" is null or ("data_subject_request"."kind" = 'erasure' and "data_subject_request"."status" = 'completed'))),
	CONSTRAINT "data_subject_request_note_length" CHECK (char_length(coalesce("data_subject_request"."note", '')) <= 1000
          and char_length(coalesce("data_subject_request"."resolution_note", '')) <= 1000)
);
--> statement-breakpoint
ALTER TABLE "file" DROP CONSTRAINT "file_subject";--> statement-breakpoint
ALTER TABLE "data_subject_request" ADD CONSTRAINT "data_subject_request_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_request" ADD CONSTRAINT "data_subject_request_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_request" ADD CONSTRAINT "data_subject_request_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_request" ADD CONSTRAINT "data_subject_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_request" ADD CONSTRAINT "data_subject_request_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_subject_request_player_idx" ON "data_subject_request" USING btree ("club_id","player_id","created_at");--> statement-breakpoint
CREATE INDEX "data_subject_request_requested_by_idx" ON "data_subject_request" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "data_subject_request_status_idx" ON "data_subject_request" USING btree ("club_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_subject_request_pending_erasure_key" ON "data_subject_request" USING btree ("club_id","player_id") WHERE "data_subject_request"."kind" = 'erasure' and "data_subject_request"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_subject" CHECK ((("file"."kind" in ('cmj_video', 'pdf_report')) = ("file"."player_id" is not null) or ("file"."status" = 'deleted' and "file"."player_id" is null)) and ("file"."category_id" is null or "file"."kind" in ('data_import')));--> statement-breakpoint

-- ─── Hand-written (B-329, ADR 0051) ──────────────────────────────────────────────────
CREATE TRIGGER "data_subject_request_set_updated_at" BEFORE UPDATE ON "data_subject_request" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- A request is evidence. While pending, only its resolution changes (status, resolution,
-- erased rows); once resolved nothing changes, except the authors becoming NULL (the
-- `ON DELETE SET NULL` of a deleted account). Never deleted, not even with the player.
CREATE FUNCTION "public"."data_subject_request_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A request of the data subject is evidence: it is never deleted'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'data_subject_request_immutable',
            TABLE = 'data_subject_request';
  END IF;
  IF (NEW.id, NEW.club_id, NEW.client_uuid, NEW.created_at, NEW.player_id, NEW.kind,
      NEW.requester_role, NEW.note)
     IS DISTINCT FROM
     (OLD.id, OLD.club_id, OLD.client_uuid, OLD.created_at, OLD.player_id, OLD.kind,
      OLD.requester_role, OLD.note)
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL)
     OR (NEW.requested_by IS DISTINCT FROM OLD.requested_by AND NEW.requested_by IS NOT NULL)
     OR (OLD.status <> 'pending'
         AND ((NEW.status, NEW.resolved_at, NEW.resolution_note, NEW.erased_rows)
              IS DISTINCT FROM (OLD.status, OLD.resolved_at, OLD.resolution_note, OLD.erased_rows)
              OR (NEW.resolved_by IS DISTINCT FROM OLD.resolved_by AND NEW.resolved_by IS NOT NULL)
              OR (NEW.updated_by IS DISTINCT FROM OLD.updated_by AND NEW.updated_by IS NOT NULL))) THEN
    RAISE EXCEPTION 'A request of the data subject only changes to be resolved, once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'data_subject_request_immutable',
            TABLE = 'data_subject_request';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."data_subject_request_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "data_subject_request_guard" BEFORE UPDATE OR DELETE ON "public"."data_subject_request"
  FOR EACH ROW EXECUTE FUNCTION "public"."data_subject_request_guard"();
--> statement-breakpoint

-- RLS (ADR 0026, permission matrix data_export / data_erasure): the administration reads
-- every request of the club; the holder (player, parent), the requests they made (also after
-- the player was erased: the player is no longer visible, the request is still theirs). The
-- superadmin does not: support never exports or erases players.
DO $$
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.data_subject_request',
    '(SELECT "app"."current_role"()) = ''admin'' OR (requested_by = (SELECT "app"."current_user_id"()) AND (SELECT "app"."current_role"()) IN (''player'', ''parent''))',
    '{}');
END
$$;
--> statement-breakpoint
-- Asking: the holder (player, parent) on a player they see, or the administration, always as
-- themselves with their role. An export is recorded completed (resolved by whoever exported),
-- an erasure pending. Nobody inserts a completed erasure: only app.erase_player completes it.
CREATE POLICY "data_subject_request_app_insert" ON "public"."data_subject_request" FOR INSERT TO "sport_performance_app" WITH CHECK (
  (SELECT "app"."current_role"()) IN ('player', 'parent', 'admin')
  AND requester_role::text = (SELECT "app"."current_role"())
  AND requested_by = (SELECT "app"."current_user_id"())
  AND ((SELECT "app"."current_role"()) = 'admin'
       OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))
  AND erased_rows IS NULL
  AND ((kind = 'access' AND status = 'completed' AND resolved_by = (SELECT "app"."current_user_id"()))
       OR (kind = 'erasure' AND status = 'pending' AND resolved_by IS NULL)));
--> statement-breakpoint
-- Resolving in the API: whoever asked cancels their pending request; the administration
-- cancels or rejects any pending request. Executing an erasure is app.erase_player.
CREATE POLICY "data_subject_request_app_update" ON "public"."data_subject_request" FOR UPDATE TO "sport_performance_app"
  USING (
    status = 'pending'
    AND ((SELECT "app"."current_role"()) = 'admin'
         OR (requested_by = (SELECT "app"."current_user_id"())
             AND (SELECT "app"."current_role"()) IN ('player', 'parent'))))
  WITH CHECK (
    resolved_by = (SELECT "app"."current_user_id"())
    AND erased_rows IS NULL
    AND (status = 'cancelled' OR (status = 'rejected' AND (SELECT "app"."current_role"()) = 'admin')));
--> statement-breakpoint
GRANT INSERT ON "public"."data_subject_request" TO "sport_performance_app";
--> statement-breakpoint
GRANT UPDATE ("status", "resolved_at", "resolved_by", "resolution_note", "updated_at", "updated_by")
  ON "public"."data_subject_request" TO "sport_performance_app";
--> statement-breakpoint

-- ─── Tables that reference a player ──────────────────────────────────────────────────
-- Every table with a foreign key (club_id, <column>) → player (club_id, id), in `public` and
-- `medical`, read from the catalog: a table added later is exported and erased without
-- editing the functions below.
CREATE FUNCTION "app_admin"."player_references"()
RETURNS TABLE (table_ref regclass, column_name name)
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.conrelid::regclass, a.attname
    FROM pg_catalog.pg_constraint c
    JOIN LATERAL unnest(c.conkey, c.confkey) AS k(attnum, fattnum) ON true
    JOIN pg_catalog.pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = k.fattnum
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.contype = 'f' AND c.confrelid = 'public.player'::regclass AND fa.attname = 'id'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app_admin"."player_references"() FROM PUBLIC;
--> statement-breakpoint

-- ─── Erasure marker ──────────────────────────────────────────────────────────────────
-- The change history is immutable, also for the owner (ADR 0030). The erasure of a player
-- (Ley 25.326, art. 16) is the one exception, and only for the rows of that player in the
-- transaction that erases them: app.erase_player writes this marker, the guard looks it up.
-- A history row is the player's by its `player_id` only: a row moved from one player to
-- another keeps the first one in `old_values`, but its history is the second one's.
-- Nobody but the owner reaches `app_admin` (no grants): the API cannot fake it with a setting.
CREATE TABLE "app_admin"."erasure_in_progress" (
  "transaction_id" xid8 NOT NULL,
  "erased_club_id" uuid NOT NULL,
  "erased_player_id" uuid NOT NULL,
  PRIMARY KEY ("transaction_id", "erased_club_id", "erased_player_id")
);
--> statement-breakpoint
REVOKE ALL ON "app_admin"."erasure_in_progress" FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."change_history_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['created_by', 'updated_by', 'updated_at'])
         = (to_jsonb(OLD) - ARRAY['created_by', 'updated_by', 'updated_at'])
     AND (NEW.created_by IS NULL OR NEW.created_by IS NOT DISTINCT FROM OLD.created_by)
     AND (NEW.updated_by IS NULL OR NEW.updated_by IS NOT DISTINCT FROM OLD.updated_by) THEN
    RETURN NEW;
  END IF;
  -- Only the owner gets here with a DELETE (no connection role has the grant).
  IF TG_OP = 'DELETE' AND EXISTS (
       SELECT 1 FROM "app_admin"."erasure_in_progress" e
        WHERE e.transaction_id = pg_catalog.pg_current_xact_id()
          AND e.erased_club_id = OLD.club_id
          AND e.erased_player_id = OLD.player_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'change_history is append-only'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'change_history_append_only',
          TABLE = 'change_history';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."change_history_guard"() FROM PUBLIC;
--> statement-breakpoint

-- ─── Export (Ley 25.326, art. 14) ────────────────────────────────────────────────────
-- Every row of every `public` table that references the player, keyed by `schema.table`,
-- plus the values of the player's results, the sessions and test days they took part in and
-- the consent texts they signed. SECURITY DEFINER: the holder's right of access covers rows
-- RLS hides from them (alerts), so the function checks the caller itself; the API asks the
-- permission matrix first (data_export.export: of age, minor, consent). Left out:
--   * the `medical` schema: read only through its audited functions (ADR 0029), by the API;
--   * `invitation` and `player_access_code`: access management, with token hashes and other
--     people's emails, not data about the player.
-- NULL for a player of another club or that does not exist.
CREATE FUNCTION "app"."export_player_data"(target uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  club uuid := "app"."current_club_id"();
  ctx_role text := "app"."current_role"();
  result jsonb;
  rows jsonb;
  ref record;
BEGIN
  IF club IS NULL OR ctx_role IS NULL OR ctx_role NOT IN ('player', 'parent', 'admin') THEN
    RAISE EXCEPTION 'Only the holder or the administration exports a player''s data'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF ctx_role <> 'admin' AND NOT (target = ANY ("app"."visible_player_ids"())) THEN
    RAISE EXCEPTION 'The player is not visible to the caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The holder by age, as the matrix says (data_export.export): the player once of age, the
  -- guardian while the player is a minor (an adult who kept the link decides alone).
  IF ctx_role IN ('player', 'parent') AND EXISTS (
       SELECT 1 FROM "public"."player" p
        WHERE p.club_id = club AND p.id = target
          AND (p.birth_date > ("app"."club_today"() - interval '18 years')::date) <> (ctx_role = 'parent')) THEN
    RAISE EXCEPTION 'Only the holder exports: the player once of age, the guardian of a minor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT jsonb_build_array(to_jsonb(p)) INTO rows
    FROM "public"."player" p WHERE p.club_id = club AND p.id = target;
  IF rows IS NULL THEN
    RETURN NULL;
  END IF;
  result := jsonb_build_object('public.player', rows);
  FOR ref IN
    SELECT r.table_ref, r.column_name FROM "app_admin"."player_references"() r
      JOIN pg_catalog.pg_class t ON t.oid = r.table_ref
     WHERE t.relnamespace = 'public'::regnamespace
       AND r.table_ref NOT IN ('public.invitation'::regclass, 'public.player_access_code'::regclass)
     ORDER BY r.table_ref::text
  LOOP
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id), ''[]'') FROM %s x WHERE x.club_id = $1 AND x.%I = $2',
      ref.table_ref, ref.column_name)
      INTO rows USING club, target;
    result := result || jsonb_build_object(ref.table_ref::text, rows);
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.created_at, v.id), '[]') INTO rows
    FROM "public"."test_result_value" v
    JOIN "public"."test_result" r ON r.club_id = v.club_id AND r.id = v.test_result_id
   WHERE r.club_id = club AND r.player_id = target;
  result := result || jsonb_build_object('public.test_result_value', rows);
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.created_at, s.id), '[]') INTO rows
    FROM "public"."training_session" s
   WHERE s.club_id = club AND s.id IN (
     SELECT pa.training_session_id FROM "public"."participation" pa
      WHERE pa.club_id = club AND pa.player_id = target);
  result := result || jsonb_build_object('public.training_session', rows);
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.created_at, s.id), '[]') INTO rows
    FROM "public"."test_session" s
   WHERE s.club_id = club AND s.id IN (
     SELECT r.test_session_id FROM "public"."test_result" r
      WHERE r.club_id = club AND r.player_id = target);
  result := result || jsonb_build_object('public.test_session', rows);
  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.created_at, d.id), '[]') INTO rows
    FROM "public"."consent_document" d
   WHERE d.club_id = club AND d.id IN (
     SELECT c.document_id FROM "public"."consent" c WHERE c.club_id = club AND c.player_id = target);
  result := result || jsonb_build_object('public.consent_document', rows);
  -- The requests about the player (this export's own included): no key to the player, they
  -- outlive them as evidence.
  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.created_at, d.id), '[]') INTO rows
    FROM "public"."data_subject_request" d WHERE d.club_id = club AND d.player_id = target;
  result := result || jsonb_build_object('public.data_subject_request', rows);
  RETURN result;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."export_player_data"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."export_player_data"(uuid) TO "sport_performance_app";
--> statement-breakpoint

-- ─── Deleting a user account ─────────────────────────────────────────────────────────
-- What deleting an account removes (ADR 0023): the user row cascades to its sessions,
-- accounts, known devices, memberships (and staff assignments) and guardian links, and its
-- id becomes NULL in the club tables. When a RESTRICT key keeps the row as legal evidence
-- (a signed or revoked consent, a medical clearance, a lifted hold), the row stays with its
-- id only, anonymized (reserved `.invalid` address, RFC 2606), and the rest goes the same.
-- The user's email also leaves the invitations (pending ones are revoked) and the pending
-- sign-in codes. Returns `deleted`, `anonymized` or NULL (no such user). Internal: no grants.
CREATE FUNCTION "app_admin"."delete_user_account"(target_user text) RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  address text;
  tombstone text := 'deleted.' || target_user || '@deleted.invalid';
  fk record;
BEGIN
  SELECT u.email INTO address FROM "public"."user" u WHERE u.id = target_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- An account deletion is no correction of submitted data, but the change history records
  -- the evaluator that becomes NULL, with this reason.
  PERFORM set_config('app.change_reason', 'account deleted by its holder', true);
  UPDATE "public"."invitation" i SET revoked_at = now()
   WHERE i.email = lower(address) AND i.accepted_at IS NULL AND i.revoked_at IS NULL;
  UPDATE "public"."invitation" i SET email = tombstone
   WHERE i.email = lower(address) OR i.accepted_by = target_user;
  -- Better Auth's codes: `<type>-otp-<email>` (sign-in, verification, password).
  DELETE FROM "public"."verification" v
   WHERE v.identifier = address OR v.identifier = lower(address)
      OR right(v.identifier, length(address) + 5) = '-otp-' || lower(address);
  BEGIN
    DELETE FROM "public"."user" u WHERE u.id = target_user;
    RETURN 'deleted';
  EXCEPTION WHEN foreign_key_violation THEN
    -- The subtransaction rolled the cascade back: do what it would have done (every
    -- `ON DELETE CASCADE` key to the user, from the catalog: a table added later goes too),
    -- unlink their player, then keep the row with its id only.
    FOR fk IN
      SELECT c.conrelid::regclass AS table_ref, a.attname AS column_name
        FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f' AND c.confrelid = 'public.user'::regclass
         AND c.confdeltype = 'c' AND cardinality(c.conkey) = 1
       ORDER BY c.conrelid::regclass::text, a.attname
    LOOP
      EXECUTE format('DELETE FROM %s WHERE %I = $1', fk.table_ref, fk.column_name)
        USING target_user;
    END LOOP;
    UPDATE "public"."player" p SET user_id = NULL WHERE p.user_id = target_user;
    UPDATE "public"."user" u
       SET name = '', email = tombstone, email_verified = false, image = NULL
     WHERE u.id = target_user;
    RETURN 'anonymized';
  END;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app_admin"."delete_user_account"(text) FROM PUBLIC;
--> statement-breakpoint

-- The account deletion of the caller (Apple App Store Review Guideline 5.1.1(v)): only their
-- own (`app.user_id`; the club of the context, if any, does not matter: the account is
-- global), never a superadmin (an operator does that). With `request_erasure`, it also files a pending erasure request for every player the
-- caller is the holder of, in every club: their own player once of age, their children while
-- minors (the requests keep the role; their author becomes NULL with the account).
CREATE FUNCTION "app"."delete_own_account"(request_erasure boolean)
RETURNS TABLE (outcome text, erasure_requests jsonb)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  caller text := "app"."current_user_id"();
  requests jsonb := '[]';
  result text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'An account is deleted by its signed-in user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."user" u WHERE u.id = caller AND u.is_superadmin) THEN
    RAISE EXCEPTION 'A superadmin account is deleted by an operator'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF request_erasure THEN
    WITH holder AS (
      SELECT p.club_id, p.id AS player_id, 'player'::"public"."membership_role" AS role
        FROM "public"."player" p
        JOIN "public"."club" c ON c.id = p.club_id
       WHERE p.user_id = caller
         AND p.birth_date + interval '18 years' <= (now() AT TIME ZONE c.time_zone)::date
         AND EXISTS (SELECT 1 FROM "public"."membership" m
                      WHERE m.club_id = p.club_id AND m.user_id = caller AND m.role = 'player'
                        AND m.started_at <= now() AND (m.ended_at IS NULL OR m.ended_at > now()))
      UNION
      SELECT p.club_id, p.id, 'parent'::"public"."membership_role"
        FROM "public"."guardian" g
        JOIN "public"."player" p ON p.club_id = g.club_id AND p.id = g.player_id
        JOIN "public"."club" c ON c.id = p.club_id
       WHERE g.user_id = caller
         AND g.valid_from <= (now() AT TIME ZONE c.time_zone)::date
         AND (g.valid_to IS NULL OR g.valid_to > (now() AT TIME ZONE c.time_zone)::date)
         AND p.birth_date + interval '18 years' > (now() AT TIME ZONE c.time_zone)::date
         AND EXISTS (SELECT 1 FROM "public"."membership" m
                      WHERE m.club_id = p.club_id AND m.user_id = caller AND m.role = 'parent'
                        AND m.started_at <= now() AND (m.ended_at IS NULL OR m.ended_at > now()))
    ), inserted AS (
      INSERT INTO "public"."data_subject_request"
        (club_id, player_id, kind, status, requested_by, requester_role, created_by, updated_by)
      SELECT DISTINCT ON (h.club_id, h.player_id)
             h.club_id, h.player_id, 'erasure', 'pending', caller, h.role, caller, caller
        FROM holder h
       ORDER BY h.club_id, h.player_id, h.role
      -- One already pending (also one filed at this very moment by someone else) stays.
      ON CONFLICT (club_id, player_id) WHERE kind = 'erasure' AND status = 'pending' DO NOTHING
      RETURNING id, club_id, player_id
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'clubId', i.club_id, 'playerId', i.player_id)
                             ORDER BY i.club_id, i.player_id), '[]')
      INTO requests FROM inserted i;
  END IF;
  result := "app_admin"."delete_user_account"(caller);
  IF result IS NULL THEN
    RAISE EXCEPTION 'No such user' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN QUERY SELECT result, requests;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."delete_own_account"(boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."delete_own_account"(boolean) TO "sport_performance_app";
--> statement-breakpoint

-- ─── Erasure (Ley 25.326, art. 16) ───────────────────────────────────────────────────
-- Executes a pending erasure request of the context's club: only the administration (the
-- club is the controller; the permission matrix says so too, data_erasure.execute), only
-- through a request (the API creates and lists them), only rows of that club and player.
-- In this transaction it deletes every row that references the player, in `public` and
-- `medical` (from the catalog), with the rows that only exist through one of them (every
-- column of their key NOT NULL: the values of a result, the stages of a concussion),
-- children first along the foreign keys; then the player's change history (marker above),
-- then the player. A row that merely points at one of them (a nullable key) is no part of
-- the player: it stops the erasure, which rolls back whole. Files are the exception: their
-- rows stay as the record of an object in the bucket, deleted and without the player or the
-- file name, and the retention job removes the object once no upload URL of it can be
-- honored (`deletedFileExpiresAt`, ADR 0044). The player's account without email (B-310)
-- goes with them; an account with its own email is global: it stays, and its `player`
-- membership in this club ends. Kept as evidence, with the player's id only:
-- `medical.access_log`, `support.access_log` and the requests themselves (this one records
-- the rows erased per table, `public.file` counting the files detached). Returns the counts.
CREATE FUNCTION "app"."erase_player"(request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  club uuid := "app"."current_club_id"();
  actor text := "app"."current_user_id"();
  -- FILE_UPLOAD_URL_MAX_TTL_S of the domain: the longest life of a signed upload URL.
  max_upload_url constant interval := interval '3600 seconds';
  req "public"."data_subject_request";
  target "public"."player";
  tables regclass[] := '{}';
  filters text[] := '{}';
  ref record;
  i int;
  progressed boolean;
  n bigint;
  counts jsonb := '{}';
  blocked_by text;
  blocked_table text;
BEGIN
  IF club IS NULL OR "app"."current_role"() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only the administration of the club erases a player'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO req FROM "public"."data_subject_request" r
   WHERE r.club_id = club AND r.id = request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such request in the club' USING ERRCODE = 'no_data_found';
  END IF;
  IF req.kind <> 'erasure' OR req.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending erasure request is executed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'erasure_request_not_pending',
            TABLE = 'data_subject_request';
  END IF;
  -- Locks the player: rows that reference it wait for this transaction (and then fail).
  SELECT * INTO target FROM "public"."player" p
   WHERE p.club_id = club AND p.id = req.player_id FOR UPDATE;

  IF FOUND THEN
    INSERT INTO "app_admin"."erasure_in_progress" VALUES (pg_current_xact_id(), club, target.id);
    -- Deleting tracked rows writes their history (purged right after); with a reason, the
    -- API's login is not asked for one.
    PERFORM set_config('app.change_reason', 'erasure of the data subject (Ley 25.326, art. 16)', true);

    -- Files: deleted and detached; the retention job removes the objects.
    UPDATE "public"."file" f
       SET status = 'deleted', player_id = NULL, file_name = NULL,
           deleted_at = coalesce(f.deleted_at, now()),
           expires_at = CASE
             WHEN f.status = 'deleted' THEN coalesce(f.expires_at, now())
             WHEN f.status = 'pending' THEN
               greatest(now(), least(coalesce(f.expires_at, now() + max_upload_url), now() + max_upload_url))
             WHEN f.uploaded_at IS NOT NULL THEN greatest(now(), f.uploaded_at + max_upload_url)
             ELSE now()
           END,
           updated_by = actor
     WHERE f.club_id = club AND f.player_id = target.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    counts := counts || jsonb_build_object('public.file', n);

    -- The rows of the player: by their key to the player...
    FOR ref IN
      SELECT r.table_ref, r.column_name FROM "app_admin"."player_references"() r
       WHERE r.table_ref NOT IN ('public.change_history'::regclass, 'public.file'::regclass)
       ORDER BY r.table_ref::text, r.column_name
    LOOP
      tables := tables || ref.table_ref;
      filters := filters || format('club_id = %L AND %I = %L', club, ref.column_name, target.id);
    END LOOP;
    -- ...and the rows that only exist through one of those, at any depth.
    i := 1;
    WHILE i <= cardinality(tables) LOOP
      IF i > 1000 THEN
        RAISE EXCEPTION 'Too many tables depend on a player: %', tables[1:20];
      END IF;
      FOR ref IN
        SELECT c.conrelid::regclass AS child,
               string_agg(format('%I', a.attname), ', ' ORDER BY k.ord) AS child_columns,
               string_agg(format('%I', fa.attname), ', ' ORDER BY k.ord) AS parent_columns
          FROM pg_catalog.pg_constraint c
          CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(attnum, fattnum, ord)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          JOIN pg_catalog.pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = k.fattnum
         WHERE c.contype = 'f' AND c.confrelid = tables[i] AND c.conrelid <> tables[i]
           AND c.conrelid NOT IN (SELECT r.table_ref FROM "app_admin"."player_references"() r)
         GROUP BY c.oid, c.conrelid
        HAVING bool_and(a.attnotnull)
         ORDER BY c.conrelid::regclass::text, c.oid
      LOOP
        tables := tables || ref.child;
        filters := filters || format('(%s) IN (SELECT %s FROM %s WHERE %s)',
                                     ref.child_columns, ref.parent_columns, tables[i], filters[i]);
      END LOOP;
      i := i + 1;
    END LOOP;
    -- Children first: a table goes once no other pending table points at it (a dependent
    -- row is deleted while its parent still exists, so its change history names the player).
    WHILE cardinality(tables) > 0 LOOP
      progressed := false;
      i := 1;
      WHILE i <= cardinality(tables) LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                        WHERE c.contype = 'f' AND c.confrelid = tables[i]
                          AND c.conrelid <> tables[i] AND c.conrelid = ANY (tables)) THEN
          BEGIN
            EXECUTE format('DELETE FROM %s WHERE %s', tables[i], filters[i]);
          EXCEPTION WHEN foreign_key_violation THEN
            -- A row that is not the player's points at one of theirs (another player's set
            -- logged against their program, the crest of the club…): nothing is erased.
            GET STACKED DIAGNOSTICS blocked_by = CONSTRAINT_NAME, blocked_table = TABLE_NAME;
            RAISE EXCEPTION 'A row that is not part of the player points at their data (%)', blocked_by
              USING ERRCODE = 'check_violation', CONSTRAINT = 'erasure_blocked',
                    TABLE = blocked_table, DETAIL = blocked_by;
          END;
          GET DIAGNOSTICS n = ROW_COUNT;
          counts := counts || jsonb_build_object(
            tables[i]::text, coalesce((counts ->> tables[i]::text)::bigint, 0) + n);
          tables := tables[:i - 1] || tables[i + 1:];
          filters := filters[:i - 1] || filters[i + 1:];
          progressed := true;
        ELSE
          i := i + 1;
        END IF;
      END LOOP;
      IF NOT progressed THEN
        RAISE EXCEPTION 'Cycle of foreign keys between the tables of a player: %', tables;
      END IF;
    END LOOP;

    -- The offline sync log (ADR 0050) has no key to the player: deleting their rows turned
    -- each entry of theirs into a deletion mark. The marks stay, with ids only (no clocks of
    -- the fields), so a device that synced a row of the player learns it is gone: the
    -- administration's devices see the whole club and get no reset when a player leaves.
    UPDATE "public"."sync_change" c SET deleted = true, field_hlc = '{}'::jsonb
     WHERE c.club_id = club AND c.player_id = target.id;

    DELETE FROM "public"."change_history" h WHERE h.club_id = club AND h.player_id = target.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    counts := counts || jsonb_build_object('public.change_history', n);

    BEGIN
      DELETE FROM "public"."player" p WHERE p.club_id = club AND p.id = target.id;
    EXCEPTION WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS blocked_by = CONSTRAINT_NAME, blocked_table = TABLE_NAME;
      RAISE EXCEPTION 'A row that is not part of the player points at them (%)', blocked_by
        USING ERRCODE = 'check_violation', CONSTRAINT = 'erasure_blocked',
              TABLE = blocked_table, DETAIL = blocked_by;
    END;
    counts := counts || jsonb_build_object('public.player', 1);

    IF target.user_id IS NOT NULL THEN
      IF "app"."is_player_no_email_account"(target.id, target.user_id) THEN
        PERFORM "app_admin"."delete_user_account"(target.user_id);
        counts := counts || jsonb_build_object('public.user', 1);
      ELSE
        UPDATE "public"."membership" m
           SET ended_at = greatest(now(), m.started_at + interval '1 microsecond'), updated_by = actor
         WHERE m.club_id = club AND m.user_id = target.user_id AND m.role = 'player'
           AND (m.ended_at IS NULL OR m.ended_at > now());
      END IF;
    END IF;

    DELETE FROM "app_admin"."erasure_in_progress" e
     WHERE e.transaction_id = pg_current_xact_id() AND e.erased_club_id = club
       AND e.erased_player_id = target.id;
  END IF;

  UPDATE "public"."data_subject_request" r
     SET status = 'completed', resolved_at = now(), resolved_by = actor, erased_rows = counts,
         updated_by = actor
   WHERE r.club_id = club AND r.id = req.id;
  RETURN counts;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."erase_player"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."erase_player"(uuid) TO "sport_performance_app";

--> statement-breakpoint

-- ─── Deletes of clinical rows are audited too ────────────────────────────────────────
-- ADR 0029 left no DELETE on the medical schema; the erasure of a player (ADR 0051) is the
-- one, run by the owner. Each deleted row leaves its `delete` line in `medical.access_log`
-- (who, with which role, which record; no values), like inserts and updates.
CREATE OR REPLACE FUNCTION "medical"."log_write"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  request text := "app"."current_request_id"();
  changed text[];
  written record;
BEGIN
  IF request IS NULL AND NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) THEN
    RAISE EXCEPTION 'Medical data is written only within a request (app.request_id is not set)'
      USING ERRCODE = 'insufficient_privilege', TABLE = TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    written := OLD;
  ELSE
    written := NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}') INTO changed
      FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
     WHERE n.value IS DISTINCT FROM o.value AND n.key NOT IN ('updated_at');
  END IF;
  INSERT INTO "medical"."access_log"
    ("club_id", "actor_user_id", "actor_role", "db_role", "action", "resource", "player_id",
     "record_ids", "changed_columns", "request_id")
  VALUES (written.club_id, "app"."current_user_id"(), "app"."current_role"(), session_user,
          lower(TG_OP)::"medical"."access_action", TG_TABLE_NAME, written.player_id,
          ARRAY[written.id], changed, request);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  tr record;
BEGIN
  FOR tr IN
    SELECT t.tgname, t.tgrelid::regclass AS target FROM pg_catalog.pg_trigger t
     WHERE NOT t.tgisinternal AND t.tgfoid = '"medical"."log_write"()'::regprocedure
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', tr.tgname, tr.target);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION "medical"."log_write"()',
                   tr.tgname, tr.target);
  END LOOP;
END
$$;
--> statement-breakpoint
-- Same shape as in 0007, with the delete logged: a clinical table added later is audited the same.
CREATE OR REPLACE FUNCTION "app_admin"."secure_medical_table"(target regclass, needs_consent boolean, updatable boolean)
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
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION "medical"."log_write"()',
                 t || '_log_write', target);
END;
$$;
--> statement-breakpoint

-- ─── A set belongs to its program's player ───────────────────────────────────────────
-- A program is for a category, a stage or one player. A set logged against a player's
-- program is that player's: otherwise another player's set would point at the program and
-- block its player's erasure (it is not part of them). A category program takes any set.
CREATE FUNCTION "public"."gym_set_program_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'gym_set' THEN
    IF NEW.gym_program_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM "public"."gym_program" g
          WHERE g.club_id = NEW.club_id AND g.id = NEW.gym_program_id
            AND g.player_id IS NOT NULL AND g.player_id <> NEW.player_id) THEN
      RAISE EXCEPTION 'A set logged against a player''s program is that player''s'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'gym_set_program_player', TABLE = 'gym_set';
    END IF;
  ELSIF NEW.player_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM "public"."gym_set" s
          WHERE s.club_id = NEW.club_id AND s.gym_program_id = NEW.id
            AND s.player_id <> NEW.player_id) THEN
    RAISE EXCEPTION 'A program with sets of other players cannot become a player''s'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gym_set_program_player', TABLE = 'gym_program';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."gym_set_program_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "gym_set_program_guard" BEFORE INSERT OR UPDATE OF "player_id", "gym_program_id" ON "public"."gym_set"
  FOR EACH ROW EXECUTE FUNCTION "public"."gym_set_program_guard"();
--> statement-breakpoint
CREATE TRIGGER "gym_program_player_guard" BEFORE UPDATE OF "player_id" ON "public"."gym_program"
  FOR EACH ROW EXECUTE FUNCTION "public"."gym_set_program_guard"();
