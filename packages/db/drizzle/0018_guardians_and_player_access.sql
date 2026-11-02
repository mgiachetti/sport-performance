CREATE TABLE "player_access_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "player_access_code_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "player_access_code_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "player_access_code_code_hash_key" UNIQUE("code_hash"),
	CONSTRAINT "player_access_code_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "player_access_code_code_hash_format" CHECK ("player_access_code"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "player_access_code_token_hash_format" CHECK ("player_access_code"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "player_access_code_expiry" CHECK ("player_access_code"."expires_at" > "player_access_code"."created_at" and "player_access_code"."expires_at" <= "player_access_code"."created_at" + interval '1 hour'),
	CONSTRAINT "player_access_code_single_outcome" CHECK ("player_access_code"."consumed_at" is null or "player_access_code"."revoked_at" is null),
	CONSTRAINT "player_access_code_consumed_by" CHECK ("player_access_code"."consumed_by" is null or "player_access_code"."consumed_at" is not null),
	CONSTRAINT "player_access_code_revoked_by" CHECK ("player_access_code"."revoked_by" is null or "player_access_code"."revoked_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "guardian" DROP CONSTRAINT "guardian_validity";--> statement-breakpoint
DROP INDEX "invitation_pending_key";--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "player_id" uuid;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "guardian_relationship" "guardian_relationship";--> statement-breakpoint
ALTER TABLE "player_access_code" ADD CONSTRAINT "player_access_code_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_access_code" ADD CONSTRAINT "player_access_code_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_access_code" ADD CONSTRAINT "player_access_code_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_access_code" ADD CONSTRAINT "player_access_code_consumed_by_user_id_fk" FOREIGN KEY ("consumed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_access_code" ADD CONSTRAINT "player_access_code_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_access_code" ADD CONSTRAINT "player_access_code_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_access_code_open_key" ON "player_access_code" USING btree ("club_id","player_id") WHERE "player_access_code"."consumed_at" is null and "player_access_code"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "player_access_code_player_idx" ON "player_access_code" USING btree ("club_id","player_id","created_at");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_player_id_idx" ON "invitation" USING btree ("club_id","player_id") WHERE "invitation"."player_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_key" ON "invitation" USING btree ("club_id","email","role",coalesce("player_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "invitation"."accepted_at" is null and "invitation"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_validity" CHECK ("guardian"."valid_to" is null or "guardian"."valid_to" >= "guardian"."valid_from");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_player_role" CHECK ("invitation"."player_id" is null or "invitation"."role" in ('player', 'parent'));--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_guardian_relationship" CHECK (("invitation"."guardian_relationship" is not null) = ("invitation"."role" = 'parent' and "invitation"."player_id" is not null));--> statement-breakpoint
-- Hand-written (B-310, ADR 0042): `updated_at` trigger of the new club table (see 0001).
CREATE TRIGGER "player_access_code_set_updated_at" BEFORE UPDATE ON "player_access_code" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
-- RLS and grants (ADR 0026). Access codes are read and issued by the administration and by
-- the guardians of the player (`parent` with a current link: `app.visible_player_ids()`); the
-- player, the staff and everyone else never see them. No DELETE: a code ends used, revoked or
-- expired, and stays as the record of who gave access to the player's account.
DO $$
DECLARE
  issuers constant text := "app_admin"."role_in"('{parent,admin,superadmin}');
  player_scope constant text := '((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.player_access_code',
    format('%s AND %s', issuers, player_scope), '{parent,admin,superadmin}');
END
$$;
--> statement-breakpoint
-- Narrower than the standard grant: the API only revokes codes (the hashes, the player and
-- the expiry never change; redeeming goes through redeem_player_access).
REVOKE UPDATE ON "public"."player_access_code" FROM "sport_performance_app";
--> statement-breakpoint
GRANT UPDATE ("revoked_at", "revoked_by", "updated_at", "updated_by") ON "public"."player_access_code" TO "sport_performance_app";
--> statement-breakpoint

-- A guardian invites their child by email (B-310): besides the administration's policies
-- (0006), a `parent` reads, creates and revokes the `player` invitations of the players they
-- are a current guardian of, and creates them as themselves. They never see staff or parent
-- invitations, nor the category scopes.
CREATE POLICY "invitation_app_guardian_select" ON "public"."invitation" FOR SELECT TO "sport_performance_app"
  USING ((SELECT "app"."current_role"()) = 'parent' AND role = 'player'
         AND player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]));
