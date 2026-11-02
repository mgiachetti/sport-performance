DROP INDEX "consent_current_document_key";--> statement-breakpoint
ALTER TABLE "guardian" ADD COLUMN "adult_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guardian" ADD COLUMN "adult_confirmed_by" text;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_adult_confirmed_by_user_id_fk" FOREIGN KEY ("adult_confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_current_document_key" ON "consent" USING btree ("club_id","player_id","document_id","signer_kind") WHERE "consent"."revoked_at" is null and "consent"."document_id" is not null;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_adult_confirmation" CHECK ("guardian"."adult_confirmed_by" is null or "guardian"."adult_confirmed_at" is not null);--> statement-breakpoint

-- ─── Hand-written (B-311, ADR 0048): coming of age ───────────────────────────────────
-- The majority is 18 on the club's day (`AGE_OF_MAJORITY_YEARS` of the domain), written as
-- `birth_date > today - interval '18 years'` for a minor: the same rule as the domain's
-- `isOfAge` (29 February turns 18 on 1 March of a common year).
--
-- `guardian.adult_confirmed_at` / `adult_confirmed_by` are on purpose not granted to the
-- application (its UPDATE on `guardian` is per column, 0004): only the adult decides, through
-- `app.review_guardian` below; not the administration, not the guardian.

-- Players a role sees (0004), now with the majority: a `parent` sees the players of their
-- current links who are minors, or adults who kept the link (`adult_confirmed_at`). The rest
-- is unchanged. Every policy scoped by player follows, so the guardian of an adult who did
-- not confirm sees none of their rows (consents, wellness, tests, medical…).
CREATE OR REPLACE FUNCTION "app"."visible_player_ids"() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  WITH ctx AS (
    SELECT "app"."current_club_id"() AS club_id,
           "app"."current_user_id"() AS user_id,
           "app"."current_role"() AS role,
           "app"."club_today"() AS today
  )
  SELECT coalesce(array_agg(DISTINCT v.player_id), '{}')
    FROM (
      SELECT p.id AS player_id
        FROM ctx JOIN "public"."player" p ON p.club_id = ctx.club_id AND p.user_id = ctx.user_id
       WHERE ctx.role = 'player'
      UNION ALL
      SELECT g.player_id
        FROM ctx
        JOIN "public"."guardian" g ON g.club_id = ctx.club_id AND g.user_id = ctx.user_id
        JOIN "public"."player" p ON p.club_id = g.club_id AND p.id = g.player_id
       WHERE ctx.role = 'parent'
         AND g.valid_from <= ctx.today AND (g.valid_to IS NULL OR g.valid_to > ctx.today)
         AND (p.birth_date > (ctx.today - interval '18 years')::date OR g.adult_confirmed_at IS NOT NULL)
      UNION ALL
      SELECT pc.player_id
        FROM ctx
        JOIN "public"."membership" m
          ON m.club_id = ctx.club_id AND m.user_id = ctx.user_id AND m.role::text = ctx.role
         AND m.started_at <= now() AND (m.ended_at IS NULL OR m.ended_at > now())
        JOIN "public"."staff_assignment" sa
          ON sa.club_id = m.club_id AND sa.membership_id = m.id
         AND sa.valid_from <= ctx.today AND (sa.valid_to IS NULL OR sa.valid_to > ctx.today)
        JOIN "public"."player_category" pc
          ON pc.club_id = m.club_id
         AND pc.valid_from <= ctx.today AND (pc.valid_to IS NULL OR pc.valid_to > ctx.today)
        JOIN "public"."category" c ON c.club_id = pc.club_id AND c.id = pc.category_id
       WHERE ctx.role IN ('coach', 'sc', 'medical')
         AND (sa.category_id = pc.category_id OR sa.sport = c.sport)
    ) v
$$;
--> statement-breakpoint

-- A guardian always sees their own links, also the one with an adult who did not keep it:
-- that is how they learn why they no longer have access (`GET /v1/me/children`). Only the
-- link row; the player's data stays behind `app.visible_player_ids()`.
CREATE POLICY "guardian_app_own_link_select" ON "public"."guardian" FOR SELECT TO "sport_performance_app"
  USING ((SELECT "app"."current_role"()) = 'parent' AND user_id = (SELECT "app"."current_user_id"()));
--> statement-breakpoint

-- The adult player decides on each guardian by name: a `player` sees the accounts (the API
-- shows them the name, never the email) of the guardians linked to their own player.
CREATE POLICY "user_app_player_guardians_select" ON "public"."user" FOR SELECT TO "sport_performance_app" USING (
  (SELECT "app"."current_role"()) = 'player'
  AND EXISTS (SELECT 1 FROM "public"."guardian" g
                JOIN "public"."player" p ON p.club_id = g.club_id AND p.id = g.player_id
               WHERE g.club_id = (SELECT "app"."current_club_id"()) AND g.user_id = "user".id
                 AND p.user_id = (SELECT "app"."current_user_id"())));
--> statement-breakpoint

