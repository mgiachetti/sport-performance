-- Reading the support access log (B-414, ADR 0066). `support.access_log` (migration 0007,
-- ADR 0029) stays out of reach of every connection role: no grant on the schema, forced RLS
-- without policies, append-only. The only way to read it is this SECURITY DEFINER function,
-- which decides the scope from the validated context of the transaction:
--
--   * the registry of clubs (`app.is_superadmin()`: a superadmin who recorded a support
--     access without club in this transaction): every entry, optionally of one club;
--   * the administration of a club (`app.current_role()` is `admin`, or `superadmin` with a
--     recorded support access to it): only the entries of that club;
--   * anyone else: 42501.
--
-- Every call needs `app.request_id`, like every audited operation. A superadmin's call is
-- itself an entry of the log (the access it recorded to read it).
--
-- Like 0007 it must run as a superuser or a role with BYPASSRLS: the function reads tables
-- with FORCE ROW LEVEL SECURITY.
DO $$
BEGIN
  IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
    RAISE EXCEPTION 'Migrations must run as a superuser or a role with BYPASSRLS (connected as %)', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
--> statement-breakpoint

-- Newest first across the whole log (the registry) and within one club: keyset by
-- (started_at, id) in both directions of the index.
CREATE INDEX "access_log_started_idx" ON "support"."access_log" ("started_at", "id");
--> statement-breakpoint
CREATE INDEX "access_log_club_started_idx" ON "support"."access_log" ("club_id", "started_at", "id");
--> statement-breakpoint
DROP INDEX "support"."access_log_club_idx";
--> statement-breakpoint

-- Entries newest first, `p_limit` at most (1 to 101: a page of 100 plus one to know if there
-- is a next one). The keyset `(p_before_at, p_before_id)` is the last entry of the previous
-- page; `started_at_key` carries its exact time (microseconds, UTC) for it. `p_from` is
-- inclusive and `p_to` exclusive. The operator and the club are joined for display: the log
-- keeps only their ids (no foreign key to the user, the evidence outlives the account).
CREATE FUNCTION "app"."support_access_entries"(
  p_club_id uuid,
  p_user_id text,
  p_from timestamptz,
  p_to timestamptz,
  p_before_at timestamptz,
  p_before_id uuid,
  p_limit integer
) RETURNS TABLE (
  "id" uuid,
  "started_at" timestamptz,
  "started_at_key" text,
  "user_id" text,
  "user_name" text,
  "user_email" text,
  "club_id" uuid,
  "club_name" text,
  "club_slug" text,
  "club_time_zone" text,
  "reason" text,
  "request_id" text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  scope_club uuid;
BEGIN
  IF "app"."current_request_id"() IS NULL THEN
    RAISE EXCEPTION 'Reading the support access log needs app.request_id'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF "app"."is_superadmin"() THEN
    scope_club := p_club_id;
  ELSIF "app"."current_role"() IN ('admin', 'superadmin') THEN
    scope_club := "app"."current_club_id"();
    IF p_club_id IS NOT NULL AND p_club_id <> scope_club THEN
      RAISE EXCEPTION 'The administration of a club reads only the support accesses to it'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    RAISE EXCEPTION 'Only the registry or the administration of the club reads the support access log'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 101' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_before_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'The keyset needs both p_before_at and p_before_id'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  SELECT s.id,
         s.started_at,
         to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
         s.user_id,
         u.name,
         u.email,
         s.club_id,
         c.name,
         c.slug,
         c.time_zone,
         s.reason,
         s.request_id
    FROM "support"."access_log" s
    LEFT JOIN "public"."user" u ON u.id = s.user_id
    LEFT JOIN "public"."club" c ON c.id = s.club_id
   WHERE (scope_club IS NULL OR s.club_id = scope_club)
     AND (p_user_id IS NULL OR s.user_id = p_user_id)
     AND (p_from IS NULL OR s.started_at >= p_from)
     AND (p_to IS NULL OR s.started_at < p_to)
     AND (p_before_at IS NULL OR (s.started_at, s.id) < (p_before_at, p_before_id))
   ORDER BY s.started_at DESC, s.id DESC
   LIMIT p_limit;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."support_access_entries"(uuid, text, timestamptz, timestamptz, timestamptz, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
-- Only the API reads it; the worker never acts as a superadmin nor administers a club.
GRANT EXECUTE ON FUNCTION "app"."support_access_entries"(uuid, text, timestamptz, timestamptz, timestamptz, uuid, integer)
  TO "sport_performance_app";