--> statement-breakpoint
CREATE POLICY "invitation_app_guardian_insert" ON "public"."invitation" FOR INSERT TO "sport_performance_app"
  WITH CHECK ((SELECT "app"."current_role"()) = 'parent' AND role = 'player'
              AND player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[])
              AND created_by = (SELECT "app"."current_user_id"()));
--> statement-breakpoint
CREATE POLICY "invitation_app_guardian_update" ON "public"."invitation" FOR UPDATE TO "sport_performance_app"
  USING ((SELECT "app"."current_role"()) = 'parent' AND role = 'player'
         AND player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))
  WITH CHECK ((SELECT "app"."current_role"()) = 'parent' AND role = 'player'
              AND player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]));
--> statement-breakpoint

-- ─── Accepting an invitation about a player ──────────────────────────────────────────
-- Same contract as 0006 plus the player of the invitation (ADR 0042):
--   role `player`: the account becomes the player's own (`player.user_id`). Refused with
--     `player_taken` (nothing written) when the player already has another account, or the
--     user already is another player of the club (`player_club_id_user_id_key`).
--   role `parent`: also opens the `guardian` link with the invitation's relationship, from
--     the club's day, unless an open one exists.
--
--   role `parent` about a player: refused (`own_guardian`) when the caller is that
--     player's own account.
--
-- `outcome`: joined | not_found | accepted | revoked | expired | wrong_email | player_taken
--   | own_guardian.
CREATE OR REPLACE FUNCTION "app"."accept_invitation"(invitation_token_hash text)
RETURNS TABLE (outcome text, joined_membership_id uuid, membership_created boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  caller text := "app"."current_user_id"();
  caller_email text;
  inv record;
  owner_user text;
  active uuid;
  inserted boolean := false;
BEGIN
  IF caller IS NULL OR "app"."current_club_id"() IS NOT NULL THEN
    RAISE EXCEPTION 'accept_invitation runs with app.user_id and without app.club_id'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT u.email INTO caller_email FROM "public"."user" u WHERE u.id = caller;
  IF caller_email IS NULL THEN
    RAISE EXCEPTION 'accept_invitation: app.user_id is not a user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT i.id, i.club_id, i.email, i.role, i.expires_at, i.accepted_at, i.accepted_by,
         i.revoked_at, i.created_by, i.player_id, i.guardian_relationship, c.time_zone
    INTO inv
    FROM "public"."invitation" i
    JOIN "public"."club" c ON c.id = i.club_id
   WHERE i.token_hash = invitation_token_hash
     FOR UPDATE OF i;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, false;
    RETURN;
  END IF;
  IF inv.accepted_at IS NOT NULL THEN
    IF inv.accepted_by = caller THEN
      SELECT m.id INTO active
        FROM "public"."membership" m
       WHERE m.club_id = inv.club_id AND m.user_id = caller AND m.role = inv.role AND m.ended_at IS NULL;
      IF active IS NOT NULL THEN
        RETURN QUERY SELECT 'joined'::text, active, false;
        RETURN;
      END IF;
    END IF;
    RETURN QUERY SELECT 'accepted'::text, NULL::uuid, false;
    RETURN;
  END IF;
  IF inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revoked'::text, NULL::uuid, false;
    RETURN;
  END IF;
  IF inv.expires_at <= pg_catalog.now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::uuid, false;
    RETURN;
  END IF;
  IF inv.email <> pg_catalog.lower(caller_email) THEN
    RETURN QUERY SELECT 'wrong_email'::text, NULL::uuid, false;
    RETURN;
  END IF;

  IF inv.role = 'parent' AND inv.player_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM "public"."player" p
                  WHERE p.club_id = inv.club_id AND p.id = inv.player_id AND p.user_id = caller) THEN
    -- The player's own account cannot become their own guardian.
    RETURN QUERY SELECT 'own_guardian'::text, NULL::uuid, false;
    RETURN;
  END IF;

  IF inv.role = 'player' AND inv.player_id IS NOT NULL THEN
    -- The row lock serializes two invitations (or an access code) of the same player.
    SELECT p.user_id INTO owner_user
      FROM "public"."player" p
     WHERE p.club_id = inv.club_id AND p.id = inv.player_id
       FOR UPDATE;
    IF (owner_user IS NOT NULL AND owner_user <> caller)
       OR EXISTS (SELECT 1 FROM "public"."player" p
                   WHERE p.club_id = inv.club_id AND p.user_id = caller AND p.id <> inv.player_id) THEN
      RETURN QUERY SELECT 'player_taken'::text, NULL::uuid, false;
      RETURN;
    END IF;
  END IF;

  SELECT m.id INTO active
    FROM "public"."membership" m
   WHERE m.club_id = inv.club_id AND m.user_id = caller AND m.role = inv.role AND m.ended_at IS NULL;
  IF active IS NULL THEN
    INSERT INTO "public"."membership" (club_id, user_id, role, invited_by, created_by, updated_by)
    VALUES (inv.club_id, caller, inv.role, inv.created_by, caller, caller)
    -- A concurrent accept of another invitation for the same role: keep the first.
    ON CONFLICT DO NOTHING
    RETURNING id INTO active;
    inserted := active IS NOT NULL;
    IF active IS NULL THEN
      SELECT m.id INTO active
        FROM "public"."membership" m
       WHERE m.club_id = inv.club_id AND m.user_id = caller AND m.role = inv.role AND m.ended_at IS NULL;
    END IF;
    IF active IS NULL THEN
      RAISE EXCEPTION 'accept_invitation: membership not found after insert';
    END IF;
  END IF;

  IF inv.role IN ('coach', 'sc', 'medical') THEN
    INSERT INTO "public"."staff_assignment" (club_id, membership_id, category_id, valid_from, created_by, updated_by)
    SELECT inv.club_id, active, ic.category_id, (pg_catalog.now() AT TIME ZONE inv.time_zone)::date, caller, caller
      FROM "public"."invitation_category" ic
     WHERE ic.club_id = inv.club_id AND ic.invitation_id = inv.id
       AND NOT EXISTS (SELECT 1 FROM "public"."staff_assignment" sa
                        WHERE sa.club_id = inv.club_id AND sa.membership_id = active
                          AND sa.category_id = ic.category_id AND sa.valid_to IS NULL)
    -- staff_assignment_open_category_key: a concurrent accept for the same membership.
    ON CONFLICT DO NOTHING;
  END IF;

  IF inv.role = 'player' AND inv.player_id IS NOT NULL THEN
    UPDATE "public"."player"
       SET user_id = caller, updated_by = caller
     WHERE club_id = inv.club_id AND id = inv.player_id AND user_id IS DISTINCT FROM caller;
  END IF;

  IF inv.role = 'parent' AND inv.player_id IS NOT NULL THEN
    INSERT INTO "public"."guardian" (club_id, player_id, user_id, relationship, valid_from, created_by, updated_by)
    SELECT inv.club_id, inv.player_id, caller, inv.guardian_relationship,
           (pg_catalog.now() AT TIME ZONE inv.time_zone)::date, inv.created_by, caller
     WHERE NOT EXISTS (SELECT 1 FROM "public"."guardian" g
                        WHERE g.club_id = inv.club_id AND g.player_id = inv.player_id
                          AND g.user_id = caller AND g.valid_to IS NULL)
    -- guardian_active_key: a concurrent accept of another link to the same player.
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE "public"."invitation"
     SET accepted_at = pg_catalog.now(), accepted_by = caller, updated_by = caller
   WHERE id = inv.id;

  RETURN QUERY SELECT 'joined'::text, active, inserted;