-- The current links of the calling guardian, with the little a guardian may know of each
-- child whatever their age (name, birth date, whether they have an account), and whether
-- the adult kept the link. SECURITY DEFINER because `app.visible_player_ids()` hides an
-- adult who did not confirm from the guardian; it answers only for the validated `parent`
-- role, about their own links in the context's club.
CREATE FUNCTION "app"."guardian_children"()
RETURNS TABLE (guardian_id uuid, relationship "public"."guardian_relationship", player_id uuid,
               first_name text, last_name text, birth_date date, has_account boolean,
               adult_confirmed boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT g.id, g.relationship, p.id, p.first_name, p.last_name, p.birth_date,
         p.user_id IS NOT NULL, g.adult_confirmed_at IS NOT NULL
    FROM "public"."guardian" g
    JOIN "public"."player" p ON p.club_id = g.club_id AND p.id = g.player_id
   WHERE "app"."current_role"() = 'parent'
     AND g.club_id = "app"."current_club_id"()
     AND g.user_id = "app"."current_user_id"()
     AND g.valid_from <= "app"."club_today"()
     AND (g.valid_to IS NULL OR g.valid_to > "app"."club_today"())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."guardian_children"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."guardian_children"() TO "sport_performance_app";
--> statement-breakpoint

-- The adult player's decision on one of their guardians (permission `guardian_link.review`:
-- the player themself, of age). The application has no policy to write `guardian` as a
-- player: this function is the only way, and it checks everything again:
--   * the validated role is `player` and the link is of the caller's own player
--     (`not_found` otherwise, the same for another club or another player);
--   * the player is of age on the club's day (`minor`);
--   * `confirm` / `withdraw` need a current link (`ended`); `end` of an ended link is a no-op.
-- `confirm` keeps the guardian's access (read only: what the matrix gives a guardian without
-- needing a minor); `withdraw` takes it back; `end` closes the link from today (an empty
-- range if it starts later, like the administration's end) and revokes the access codes and
-- player invitations that guardian left open. Idempotent. Returns `ok` or the refusal.
CREATE FUNCTION "app"."review_guardian"(guardian_id uuid, decision text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  caller text := "app"."current_user_id"();
  club uuid := "app"."current_club_id"();
  today date;
  link record;
BEGIN
  IF decision IS NULL OR decision NOT IN ('confirm', 'withdraw', 'end') THEN
    RAISE EXCEPTION 'review_guardian: unknown decision %', decision
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF "app"."current_role"() IS DISTINCT FROM 'player' OR caller IS NULL OR club IS NULL THEN
    RETURN 'not_found';
  END IF;
  today := "app"."club_today"();
  SELECT g.id, g.player_id, g.user_id, g.valid_from, g.valid_to, p.birth_date
    INTO link
    FROM "public"."guardian" g
    JOIN "public"."player" p ON p.club_id = g.club_id AND p.id = g.player_id
   WHERE g.club_id = club AND g.id = guardian_id AND p.user_id = caller
     FOR UPDATE OF g;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF link.birth_date > (today - interval '18 years')::date THEN
    RETURN 'minor';
  END IF;

  IF link.valid_to IS NOT NULL AND link.valid_to <= today THEN
    -- Ended: nothing to keep or withdraw; ending it again changes nothing.
    RETURN CASE WHEN decision = 'end' THEN 'ok' ELSE 'ended' END;
  END IF;
  IF link.valid_from > today THEN
    -- Not started yet: it can only be ended, as an empty range that never counts.
    IF decision <> 'end' THEN
      RETURN 'ended';
    END IF;
    UPDATE "public"."guardian" SET valid_to = link.valid_from, updated_by = caller
     WHERE club_id = club AND id = link.id;
    RETURN 'ok';
  END IF;

  IF decision = 'confirm' THEN
    UPDATE "public"."guardian"
       SET adult_confirmed_at = now(), adult_confirmed_by = caller, updated_by = caller
     WHERE club_id = club AND id = link.id AND adult_confirmed_at IS NULL;
  ELSIF decision = 'withdraw' THEN
    UPDATE "public"."guardian"
       SET adult_confirmed_at = NULL, adult_confirmed_by = NULL, updated_by = caller
     WHERE club_id = club AND id = link.id AND adult_confirmed_at IS NOT NULL;
  ELSE
    UPDATE "public"."guardian" SET valid_to = today, updated_by = caller
     WHERE club_id = club AND id = link.id;
    UPDATE "public"."player_access_code"
       SET revoked_at = now(), revoked_by = caller, updated_by = caller
     WHERE club_id = club AND player_id = link.player_id AND created_by = link.user_id
       AND consumed_at IS NULL AND revoked_at IS NULL;
    UPDATE "public"."invitation"
       SET revoked_at = now(), revoked_by = caller, updated_by = caller
     WHERE club_id = club AND player_id = link.player_id AND created_by = link.user_id
       AND role = 'player' AND accepted_at IS NULL AND revoked_at IS NULL;
  END IF;
  RETURN 'ok';
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."review_guardian"(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."review_guardian"(uuid, text) TO "sport_performance_app";
--> statement-breakpoint

-- Current consents (0019), now with the majority: a guardian's signature stops counting
-- ADULT_CONSENT_GRACE_DAYS (30) days after the player turns 18, that is, once the player
-- was of age 30 days ago. It is not revoked (it stays as evidence); the adult signs their
-- own. `medical.has_health_consent` asks this function, so health follows too.
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
     AND ("app"."sees_whole_club"() OR player = ANY ("app"."visible_player_ids"()))
$$;
