CREATE TYPE "medical"."menstrual_flow" AS ENUM('none', 'spotting', 'light', 'moderate', 'heavy');--> statement-breakpoint
CREATE TYPE "medical"."menstrual_symptom" AS ENUM('cramps', 'lower_back_pain', 'headache', 'bloating', 'breast_tenderness', 'fatigue', 'mood_changes', 'sleep_disturbance', 'nausea', 'gastrointestinal');--> statement-breakpoint
ALTER TYPE "public"."consent_type" ADD VALUE 'menstrual_cycle';--> statement-breakpoint
ALTER TYPE "public"."sync_operation" ADD VALUE 'menstrual_cycle.log';--> statement-breakpoint
CREATE TABLE "medical"."menstrual_cycle_enrollment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	CONSTRAINT "menstrual_cycle_enrollment_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "menstrual_cycle_enrollment_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "menstrual_cycle_enrollment_ended" CHECK ("medical"."menstrual_cycle_enrollment"."ended_by" is null or "medical"."menstrual_cycle_enrollment"."ended_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "medical"."menstrual_cycle_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"flow" "medical"."menstrual_flow" NOT NULL,
	"symptoms" "medical"."menstrual_symptom"[] DEFAULT '{}' NOT NULL,
	"note" text,
	CONSTRAINT "menstrual_cycle_log_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "menstrual_cycle_log_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "menstrual_cycle_log_note" CHECK ("medical"."menstrual_cycle_log"."note" is null or (btrim("medical"."menstrual_cycle_log"."note") <> '' and char_length("medical"."menstrual_cycle_log"."note") <= 280)),
	CONSTRAINT "menstrual_cycle_log_symptoms" CHECK (cardinality("medical"."menstrual_cycle_log"."symptoms") <= 10 and array_position("medical"."menstrual_cycle_log"."symptoms", null) is null)
);
--> statement-breakpoint
CREATE TABLE "medical"."menstrual_cycle_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"viewer_membership_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "menstrual_cycle_share_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "menstrual_cycle_share_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "menstrual_cycle_share_revoked" CHECK ("medical"."menstrual_cycle_share"."revoked_by" is null or "medical"."menstrual_cycle_share"."revoked_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_enrollment" ADD CONSTRAINT "menstrual_cycle_enrollment_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_enrollment" ADD CONSTRAINT "menstrual_cycle_enrollment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_enrollment" ADD CONSTRAINT "menstrual_cycle_enrollment_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_enrollment" ADD CONSTRAINT "menstrual_cycle_enrollment_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_enrollment" ADD CONSTRAINT "menstrual_cycle_enrollment_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_log" ADD CONSTRAINT "menstrual_cycle_log_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_log" ADD CONSTRAINT "menstrual_cycle_log_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_log" ADD CONSTRAINT "menstrual_cycle_log_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_log" ADD CONSTRAINT "menstrual_cycle_log_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_share" ADD CONSTRAINT "menstrual_cycle_share_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_share" ADD CONSTRAINT "menstrual_cycle_share_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_share" ADD CONSTRAINT "menstrual_cycle_share_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_share" ADD CONSTRAINT "menstrual_cycle_share_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_share" ADD CONSTRAINT "menstrual_cycle_share_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_share" ADD CONSTRAINT "menstrual_cycle_share_viewer_membership_id_fkey" FOREIGN KEY ("club_id","viewer_membership_id") REFERENCES "public"."membership"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "menstrual_cycle_enrollment_active_key" ON "medical"."menstrual_cycle_enrollment" USING btree ("club_id","player_id") WHERE "medical"."menstrual_cycle_enrollment"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "menstrual_cycle_enrollment_player_idx" ON "medical"."menstrual_cycle_enrollment" USING btree ("club_id","player_id","created_at");--> statement-breakpoint
CREATE INDEX "menstrual_cycle_log_player_idx" ON "medical"."menstrual_cycle_log" USING btree ("club_id","player_id","local_date","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "menstrual_cycle_share_active_key" ON "medical"."menstrual_cycle_share" USING btree ("club_id","player_id","viewer_membership_id") WHERE "medical"."menstrual_cycle_share"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "menstrual_cycle_share_viewer_idx" ON "medical"."menstrual_cycle_share" USING btree ("club_id","viewer_membership_id");
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════
-- Hand-written part (B-806, ADR 0087): menstrual cycle tracking, health data in the
-- `medical` schema with the rules of ADR 0029 and three keys at once:
--
--   * the club's module `menstrual_cycle` (club.settings.modules, off by default);
--   * the consents `data`, `health` and `menstrual_cycle`, current (a guardian signs while
--     the player is a minor, the player once of age: `app.current_consent_types`);
--   * the player's own opt-in (`menstrual_cycle_enrollment`), only for a female player.
--
-- Only the player writes (opt-in and opt-out, her days, whom she authorizes) and she reads
-- all of it. Beyond her, only the members she authorizes one by one, among the `medical`
-- and `sc` memberships assigned to her, read her days, and only while every key holds.
-- Never the coach, the administration, the superadmin, the worker or the guardian.
-- The connection roles read no clinical column; every read goes through a function that
-- logs it, and every write is logged by `medical.log_write` (column names, never values).
--
-- The new enum value `menstrual_cycle` of `consent_type` cannot be used in this
-- transaction: the functions compare the consents as text.
DO $$
BEGIN
  IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
    RAISE EXCEPTION 'Migrations must run as a superuser or a role with BYPASSRLS (connected as %)', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
--> statement-breakpoint

-- ─── Keys ────────────────────────────────────────────────────────────────────────────
-- The club's module (the domain's default is off: a club that never stored it has it off).
CREATE FUNCTION "medical"."menstrual_cycle_module_on"() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT c.settings -> 'modules' -> 'menstrual_cycle' = 'true'::jsonb
                     FROM "public"."club" c WHERE c.id = "app"."current_club_id"()), false)
