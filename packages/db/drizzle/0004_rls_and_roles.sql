-- Hand-written migration (ADR 0006, ADR 0025): connection roles, the `app.*` context
-- functions, grants and Row Level Security on every table.
--
-- Three NOLOGIN group roles; real logins (with passwords, never in the repo) are created
-- as members of exactly one of them with `provisionLoginRole()` / `db:provision-login`:
--
--   sport_performance_app     the API. Sees what the tenant context of the transaction
--                             (`app.club_id`, `app.user_id`, `app.role`) allows.
--   sport_performance_worker  the worker. One club per transaction (`app.club_id`), all of it.
--   sport_performance_auth    Better Auth. Only the identity tables.
--
-- None is superuser, owns a table or has BYPASSRLS. Every policy is written for a role, so
-- a role without a policy on a table sees nothing there.
--
-- This migration must run as a superuser or a role with BYPASSRLS (as every migration
-- does: the runner connects with MIGRATIONS_DATABASE_URL, the table owner). The SECURITY
-- DEFINER functions below are owned by that role and read tables that have FORCE ROW
-- LEVEL SECURITY: an owner subject to RLS would see nothing through them.
DO $$
BEGIN
  IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
    RAISE EXCEPTION 'Migrations must run as a superuser or a role with BYPASSRLS (connected as %)', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
--> statement-breakpoint

-- Roles are cluster-wide: another database of the same server (or a concurrent run) may
-- have created them already. Attributes are reset only when they drifted, so concurrent
-- migrations of several databases do not update the same catalog row.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['sport_performance_app', 'sport_performance_worker', 'sport_performance_auth'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      BEGIN
        EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', role_name);
      EXCEPTION WHEN duplicate_object OR unique_violation THEN
        NULL;
      END;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname = role_name
         AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    ) THEN
      EXECUTE format('ALTER ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', role_name);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

-- Nobody but the owner creates objects in `public`; the application roles only use it.
REVOKE CREATE ON SCHEMA "public" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "public" TO "sport_performance_app", "sport_performance_worker", "sport_performance_auth";
--> statement-breakpoint
-- The migrations journal is the owner's business.
REVOKE ALL ON SCHEMA "drizzle" FROM PUBLIC;
--> statement-breakpoint

-- ─── Context functions (ADR 0006) ────────────────────────────────────────────────────
-- The API sets the three settings with set_config(..., true) (SET LOCAL) as the first
-- statement of every transaction. '' (what Postgres reports for a custom setting once the
-- transaction that set it ended) and an unset setting both read as NULL: deny.
CREATE SCHEMA "app";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "app" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "app" TO "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint

-- A malformed value raises (invalid_text_representation): an error, never a match.
CREATE FUNCTION "app"."current_club_id"() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(pg_catalog.current_setting('app.club_id', true), '')::uuid
$$;
--> statement-breakpoint

CREATE FUNCTION "app"."current_user_id"() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(pg_catalog.current_setting('app.user_id', true), '')
$$;
--> statement-breakpoint

-- The role the transaction claims, only if the database agrees: an active membership of
-- that user with that role in that club, or `superadmin` for a user with `is_superadmin`
-- acting in an existing club (ADR 0007: superadmin is not a membership). Otherwise NULL,
-- so a bug in the API that sets the wrong role grants nothing.
CREATE FUNCTION "app"."current_role"() RETURNS text
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

-- The user of the context has the global support flag (needed without a club: list and
-- create clubs).
CREATE FUNCTION "app"."is_superadmin"() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "public"."user" u
                  WHERE u.id = "app"."current_user_id"() AND u.is_superadmin)
$$;
--> statement-breakpoint

-- `admin` and `superadmin` see the whole club; every other role is scoped.
CREATE FUNCTION "app"."sees_whole_club"() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce("app"."current_role"() IN ('admin', 'superadmin'), false)
$$;
--> statement-breakpoint

-- "Today" in the club's time zone (CLAUDE.md: the day is the club's day). Validity ranges
-- (`valid_from` inclusive, `valid_to` exclusive) are compared with it.
CREATE FUNCTION "app"."club_today"() RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT (now() AT TIME ZONE c.time_zone)::date
    FROM "public"."club" c
   WHERE c.id = "app"."current_club_id"()