END;
$$;
--> statement-breakpoint

-- ─── The player's account without email (B-310, ADR 0042) ───────────────────────────
-- An access code only ever signs in the account without email of its own player: the user
-- with the reserved address `player.<player id>@no-email.invalid`, never a superadmin. Any
-- other account (an email of its own) signs in with that email, and a code must not open it:
-- a Better Auth session is the user's in every club of theirs, not only in the issuer's.
-- Internal: only the two functions below (owner, SECURITY DEFINER) call it.
CREATE FUNCTION "app"."is_player_no_email_account"(player_id uuid, account_id text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "public"."user" u
                  WHERE u.id = account_id
                    AND u.email = 'player.' || player_id::text || '@no-email.invalid'
                    AND NOT u.is_superadmin);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."is_player_no_email_account"(uuid, text) FROM PUBLIC;
--> statement-breakpoint

-- Whether an access code may be issued for a player of the context's club: the player has
-- no account yet or only their account without email. The caller's policies may hide the
-- account's email (a guardian does not see it), hence SECURITY DEFINER; it answers only
-- about a player of the context's club, and NULL for any other id.
CREATE FUNCTION "app"."player_takes_access_codes"(player_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT p.user_id IS NULL OR "app"."is_player_no_email_account"(p.id, p.user_id)
    FROM "public"."player" p
   WHERE p.club_id = "app"."current_club_id"() AND p.id = player_id;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."player_takes_access_codes"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."player_takes_access_codes"(uuid) TO "sport_performance_app";
--> statement-breakpoint

-- ─── Redeeming a player access code (B-310, ADR 0042) ────────────────────────────────
-- The player's device has no session and no club yet: the code (or the token of the link) is
-- the capability. Finds exactly the row of the hash given (one of the two, the other NULL),
-- locks it and, when it is still pending at the database's clock and its issuer still may
-- give access, uses it up in the same transaction:
--
--   * the player's account without email: `player.user_id` when it is that account, or a
--     new user (reserved address `player.<player id>@no-email.invalid`, RFC 2606: no mail
--     is ever sent to it, and the API never sends sign-in codes to `.invalid`). A player
--     whose account has an email (their own, or one linked by mistake) is refused
--     (`has_account`): a Better Auth session is the user's in every club, so a code must
--     never open any other account (see `app.player_takes_access_codes`);
--   * an active `player` membership of the club (`invited_by` = the issuer);
--   * the code marked consumed by that account.
--
-- The issuer is checked again (the code may be minutes old): an active `admin`, a
-- superadmin, or a `parent` with a current guardian link to a player who is still a minor
-- on the club's day (18, `AGE_OF_MAJORITY_YEARS` of the domain; B-311 adds the adult's
-- confirmation). A player who left the club cannot be signed in.
--
-- `outcome`: redeemed | not_found | consumed | revoked | expired | not_allowed | has_account.
-- Only `redeemed` returns the account, the club, the membership and the code's id.
CREATE FUNCTION "app"."redeem_player_access"(access_code_hash text, access_token_hash text)
RETURNS TABLE (outcome text, player_user_id text, player_club_id uuid, player_membership_id uuid, user_created boolean,
               access_code_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  code record;
  target record;
  today date;
  account text;
  created boolean := false;
  active uuid;
BEGIN
  IF "app"."current_club_id"() IS NOT NULL THEN
    RAISE EXCEPTION 'redeem_player_access runs without app.club_id'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF num_nonnulls(access_code_hash, access_token_hash) <> 1 THEN
    RAISE EXCEPTION 'redeem_player_access takes exactly one of the code hash and the token hash'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT a.id, a.club_id, a.player_id, a.expires_at, a.consumed_at, a.revoked_at, a.created_by,
         c.time_zone
    INTO code
    FROM "public"."player_access_code" a
    JOIN "public"."club" c ON c.id = a.club_id
   WHERE (access_code_hash IS NOT NULL AND a.code_hash = access_code_hash)
      OR (access_token_hash IS NOT NULL AND a.token_hash = access_token_hash)
     FOR UPDATE OF a;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid, NULL::uuid, false, NULL::uuid;
    RETURN;
  END IF;
  IF code.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'consumed'::text, NULL::text, NULL::uuid, NULL::uuid, false, NULL::uuid;
    RETURN;
  END IF;
  IF code.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revoked'::text, NULL::text, NULL::uuid, NULL::uuid, false, NULL::uuid;
    RETURN;
  END IF;
  IF code.expires_at <= pg_catalog.now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, NULL::uuid, NULL::uuid, false, NULL::uuid;
    RETURN;
  END IF;

  today := (pg_catalog.now() AT TIME ZONE code.time_zone)::date;
  -- The player row lock serializes this with an invitation accepted for the same player.
  SELECT p.id, p.user_id, p.first_name, p.last_name, p.birth_date, p.left_on
    INTO target
    FROM "public"."player" p
   WHERE p.club_id = code.club_id AND p.id = code.player_id
     FOR UPDATE;

  IF (target.left_on IS NOT NULL AND target.left_on <= today)
     OR code.created_by IS NULL
     OR NOT (
       EXISTS (SELECT 1 FROM "public"."user" u WHERE u.id = code.created_by AND u.is_superadmin)
       OR EXISTS (SELECT 1 FROM "public"."membership" m
                   WHERE m.club_id = code.club_id AND m.user_id = code.created_by
                     AND m.role = 'admin' AND m.started_at <= pg_catalog.now()
                     AND (m.ended_at IS NULL OR m.ended_at > pg_catalog.now()))
       OR (target.birth_date > (today - interval '18 years')::date
           AND EXISTS (SELECT 1
                         FROM "public"."membership" m
                         JOIN "public"."guardian" g
                           ON g.club_id = m.club_id AND g.user_id = m.user_id
                          AND g.player_id = code.player_id
                          AND g.valid_from <= today AND (g.valid_to IS NULL OR g.valid_to > today)
                        WHERE m.club_id = code.club_id AND m.user_id = code.created_by
                          AND m.role = 'parent' AND m.started_at <= pg_catalog.now()
                          AND (m.ended_at IS NULL OR m.ended_at > pg_catalog.now()))))
  THEN
    RETURN QUERY SELECT 'not_allowed'::text, NULL::text, NULL::uuid, NULL::uuid, false, NULL::uuid;
    RETURN;
  END IF;

  IF target.user_id IS NOT NULL
     AND NOT "app"."is_player_no_email_account"(target.id, target.user_id) THEN
    RETURN QUERY SELECT 'has_account'::text, NULL::text, NULL::uuid, NULL::uuid, false, NULL::uuid;
    RETURN;
  END IF;

  account := target.user_id;
  IF account IS NULL THEN
    INSERT INTO "public"."user" (name, email, email_verified)
    VALUES (pg_catalog.btrim(target.first_name || ' ' || target.last_name),
            'player.' || target.id::text || '@no-email.invalid', false)
    -- An account left by an earlier redeem whose player was unlinked afterwards.
    ON CONFLICT (email) DO UPDATE SET updated_at = pg_catalog.now()
    RETURNING id, (xmax = 0) INTO account, created;
    IF NOT "app"."is_player_no_email_account"(target.id, account) THEN
      RAISE EXCEPTION 'redeem_player_access: the reserved account of the player is not usable';
    END IF;
    UPDATE "public"."player"
       SET user_id = account, updated_by = code.created_by
     WHERE club_id = code.club_id AND id = code.player_id;
  END IF;

  SELECT m.id INTO active
    FROM "public"."membership" m
   WHERE m.club_id = code.club_id AND m.user_id = account AND m.role = 'player'
     AND m.ended_at IS NULL;
  IF active IS NULL THEN
    INSERT INTO "public"."membership" (club_id, user_id, role, invited_by, created_by, updated_by)
    VALUES (code.club_id, account, 'player', code.created_by, code.created_by, code.created_by)
    -- A concurrent redeem or accept for the same account: keep the first.
    ON CONFLICT DO NOTHING
    RETURNING id INTO active;
    IF active IS NULL THEN
      SELECT m.id INTO active
        FROM "public"."membership" m
       WHERE m.club_id = code.club_id AND m.user_id = account AND m.role = 'player'
         AND m.ended_at IS NULL;
    END IF;
    IF active IS NULL THEN
      RAISE EXCEPTION 'redeem_player_access: membership not found after insert';
    END IF;
  END IF;

  UPDATE "public"."player_access_code"
     SET consumed_at = pg_catalog.now(), consumed_by = account
   WHERE id = code.id;

  RETURN QUERY SELECT 'redeemed'::text, account, code.club_id, active, created, code.id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."redeem_player_access"(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."redeem_player_access"(text, text) TO "sport_performance_app";