$$;
--> statement-breakpoint

-- The three consents of the module, current (MENSTRUAL_CYCLE_CONSENTS of the domain).
CREATE FUNCTION "medical"."has_menstrual_cycle_consents"(player uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT ARRAY['data', 'health', 'menstrual_cycle']::text[] <@ "app"."current_consent_types"(player)::text[]
$$;
--> statement-breakpoint

-- The player has the tracking on.
CREATE FUNCTION "medical"."is_tracking_menstrual_cycle"(player uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "medical"."menstrual_cycle_enrollment" e
                  WHERE e.club_id = "app"."current_club_id"() AND e.player_id = player
                    AND e.ended_at IS NULL)
$$;
--> statement-breakpoint

-- The context is the player herself (validated role `player`, her own player).
CREATE FUNCTION "medical"."is_menstrual_cycle_holder"(player uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce("app"."current_role"() = 'player', false)
     AND player = ANY ("app"."visible_player_ids"())
$$;
--> statement-breakpoint

-- She may turn the tracking on (matrix: menstrual_cycle.enroll = self+data+health+menstrual_cycle):
-- her own, a female player, the module on and the three consents. With `tracking`, she
-- also has it on: what logging a day and authorizing a member need.
CREATE FUNCTION "medical"."may_track_menstrual_cycle"(player uuid, tracking boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT "medical"."is_menstrual_cycle_holder"(player)
     AND EXISTS (SELECT 1 FROM "public"."player" p
                  WHERE p.club_id = "app"."current_club_id"() AND p.id = player AND p.sex = 'female')
     AND "medical"."menstrual_cycle_module_on"()
     AND "medical"."has_menstrual_cycle_consents"(player)
     AND (NOT tracking OR "medical"."is_tracking_menstrual_cycle"(player))
$$;
--> statement-breakpoint

-- The memberships a player may authorize: current `medical` and `sc` memberships of the
-- club with a current staff assignment that covers her (by category or by sport), on the
-- club's day (MENSTRUAL_CYCLE_VIEWER_ROLES of the domain). The same rule as
-- `app.visible_player_ids` for those roles, seen from the player's side.
CREATE FUNCTION "medical"."menstrual_cycle_viewer_memberships"(player uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  WITH ctx AS (SELECT "app"."current_club_id"() AS club_id, "app"."club_today"() AS today)
  SELECT coalesce(array_agg(DISTINCT m.id), '{}')
    FROM ctx
    JOIN "public"."membership" m
      ON m.club_id = ctx.club_id AND m.role::text IN ('medical', 'sc')
     AND m.started_at <= now() AND (m.ended_at IS NULL OR m.ended_at > now())
    JOIN "public"."staff_assignment" sa
      ON sa.club_id = m.club_id AND sa.membership_id = m.id
     AND sa.valid_from <= ctx.today AND (sa.valid_to IS NULL OR sa.valid_to > ctx.today)
    JOIN "public"."player_category" pc
      ON pc.club_id = m.club_id AND pc.player_id = player
     AND pc.valid_from <= ctx.today AND (pc.valid_to IS NULL OR pc.valid_to > ctx.today)
    JOIN "public"."category" c ON c.club_id = pc.club_id AND c.id = pc.category_id
   WHERE sa.category_id = pc.category_id OR sa.sport = c.sport
$$;
--> statement-breakpoint

-- The membership of the context (the validated role's current membership), or NULL.
CREATE FUNCTION "medical"."current_membership_id"() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id FROM "public"."membership" m
   WHERE m.club_id = "app"."current_club_id"() AND m.user_id = "app"."current_user_id"()
     AND m.role::text = "app"."current_role"()
     AND m.started_at <= now() AND (m.ended_at IS NULL OR m.ended_at > now())
   ORDER BY m.started_at DESC
   LIMIT 1
$$;
--> statement-breakpoint

-- Players whose cycle the context may read, among `requested` (NULL: all it may):
--   player         herself, always (the holder's access, even with the tracking off);
--   medical, sc    the assigned players that authorized this very membership, while the
--                  module is on, she has the tracking on and the three consents hold.
-- Raises for any other role (the API's matrix denies first; reaching this is a bug) and
-- without a validated context or a request id.
CREATE FUNCTION "medical"."menstrual_cycle_readable_players"(requested uuid[]) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  club uuid := "app"."current_club_id"();
  ctx_role text := "app"."current_role"();
  viewer uuid;
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
  IF ctx_role = 'player' THEN
    SELECT array_agg(v) INTO scope FROM unnest("app"."visible_player_ids"()) v
     WHERE requested IS NULL OR v = ANY (requested);
  ELSIF ctx_role IN ('medical', 'sc') THEN
    viewer := "medical"."current_membership_id"();
    IF "medical"."menstrual_cycle_module_on"() AND viewer IS NOT NULL THEN
      SELECT array_agg(v) INTO scope FROM unnest("app"."visible_player_ids"()) v
       WHERE (requested IS NULL OR v = ANY (requested))
         AND "medical"."is_tracking_menstrual_cycle"(v)
         AND "medical"."has_menstrual_cycle_consents"(v)
         AND EXISTS (SELECT 1 FROM "medical"."menstrual_cycle_share" s
                      WHERE s.club_id = club AND s.player_id = v
                        AND s.viewer_membership_id = viewer AND s.revoked_at IS NULL);
    END IF;
  ELSE
    RAISE EXCEPTION 'The % role cannot read the menstrual cycle', ctx_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN coalesce(scope, '{}');
END;
$$;
--> statement-breakpoint

-- Only the holder herself (the player) reads her opt-ins and authorizations.
CREATE FUNCTION "medical"."menstrual_cycle_holder_scope"(requested uuid[]) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF "app"."current_club_id"() IS NULL OR "app"."current_role"() IS NULL THEN
    RAISE EXCEPTION 'Medical data needs a validated tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF "app"."current_request_id"() IS NULL THEN
    RAISE EXCEPTION 'Medical data is read only within a request (app.request_id is not set)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF "app"."current_role"() <> 'player' THEN
    RAISE EXCEPTION 'Only the player reads her menstrual cycle settings'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN coalesce((SELECT array_agg(v) FROM unnest("app"."visible_player_ids"()) v
                    WHERE requested IS NULL OR v = ANY (requested)), '{}');
END;
$$;
--> statement-breakpoint

-- ─── Guards ──────────────────────────────────────────────────────────────────────────
-- An opt-in only ends: once, by the player who ends it, at that time (`now()`). The author
-- becomes NULL when the account is deleted (ADR 0051), never another user.
CREATE FUNCTION "medical"."menstrual_cycle_enrollment_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.player_id, NEW.client_uuid, NEW.created_at) IS DISTINCT FROM (OLD.player_id, OLD.client_uuid, OLD.created_at)
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL) THEN
    RAISE EXCEPTION 'An opt-in only ends'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'menstrual_cycle_enrollment_append_only',
            TABLE = 'menstrual_cycle_enrollment';
  END IF;
  IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
    RAISE EXCEPTION 'An opt-in ends once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'menstrual_cycle_enrollment_ended_final',
            TABLE = 'menstrual_cycle_enrollment';
  END IF;
  IF NEW.ended_by IS DISTINCT FROM OLD.ended_by AND NEW.ended_by IS NOT NULL
     AND NOT "medical"."acting_user_is"(NEW.ended_by) THEN
    RAISE EXCEPTION 'An opt-in is ended by the user who ends it'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'menstrual_cycle_enrollment_ended_signer',
            TABLE = 'menstrual_cycle_enrollment';
  END IF;
  IF NEW.ended_at IS NOT NULL AND OLD.ended_at IS NULL AND NEW.ended_at <> now()
     AND NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) THEN
    RAISE EXCEPTION 'An opt-in ends at the time it is ended'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'menstrual_cycle_enrollment_ended_now',
            TABLE = 'menstrual_cycle_enrollment';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Ending the tracking revokes every authorization of the player: turning it on again starts
-- with nobody authorized. Runs as the owner, signed by who ended it.
CREATE FUNCTION "medical"."menstrual_cycle_enrollment_ended"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL THEN
    UPDATE "medical"."menstrual_cycle_share" s
       SET revoked_at = NEW.ended_at, revoked_by = NEW.ended_by, updated_by = NEW.ended_by
     WHERE s.club_id = NEW.club_id AND s.player_id = NEW.player_id AND s.revoked_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- A day lists each symptom once.
CREATE FUNCTION "medical"."menstrual_cycle_log_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF cardinality(NEW.symptoms) <> (SELECT count(DISTINCT s) FROM unnest(NEW.symptoms) s) THEN
    RAISE EXCEPTION 'Each symptom once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'menstrual_cycle_log_symptoms_distinct',
            TABLE = 'menstrual_cycle_log';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- An authorization goes to a membership the player may authorize, at most 10 at once
-- (MENSTRUAL_CYCLE_VIEWERS_MAX of the domain; the player's rows are locked so concurrent
-- inserts count each other). It only gets revoked: once, by who revokes it, at that time.
CREATE FUNCTION "medical"."menstrual_cycle_share_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.viewer_membership_id = ANY ("medical"."menstrual_cycle_viewer_memberships"(NEW.player_id)) THEN
      RAISE EXCEPTION 'Only an assigned medical or S&C member is authorized'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'menstrual_cycle_share_viewer',
              TABLE = 'menstrual_cycle_share';
    END IF;
    PERFORM 1 FROM "public"."player" p WHERE p.club_id = NEW.club_id AND p.id = NEW.player_id FOR UPDATE;
    IF (SELECT count(*) FROM "medical"."menstrual_cycle_share" s
         WHERE s.club_id = NEW.club_id AND s.player_id = NEW.player_id AND s.revoked_at IS NULL) >= 10 THEN
      RAISE EXCEPTION 'At most 10 members are authorized at once'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'menstrual_cycle_share_max',
              TABLE = 'menstrual_cycle_share';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.player_id, NEW.viewer_membership_id, NEW.client_uuid, NEW.created_at)
     IS DISTINCT FROM (OLD.player_id, OLD.viewer_membership_id, OLD.client_uuid, OLD.created_at)
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL) THEN
    RAISE EXCEPTION 'An authorization only gets revoked'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'menstrual_cycle_share_append_only',
            TABLE = 'menstrual_cycle_share';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'An authorization is revoked once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'menstrual_cycle_share_revoked_final',
            TABLE = 'menstrual_cycle_share';
  END IF;
  IF NEW.revoked_by IS DISTINCT FROM OLD.revoked_by AND NEW.revoked_by IS NOT NULL
     AND NOT "medical"."acting_user_is"(NEW.revoked_by) THEN
    RAISE EXCEPTION 'An authorization is revoked by the user who revokes it'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'menstrual_cycle_share_revoked_signer',
            TABLE = 'menstrual_cycle_share';
  END IF;
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL AND NEW.revoked_at <> now()
     AND NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) THEN
    RAISE EXCEPTION 'An authorization is revoked at the time it is revoked'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'menstrual_cycle_share_revoked_now',
            TABLE = 'menstrual_cycle_share';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "menstrual_cycle_enrollment_guard" BEFORE UPDATE ON "medical"."menstrual_cycle_enrollment"
  FOR EACH ROW EXECUTE FUNCTION "medical"."menstrual_cycle_enrollment_guard"();
--> statement-breakpoint
CREATE TRIGGER "menstrual_cycle_enrollment_ended" AFTER UPDATE ON "medical"."menstrual_cycle_enrollment"
  FOR EACH ROW EXECUTE FUNCTION "medical"."menstrual_cycle_enrollment_ended"();
--> statement-breakpoint
CREATE TRIGGER "menstrual_cycle_log_guard" BEFORE INSERT ON "medical"."menstrual_cycle_log"
  FOR EACH ROW EXECUTE FUNCTION "medical"."menstrual_cycle_log_guard"();
--> statement-breakpoint
CREATE TRIGGER "menstrual_cycle_share_guard" BEFORE INSERT OR UPDATE ON "medical"."menstrual_cycle_share"
  FOR EACH ROW EXECUTE FUNCTION "medical"."menstrual_cycle_share_guard"();
--> statement-breakpoint

-- ─── RLS, grants and the write log ───────────────────────────────────────────────────
ALTER TABLE "medical"."menstrual_cycle_enrollment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_enrollment" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_share" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "medical"."menstrual_cycle_share" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "menstrual_cycle_enrollment_app_club" ON "medical"."menstrual_cycle_enrollment" AS RESTRICTIVE FOR ALL TO "sport_performance_app"
  USING (club_id = (SELECT "app"."current_club_id"())) WITH CHECK (club_id = (SELECT "app"."current_club_id"()));
--> statement-breakpoint
CREATE POLICY "menstrual_cycle_log_app_club" ON "medical"."menstrual_cycle_log" AS RESTRICTIVE FOR ALL TO "sport_performance_app"
  USING (club_id = (SELECT "app"."current_club_id"())) WITH CHECK (club_id = (SELECT "app"."current_club_id"()));
--> statement-breakpoint
CREATE POLICY "menstrual_cycle_share_app_club" ON "medical"."menstrual_cycle_share" AS RESTRICTIVE FOR ALL TO "sport_performance_app"
  USING (club_id = (SELECT "app"."current_club_id"())) WITH CHECK (club_id = (SELECT "app"."current_club_id"()));
--> statement-breakpoint
-- The player turns it on for herself, as its author; and off (found by id only).
CREATE POLICY "menstrual_cycle_enrollment_app_insert" ON "medical"."menstrual_cycle_enrollment" FOR INSERT TO "sport_performance_app"
  WITH CHECK ("medical"."may_track_menstrual_cycle"(player_id, false)
              AND created_by = "app"."current_user_id"() AND updated_by = created_by);
--> statement-breakpoint
CREATE POLICY "menstrual_cycle_enrollment_app_select" ON "medical"."menstrual_cycle_enrollment" FOR SELECT TO "sport_performance_app"
  USING ("medical"."is_menstrual_cycle_holder"(player_id));
--> statement-breakpoint
CREATE POLICY "menstrual_cycle_enrollment_app_update" ON "medical"."menstrual_cycle_enrollment" FOR UPDATE TO "sport_performance_app"
  USING ("medical"."is_menstrual_cycle_holder"(player_id))
  WITH CHECK ("medical"."is_menstrual_cycle_holder"(player_id) AND updated_by = "app"."current_user_id"());
--> statement-breakpoint
-- She logs her days while she has it on, as their author.
CREATE POLICY "menstrual_cycle_log_app_insert" ON "medical"."menstrual_cycle_log" FOR INSERT TO "sport_performance_app"
  WITH CHECK ("medical"."may_track_menstrual_cycle"(player_id, true)
              AND created_by = "app"."current_user_id"() AND updated_by = created_by);
--> statement-breakpoint
-- She authorizes members while she has it on, and revokes them at any time.
CREATE POLICY "menstrual_cycle_share_app_insert" ON "medical"."menstrual_cycle_share" FOR INSERT TO "sport_performance_app"
  WITH CHECK ("medical"."may_track_menstrual_cycle"(player_id, true)
              AND created_by = "app"."current_user_id"() AND updated_by = created_by);
--> statement-breakpoint
CREATE POLICY "menstrual_cycle_share_app_select" ON "medical"."menstrual_cycle_share" FOR SELECT TO "sport_performance_app"
  USING ("medical"."is_menstrual_cycle_holder"(player_id));
--> statement-breakpoint
CREATE POLICY "menstrual_cycle_share_app_update" ON "medical"."menstrual_cycle_share" FOR UPDATE TO "sport_performance_app"
  USING ("medical"."is_menstrual_cycle_holder"(player_id))
  WITH CHECK ("medical"."is_menstrual_cycle_holder"(player_id) AND updated_by = "app"."current_user_id"());
--> statement-breakpoint
GRANT SELECT ("id"),
  INSERT ("id", "club_id", "client_uuid", "player_id", "created_by", "updated_by"),
  UPDATE ("ended_at", "ended_by", "updated_by")
  ON "medical"."menstrual_cycle_enrollment" TO "sport_performance_app";
--> statement-breakpoint
GRANT INSERT ("id", "club_id", "client_uuid", "player_id", "local_date", "flow", "symptoms", "note", "created_by", "updated_by")
  ON "medical"."menstrual_cycle_log" TO "sport_performance_app";
--> statement-breakpoint
GRANT SELECT ("id"),
  INSERT ("id", "club_id", "client_uuid", "player_id", "viewer_membership_id", "created_by", "updated_by"),
  UPDATE ("revoked_at", "revoked_by", "updated_by")
  ON "medical"."menstrual_cycle_share" TO "sport_performance_app";
--> statement-breakpoint
CREATE TRIGGER "menstrual_cycle_enrollment_set_updated_at" BEFORE UPDATE ON "medical"."menstrual_cycle_enrollment"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "menstrual_cycle_log_set_updated_at" BEFORE UPDATE ON "medical"."menstrual_cycle_log"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "menstrual_cycle_share_set_updated_at" BEFORE UPDATE ON "medical"."menstrual_cycle_share"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "menstrual_cycle_enrollment_log_write" AFTER INSERT OR UPDATE OR DELETE ON "medical"."menstrual_cycle_enrollment"
  FOR EACH ROW EXECUTE FUNCTION "medical"."log_write"();
--> statement-breakpoint
CREATE TRIGGER "menstrual_cycle_log_log_write" AFTER INSERT OR UPDATE OR DELETE ON "medical"."menstrual_cycle_log"
  FOR EACH ROW EXECUTE FUNCTION "medical"."log_write"();
--> statement-breakpoint
CREATE TRIGGER "menstrual_cycle_share_log_write" AFTER INSERT OR UPDATE OR DELETE ON "medical"."menstrual_cycle_share"
  FOR EACH ROW EXECUTE FUNCTION "medical"."log_write"();
--> statement-breakpoint

-- ─── Logged reads ────────────────────────────────────────────────────────────────────
-- Days of the cycle the context may read (`player_ids` NULL: all of them) with `local_date`
-- in [from_date, to_date] (each optional), only the entries created with `client_uuids` (a
-- replay of the offline queue) or with the ids `log_ids` when given; every entry, not only
-- the latest of each day (the API keeps the latest). By day and creation. Logs a `read`
-- row per player read and asked for.
CREATE TYPE "medical"."menstrual_cycle_log_entry" AS (
  "id" uuid,
  "client_uuid" uuid,
  "player_id" uuid,
  "local_date" date,
  "flow" text,
  "symptoms" text[],
  "note" text,
  "created_at" timestamp with time zone
);
--> statement-breakpoint
CREATE FUNCTION "medical"."read_menstrual_cycle_logs"(
  player_ids uuid[] DEFAULT NULL,
  from_date date DEFAULT NULL,
  to_date date DEFAULT NULL,
  client_uuids uuid[] DEFAULT NULL,
  log_ids uuid[] DEFAULT NULL
) RETURNS SETOF "medical"."menstrual_cycle_log_entry"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope uuid[] := "medical"."menstrual_cycle_readable_players"(player_ids);
  club constant uuid := "app"."current_club_id"();
  result "medical"."menstrual_cycle_log_entry"[];
BEGIN
  SELECT coalesce(array_agg(ROW(l.id, l.client_uuid, l.player_id, l.local_date, l.flow::text,
                                l.symptoms::text[], l.note, l.created_at)::"medical"."menstrual_cycle_log_entry"
                            ORDER BY l.player_id, l.local_date, l.created_at, l.id), '{}')
    INTO result
    FROM "medical"."menstrual_cycle_log" l
   WHERE l.club_id = club AND l.player_id = ANY (scope)
     AND (from_date IS NULL OR l.local_date >= from_date)
     AND (to_date IS NULL OR l.local_date <= to_date)
     AND (client_uuids IS NULL OR l.client_uuid = ANY (client_uuids))
     AND (log_ids IS NULL OR l.id = ANY (log_ids));
  PERFORM "medical"."log_read"('menstrual_cycle_log', player_ids,
    ARRAY(SELECT r.player_id FROM unnest(result) r), ARRAY(SELECT r.id FROM unnest(result) r));
  RETURN QUERY SELECT * FROM unnest(result);
END;
$$;
--> statement-breakpoint

-- The player's opt-ins (current and past), newest first. Only the player herself.
CREATE TYPE "medical"."menstrual_cycle_enrollment_entry" AS (
  "id" uuid,
  "client_uuid" uuid,
  "player_id" uuid,
  "created_at" timestamp with time zone,
  "ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE FUNCTION "medical"."read_menstrual_cycle_enrollments"(player_ids uuid[] DEFAULT NULL)
RETURNS SETOF "medical"."menstrual_cycle_enrollment_entry"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope uuid[] := "medical"."menstrual_cycle_holder_scope"(player_ids);
  result "medical"."menstrual_cycle_enrollment_entry"[];
BEGIN
  SELECT coalesce(array_agg(ROW(e.id, e.client_uuid, e.player_id, e.created_at, e.ended_at)::"medical"."menstrual_cycle_enrollment_entry"
                            ORDER BY e.created_at DESC, e.id DESC), '{}')
    INTO result
    FROM "medical"."menstrual_cycle_enrollment" e
   WHERE e.club_id = "app"."current_club_id"() AND e.player_id = ANY (scope);
  PERFORM "medical"."log_read"('menstrual_cycle_enrollment', player_ids,
    ARRAY(SELECT r.player_id FROM unnest(result) r), ARRAY(SELECT r.id FROM unnest(result) r));
  RETURN QUERY SELECT * FROM unnest(result);
END;
$$;
--> statement-breakpoint

-- The player's current authorizations (or every one, with `include_revoked`), with whom:
-- the membership, its role and the member's name. Only the player herself.
CREATE TYPE "medical"."menstrual_cycle_share_entry" AS (
  "id" uuid,
  "client_uuid" uuid,
  "player_id" uuid,
  "viewer_membership_id" uuid,
  "viewer_role" text,
  "viewer_name" text,
  "created_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE FUNCTION "medical"."read_menstrual_cycle_shares"(
  player_ids uuid[] DEFAULT NULL,
  include_revoked boolean DEFAULT false,
  share_ids uuid[] DEFAULT NULL,
  client_uuids uuid[] DEFAULT NULL
) RETURNS SETOF "medical"."menstrual_cycle_share_entry"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope uuid[] := "medical"."menstrual_cycle_holder_scope"(player_ids);
  result "medical"."menstrual_cycle_share_entry"[];
BEGIN
  SELECT coalesce(array_agg(ROW(s.id, s.client_uuid, s.player_id, s.viewer_membership_id, m.role::text,
                                u.name, s.created_at, s.revoked_at)::"medical"."menstrual_cycle_share_entry"
                            ORDER BY s.created_at DESC, s.id DESC), '{}')
    INTO result
    FROM "medical"."menstrual_cycle_share" s
    JOIN "public"."membership" m ON m.club_id = s.club_id AND m.id = s.viewer_membership_id
    JOIN "public"."user" u ON u.id = m.user_id
   WHERE s.club_id = "app"."current_club_id"() AND s.player_id = ANY (scope)
     AND (coalesce(include_revoked, false) OR s.revoked_at IS NULL)
     AND (share_ids IS NULL OR s.id = ANY (share_ids))
     AND (client_uuids IS NULL OR s.client_uuid = ANY (client_uuids));
  PERFORM "medical"."log_read"('menstrual_cycle_share', player_ids,
    ARRAY(SELECT r.player_id FROM unnest(result) r), ARRAY(SELECT r.id FROM unnest(result) r));
  RETURN QUERY SELECT * FROM unnest(result);
END;
$$;
--> statement-breakpoint

-- The members the player may authorize now (assigned `medical` and `sc`), with their names.
-- Only the player herself; no clinical data, but it is about her, so it goes in the log.
CREATE TYPE "medical"."menstrual_cycle_viewer_candidate" AS (
  "membership_id" uuid,
  "role" text,
  "name" text
);
--> statement-breakpoint
CREATE FUNCTION "medical"."menstrual_cycle_viewer_candidates"(player uuid)
RETURNS SETOF "medical"."menstrual_cycle_viewer_candidate"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope uuid[] := "medical"."menstrual_cycle_holder_scope"(ARRAY[player]);
BEGIN
  PERFORM "medical"."log_read"('menstrual_cycle_viewer', ARRAY[player], '{}', '{}');
  IF NOT player = ANY (scope) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT m.id, m.role::text, u.name
      FROM "public"."membership" m JOIN "public"."user" u ON u.id = m.user_id
     WHERE m.club_id = "app"."current_club_id"()
       AND m.id = ANY ("medical"."menstrual_cycle_viewer_memberships"(player))
     ORDER BY u.name, m.id;
END;
$$;
--> statement-breakpoint

-- The players that authorized the context's membership and that it may read now (every key
-- holds), with since when: what an authorized member lists. Logs a `read` per player.
CREATE TYPE "medical"."menstrual_cycle_shared_player" AS (
  "player_id" uuid,
  "share_id" uuid,
  "shared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE FUNCTION "medical"."menstrual_cycle_shared_with_me"()
RETURNS SETOF "medical"."menstrual_cycle_shared_player"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ctx_role text := "app"."current_role"();
  result "medical"."menstrual_cycle_shared_player"[];
  scope uuid[];
BEGIN
  IF ctx_role IS NULL OR ctx_role NOT IN ('medical', 'sc') THEN
    RAISE EXCEPTION 'Only the medical and S&C staff are authorized to read a menstrual cycle'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  scope := "medical"."menstrual_cycle_readable_players"(NULL);
  SELECT coalesce(array_agg(ROW(s.player_id, s.id, s.created_at)::"medical"."menstrual_cycle_shared_player"
                            ORDER BY s.created_at, s.player_id), '{}')
    INTO result
    FROM "medical"."menstrual_cycle_share" s
   WHERE s.club_id = "app"."current_club_id"() AND s.player_id = ANY (scope)
     AND s.viewer_membership_id = "medical"."current_membership_id"() AND s.revoked_at IS NULL;
  PERFORM "medical"."log_read"('menstrual_cycle_share', NULL,
    ARRAY(SELECT r.player_id FROM unnest(result) r), ARRAY(SELECT r.share_id FROM unnest(result) r));
  RETURN QUERY SELECT * FROM unnest(result);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  "medical"."menstrual_cycle_module_on"(),
  "medical"."has_menstrual_cycle_consents"(uuid),
  "medical"."is_tracking_menstrual_cycle"(uuid),
  "medical"."is_menstrual_cycle_holder"(uuid),
  "medical"."may_track_menstrual_cycle"(uuid, boolean),
  "medical"."menstrual_cycle_viewer_memberships"(uuid),
  "medical"."current_membership_id"(),
  "medical"."menstrual_cycle_readable_players"(uuid[]),
  "medical"."menstrual_cycle_holder_scope"(uuid[]),
  "medical"."menstrual_cycle_enrollment_guard"(),
  "medical"."menstrual_cycle_enrollment_ended"(),
  "medical"."menstrual_cycle_log_guard"(),
  "medical"."menstrual_cycle_share_guard"(),
  "medical"."read_menstrual_cycle_logs"(uuid[], date, date, uuid[], uuid[]),
  "medical"."read_menstrual_cycle_enrollments"(uuid[]),
  "medical"."read_menstrual_cycle_shares"(uuid[], boolean, uuid[], uuid[]),
  "medical"."menstrual_cycle_viewer_candidates"(uuid),
  "medical"."menstrual_cycle_shared_with_me"()
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  "medical"."is_menstrual_cycle_holder"(uuid),
  "medical"."may_track_menstrual_cycle"(uuid, boolean),
  "medical"."read_menstrual_cycle_logs"(uuid[], date, date, uuid[], uuid[]),
  "medical"."read_menstrual_cycle_enrollments"(uuid[]),
  "medical"."read_menstrual_cycle_shares"(uuid[], boolean, uuid[], uuid[]),
  "medical"."menstrual_cycle_viewer_candidates"(uuid),
  "medical"."menstrual_cycle_shared_with_me"()
  TO "sport_performance_app";