$$;
--> statement-breakpoint

-- Players the current (validated) role may see, besides `admin`/`superadmin` who see all:
--   player   the player linked to their user;
--   parent   the players of their current `guardian` links;
--   coach, sc, medical  the players currently in a category of their current
--            `staff_assignment` (by category, or every category of the assigned sport).
-- Whole history: once a player is visible, so are all their rows (5-6 years of comparable
-- history is the point of the product). Policies call it once per statement
-- (`(SELECT app.visible_player_ids())` is an init plan).
CREATE FUNCTION "app"."visible_player_ids"() RETURNS uuid[]
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
        FROM ctx JOIN "public"."guardian" g ON g.club_id = ctx.club_id AND g.user_id = ctx.user_id
       WHERE ctx.role = 'parent'
         AND g.valid_from <= ctx.today AND (g.valid_to IS NULL OR g.valid_to > ctx.today)
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

-- Public branding of a club by slug, for the theme endpoint the web and the app call before
-- login (B-313). Only what the theme contract exposes: no settings, no people.
CREATE FUNCTION "app"."club_theme"(club_slug text)
RETURNS TABLE (id uuid, slug text, name text, branding jsonb, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.id, c.slug, c.name, c.branding, c.updated_at FROM "public"."club" c WHERE c.slug = club_slug
$$;
--> statement-breakpoint

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "app" FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "app" TO "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint

-- The unit check reads metric_definition; as the invoker it would be subject to RLS and a
-- writer that cannot see the metric would skip the check. Run it as the owner.
ALTER FUNCTION "public"."unit_matches_metric"() SECURITY DEFINER SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."unit_matches_metric"() FROM PUBLIC;
--> statement-breakpoint

-- ─── Policy builder for club tables ──────────────────────────────────────────────────
-- `app_admin` is for migrations only (no grants). `secure_club_table` gives a table with
-- `club_id` the standard treatment, so every club table (and every future one) gets the
-- same shape that the catalog tests check:
--
--   * ENABLE + FORCE ROW LEVEL SECURITY.
--   * <t>_app_club / <t>_worker_club: RESTRICTIVE, every command, `club_id` must be the
--     context's club. Isolation between clubs does not depend on the role policies below.
--   * <t>_app_select: rows the role may read (`read_using`).
--   * <t>_app_insert / <t>_app_update: only `writers`, only rows they can read, plus
--     `write_check`. UPDATE is granted on every column but the identity ones (`id`,
--     `club_id`, `created_at`, `created_by`, `client_uuid`) and generated columns.
--   * <t>_app_delete: only when `deleters` is not empty. The application closes, voids or
--     archives rows instead of deleting them (ADR 0023); deleting is the exception.
--   * <t>_worker_all: the worker sees and writes the whole club of the job (no DELETE).
CREATE SCHEMA "app_admin";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "app_admin" FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION "app_admin"."role_in"(roles text[]) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT format('(SELECT "app"."current_role"()) = ANY (%L::text[])', roles)
$$;
--> statement-breakpoint

CREATE FUNCTION "app_admin"."secure_club_table"(
  target regclass,
  read_using text,
  writers text[],
  write_check text DEFAULT 'true',
  deleters text[] DEFAULT '{}',
  app_isolation text DEFAULT 'club_id = (SELECT "app"."current_club_id"())'
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t text := (SELECT c.relname FROM pg_catalog.pg_class c WHERE c.oid = target);
  updatable text;
  write_using text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO updatable
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = target AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     AND a.attname NOT IN ('id', 'club_id', 'created_at', 'created_by', 'client_uuid');

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);

  EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR ALL TO "sport_performance_app" USING (%s) WITH CHECK (%s)',
                 t || '_app_club', target, app_isolation, app_isolation);
  EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR ALL TO "sport_performance_worker" USING (club_id = (SELECT "app"."current_club_id"()))',
                 t || '_worker_club', target);

  EXECUTE format('CREATE POLICY %I ON %s FOR SELECT TO "sport_performance_app" USING (%s)',
                 t || '_app_select', target, read_using);
  EXECUTE format('GRANT SELECT ON %s TO "sport_performance_app", "sport_performance_worker"', target);

  IF cardinality(writers) > 0 THEN
    write_using := format('%s AND (%s) AND (%s)', "app_admin"."role_in"(writers), read_using, write_check);
    EXECUTE format('CREATE POLICY %I ON %s FOR INSERT TO "sport_performance_app" WITH CHECK (%s)',
                   t || '_app_insert', target, write_using);
    EXECUTE format('CREATE POLICY %I ON %s FOR UPDATE TO "sport_performance_app" USING (%s) WITH CHECK (%s)',
                   t || '_app_update', target, write_using, write_using);
    EXECUTE format('GRANT INSERT, UPDATE (%s) ON %s TO "sport_performance_app"', updatable, target);
  END IF;

  IF cardinality(deleters) > 0 THEN
    EXECUTE format('CREATE POLICY %I ON %s FOR DELETE TO "sport_performance_app" USING (%s AND (%s))',
                   t || '_app_delete', target, "app_admin"."role_in"(deleters), read_using);
    EXECUTE format('GRANT DELETE ON %s TO "sport_performance_app"', target);
  END IF;

  EXECUTE format('CREATE POLICY %I ON %s FOR ALL TO "sport_performance_worker" USING (true) WITH CHECK (true)',
                 t || '_worker_all', target);
  EXECUTE format('GRANT INSERT, UPDATE (%s) ON %s TO "sport_performance_worker"', updatable, target);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "app_admin" FROM PUBLIC;
