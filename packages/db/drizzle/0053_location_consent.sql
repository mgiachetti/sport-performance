CREATE TYPE "public"."location_erasure_reason" AS ENUM('consent_revoked');--> statement-breakpoint
CREATE TYPE "public"."location_erasure_status" AS ENUM('pending', 'completed');--> statement-breakpoint
ALTER TYPE "public"."consent_type" ADD VALUE 'location';--> statement-breakpoint
ALTER TYPE "public"."change_tracked_table" ADD VALUE 'location_erasure';--> statement-breakpoint
CREATE TABLE "location_erasure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"reason" "location_erasure_reason" NOT NULL,
	"status" "location_erasure_status" NOT NULL,
	"requested_by" text,
	"completed_at" timestamp with time zone,
	"deleted_rows" jsonb,
	CONSTRAINT "location_erasure_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "location_erasure_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "location_erasure_completion" CHECK (("location_erasure"."status" = 'completed') = ("location_erasure"."completed_at" is not null)
          and ("location_erasure"."status" = 'completed') = ("location_erasure"."deleted_rows" is not null))
);
--> statement-breakpoint
ALTER TABLE "location_erasure" ADD CONSTRAINT "location_erasure_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_erasure" ADD CONSTRAINT "location_erasure_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_erasure" ADD CONSTRAINT "location_erasure_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_erasure" ADD CONSTRAINT "location_erasure_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_erasure" ADD CONSTRAINT "location_erasure_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_erasure_player_idx" ON "location_erasure" USING btree ("club_id","player_id","created_at");--> statement-breakpoint
CREATE INDEX "location_erasure_requested_by_idx" ON "location_erasure" USING btree ("requested_by");--> statement-breakpoint
CREATE UNIQUE INDEX "location_erasure_pending_key" ON "location_erasure" USING btree ("club_id","player_id") WHERE "location_erasure"."status" = 'pending';
--> statement-breakpoint

-- ─── Hand-written (B-913, ADR 0106): the location consent ───────────────────────────
-- A consent of its own for the position of the pod, like `menstrual_cycle` (ADR 0092). Two
-- differences with the rest:
--   * it counts only while granted: on the current text of the club and, once the player
--     is of age, signed by the adult. An older text (`outdated`) or only a guardian's
--     signature of an adult (`adult_signature_required`) does not count, unlike `data`;
--   * revoking it erases: the database queues a `location_erasure` in the transaction of
--     the revocation and the worker deletes the position traces and the `pod_raw` files,
--     leaving only how many rows it deleted. The traces never get change history triggers
--     (they would keep the deleted values); the summary row does.
--
-- The new enum value `location` of `consent_type` cannot be used in this transaction: the
-- functions and the trigger compare the type as text.

CREATE TRIGGER "location_erasure_set_updated_at" BEFORE UPDATE ON "location_erasure" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- ─── app.current_consent_types: location only while granted ──────────────────────────
-- Same as 0023 for every other type. A `location` consent counts only on the current text
-- of its type (the last published, ties by id, as the API's isCurrentDocument; a row
-- recorded before the texts by its version) and, once the player is of age, only the
-- adult's own signature. The domain's `currentConsentTypes` and `canCollectLocation` say
-- the same (GRANTED_ONLY_CONSENT_TYPES). The permission matrix reads its facts from here,
-- so a cell that requires `location` requires it granted.
CREATE OR REPLACE FUNCTION "app"."current_consent_types"(player uuid) RETURNS "public"."consent_type"[]
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT c.type ORDER BY c.type), '{}')
    FROM "public"."consent" c
    JOIN "public"."player" p ON p.club_id = c.club_id AND p.id = c.player_id
   WHERE c.club_id = "app"."current_club_id"() AND c.player_id = player
     AND c.revoked_at IS NULL AND c.signed_at <= now()
     AND NOT (c.signer_kind = 'guardian'
              AND p.birth_date <= (("app"."club_today"() - 30) - interval '18 years')::date)
     AND (c.type::text <> 'location' OR (
           (c.signer_kind = 'player' OR p.birth_date + interval '18 years' > "app"."club_today"())
           AND EXISTS (
             SELECT 1 FROM "public"."consent_document" d
              WHERE d.club_id = c.club_id AND d.type = c.type
                AND (d.id = c.document_id
                     OR (c.document_id IS NULL AND d.version = c.document_version))
                AND NOT EXISTS (
                  SELECT 1 FROM "public"."consent_document" newer
                   WHERE newer.club_id = d.club_id AND newer.type = d.type
                     AND (newer.published_at, newer.id) > (d.published_at, d.id)))))
     AND ("app"."sees_whole_club"() OR player = ANY ("app"."visible_player_ids"()))
$$;
--> statement-breakpoint

-- ─── RLS of the erasures ─────────────────────────────────────────────────────────────
-- The administration reads every erasure of the club, the holder (the player, the
-- guardian) those of their visible players. The application writes nothing: the trigger
-- below inserts and the worker, through `secure_club_table`, completes.
DO $$
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.location_erasure',
    format('%s OR (%s AND player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))',
           "app_admin"."role_in"('{admin,superadmin}'), "app_admin"."role_in"('{player,parent}')),
    '{}');
END
$$;
--> statement-breakpoint

-- The completion is the record of the erasure in the change history (ADR 0030): status,
-- time and counts are lifecycle columns written by the worker, never a correction.
CREATE TRIGGER "location_erasure_change_history" AFTER UPDATE OR DELETE ON "location_erasure" FOR EACH ROW EXECUTE FUNCTION "public"."change_history_record"('player_id', '{status,completed_at,deleted_rows}');--> statement-breakpoint

-- ─── Revoking queues the erasure ─────────────────────────────────────────────────────
-- In the transaction of the revocation, whoever revokes it (the API's handler, an operator):
-- one pending erasure per player (revoking again while one is pending adds nothing), and a
-- notification at commit (payload: the club) for the worker. The worker's sweep finds it
-- within a minute anyway: correctness depends on the table, not on the notification.
CREATE FUNCTION "public"."consent_location_erasure"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO "public"."location_erasure"
    (club_id, player_id, reason, status, requested_by, created_by, updated_by)
  VALUES
    (NEW.club_id, NEW.player_id, 'consent_revoked', 'pending', NEW.revoked_by, NEW.revoked_by,
     NEW.revoked_by)
  ON CONFLICT (club_id, player_id) WHERE status = 'pending' DO NOTHING;
  PERFORM pg_notify('sport_performance_location_erasure', NEW.club_id::text);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."consent_location_erasure"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "consent_location_erasure" AFTER UPDATE OF revoked_at ON "public"."consent"
  FOR EACH ROW
  WHEN (NEW.type::text = 'location' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION "public"."consent_location_erasure"();
--> statement-breakpoint

-- Clubs with a pending erasure, for the worker's sweep. Only ids, like app.worker_clubs().
-- Worker only.
CREATE FUNCTION "app"."worker_location_erasure_clubs"() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT DISTINCT e.club_id FROM "public"."location_erasure" e
   WHERE e.status = 'pending'
   ORDER BY e.club_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."worker_location_erasure_clubs"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."worker_location_erasure_clubs"() TO "sport_performance_worker";