--> statement-breakpoint

-- ─── Club tables ─────────────────────────────────────────────────────────────────────
-- Read scopes:
--   member   any validated role of the club (catalogs, calendar, sessions);
--   staff    coach, sc, medical, admin, superadmin;
--   player   admin/superadmin, or the player is in app.visible_player_ids().
-- Writers (a coarse backstop under the permission matrix of the API, B-303; the stricter
-- of the two wins):
--   admin     admin, superadmin: club structure, people, memberships;
--   sc        sc + admin: tests, measurements, catalogs, battery, gym, calendar windows;
--   training  coach + sc + admin: training sessions, drills and participation.
DO $$
DECLARE
  member constant text := '(SELECT "app"."current_role"()) IS NOT NULL';
  staff constant text := "app_admin"."role_in"('{coach,sc,medical,admin,superadmin}');
  admin constant text[] := '{admin,superadmin}';
  sc constant text[] := '{sc,admin,superadmin}';
  training constant text[] := '{coach,sc,admin,superadmin}';
  all_staff constant text[] := '{coach,sc,medical,admin,superadmin}';
  player_scope constant text := '((SELECT "app"."sees_whole_club"()) OR %1$I = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))';
BEGIN
  -- Club structure and catalogs: every member reads them.
  PERFORM "app_admin"."secure_club_table"('public.season', member, admin);
  PERFORM "app_admin"."secure_club_table"('public.category', member, admin);
  PERFORM "app_admin"."secure_club_table"('public.position', member, admin);
  PERFORM "app_admin"."secure_club_table"('public.test_window', member, sc);
  PERFORM "app_admin"."secure_club_table"('public.metric_definition', member, sc);
  PERFORM "app_admin"."secure_club_table"('public.test_definition', member, sc);
  PERFORM "app_admin"."secure_club_table"('public.test_definition_metric', member, sc);
  PERFORM "app_admin"."secure_club_table"('public.battery_config', member, sc);
  PERFORM "app_admin"."secure_club_table"('public.reference_value', member, sc);
  PERFORM "app_admin"."secure_club_table"('public.test_session', member, sc);
  PERFORM "app_admin"."secure_club_table"('public.training_session', member, training);
  -- A drill is the plan of a session, no player data: the only planned DELETE.
  PERFORM "app_admin"."secure_club_table"('public.drill', member, training, 'true', training);

  -- Rows that are either for a group (player_id NULL: every member) or for one player.
  PERFORM "app_admin"."secure_club_table"('public.speed_zone_config',
    format('(player_id IS NULL AND %s) OR %s', member, format(player_scope, 'player_id')), sc);
  PERFORM "app_admin"."secure_club_table"('public.gym_program',
    format('(player_id IS NULL AND %s) OR %s', member, format(player_scope, 'player_id')), sc);

  -- Staff only.
  PERFORM "app_admin"."secure_club_table"('public.device', staff, sc);
  PERFORM "app_admin"."secure_club_table"('public.alert_rule', staff, sc);
  PERFORM "app_admin"."secure_club_table"('public.staff_assignment', staff, admin);

  -- Memberships: staff see the club's; everyone sees their own. Without a club in the
  -- context (club selector, ADR 0007) a user sees their memberships of every club, and
  -- nothing else anywhere.
  PERFORM "app_admin"."secure_club_table"('public.membership',
    format('user_id = (SELECT "app"."current_user_id"()) OR %s', staff), admin, 'true', '{}',
    'club_id = (SELECT "app"."current_club_id"()) OR ((SELECT "app"."current_club_id"()) IS NULL AND user_id = (SELECT "app"."current_user_id"()))');

  -- Player data.
  PERFORM "app_admin"."secure_club_table"('public.player', format(player_scope, 'id'), admin);
  PERFORM "app_admin"."secure_club_table"('public.player_category', format(player_scope, 'player_id'), admin);
  PERFORM "app_admin"."secure_club_table"('public.guardian', format(player_scope, 'player_id'), admin);
  PERFORM "app_admin"."secure_club_table"('public.player_stage', format(player_scope, 'player_id'), sc);
  PERFORM "app_admin"."secure_club_table"('public.anthro_measurement', format(player_scope, 'player_id'), sc);
  PERFORM "app_admin"."secure_club_table"('public.test_result', format(player_scope, 'player_id'), sc);
  PERFORM "app_admin"."secure_club_table"('public.external_metric', format(player_scope, 'player_id'), sc);
  -- Values are visible with their result (the subquery runs under test_result's policies).
  -- Append-only (0003): no DELETE for anyone.
  PERFORM "app_admin"."secure_club_table"('public.test_result_value',
    'EXISTS (SELECT 1 FROM "public"."test_result" r WHERE r.club_id = test_result_value.club_id AND r.id = test_result_value.test_result_id)',
    sc);
  -- The player reports their own wellness, RPE and gym sets (principle 5).
  PERFORM "app_admin"."secure_club_table"('public.wellness', format(player_scope, 'player_id'),
    all_staff || '{player}'::text[]);
  PERFORM "app_admin"."secure_club_table"('public.participation', format(player_scope, 'player_id'),
    training || '{player}'::text[]);
  PERFORM "app_admin"."secure_club_table"('public.gym_set', format(player_scope, 'player_id'),
    sc || '{player}'::text[]);
  -- Consents are signed by the guardian or the player (B-312), as themselves; admin can
  -- record one signed on paper.
  PERFORM "app_admin"."secure_club_table"('public.consent', format(player_scope, 'player_id'),
    '{parent,player,admin,superadmin}',
    '(SELECT "app"."sees_whole_club"()) OR (signed_by = (SELECT "app"."current_user_id"()) AND (revoked_by IS NULL OR revoked_by = (SELECT "app"."current_user_id"())))');
  -- Alerts are a staff tool.
  PERFORM "app_admin"."secure_club_table"('public.alert',
    format('%s AND %s', staff, format(player_scope, 'player_id')), all_staff);
END
$$;
--> statement-breakpoint

-- ─── club (tenant root) ──────────────────────────────────────────────────────────────
ALTER TABLE "public"."club" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."club" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The context's club, for any validated role. Without a club in the context: the clubs of
-- the user's active memberships (club selector) or, for a superadmin, every club.
CREATE POLICY "club_app_select" ON "public"."club" FOR SELECT TO "sport_performance_app" USING (
  (id = (SELECT "app"."current_club_id"()) AND (SELECT "app"."current_role"()) IS NOT NULL)
  OR ((SELECT "app"."current_club_id"()) IS NULL AND (
    (SELECT "app"."is_superadmin"())
    OR EXISTS (SELECT 1 FROM "public"."membership" m
                WHERE m.club_id = club.id AND m.user_id = (SELECT "app"."current_user_id"())
                  AND (m.ended_at IS NULL OR m.ended_at > now())))));
--> statement-breakpoint
-- New clubs are created by a superadmin outside any club context.
CREATE POLICY "club_app_insert" ON "public"."club" FOR INSERT TO "sport_performance_app" WITH CHECK (
  (SELECT "app"."current_club_id"()) IS NULL AND (SELECT "app"."is_superadmin"()));
--> statement-breakpoint
CREATE POLICY "club_app_update" ON "public"."club" FOR UPDATE TO "sport_performance_app"
  USING (id = (SELECT "app"."current_club_id"()) AND (SELECT "app"."sees_whole_club"()))
  WITH CHECK (id = (SELECT "app"."current_club_id"()) AND (SELECT "app"."sees_whole_club"()));
--> statement-breakpoint
CREATE POLICY "club_worker_select" ON "public"."club" FOR SELECT TO "sport_performance_worker"
  USING (id = (SELECT "app"."current_club_id"()));
--> statement-breakpoint
GRANT SELECT, INSERT ON "public"."club" TO "sport_performance_app";
--> statement-breakpoint
-- The slug is part of URLs and deep links: not editable from the application.
GRANT UPDATE ("name", "time_zone", "branding", "settings", "updated_at", "updated_by") ON "public"."club" TO "sport_performance_app";
--> statement-breakpoint
GRANT SELECT ON "public"."club" TO "sport_performance_worker";
--> statement-breakpoint

-- ─── Identity tables (Better Auth, ADR 0010) ─────────────────────────────────────────
-- Better Auth owns them through sport_performance_auth. The API and the worker only read
-- users: themselves, and the members of the context's club (staff, and the worker for
-- notifications). Sessions, accounts and verifications are invisible to them.
ALTER TABLE "public"."user" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."user" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."session" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."session" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."account" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."verification" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."verification" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "user_auth_all" ON "public"."user" FOR ALL TO "sport_performance_auth" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "session_auth_all" ON "public"."session" FOR ALL TO "sport_performance_auth" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "account_auth_all" ON "public"."account" FOR ALL TO "sport_performance_auth" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "verification_auth_all" ON "public"."verification" FOR ALL TO "sport_performance_auth" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "user_app_select" ON "public"."user" FOR SELECT TO "sport_performance_app" USING (
  id = (SELECT "app"."current_user_id"())
  OR ((SELECT "app"."current_role"()) = ANY ('{coach,sc,medical,admin,superadmin}'::text[])
      AND EXISTS (SELECT 1 FROM "public"."membership" m
                   WHERE m.club_id = (SELECT "app"."current_club_id"()) AND m.user_id = "user".id)));
--> statement-breakpoint
CREATE POLICY "user_worker_select" ON "public"."user" FOR SELECT TO "sport_performance_worker" USING (
  EXISTS (SELECT 1 FROM "public"."membership" m
           WHERE m.club_id = (SELECT "app"."current_club_id"()) AND m.user_id = "user".id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."user", "public"."session", "public"."account", "public"."verification" TO "sport_performance_auth";
--> statement-breakpoint
GRANT SELECT ON "public"."user" TO "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint

-- `is_superadmin` is granted by an operator connected as the owner, never by the
-- application roles (not even through Better Auth, which writes `false` on sign-up).
CREATE FUNCTION "public"."user_superadmin_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.is_superadmin)
     OR (TG_OP = 'UPDATE' AND NEW.is_superadmin IS DISTINCT FROM OLD.is_superadmin) THEN
    IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
      RAISE EXCEPTION 'is_superadmin can only be changed by the database owner'
        USING ERRCODE = 'insufficient_privilege', TABLE = 'user', COLUMN = 'is_superadmin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."user_superadmin_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "user_superadmin_guard" BEFORE INSERT OR UPDATE OF "is_superadmin" ON "public"."user" FOR EACH ROW EXECUTE FUNCTION "public"."user_superadmin_guard"();
