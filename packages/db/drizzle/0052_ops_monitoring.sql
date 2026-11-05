-- ─── Operational monitoring (B-703, ADR 0095) ────────────────────────────────────────
-- The state of each operational check of the platform (worker heartbeat, failed and
-- dead-lettered jobs, backlog, recalculation lag, failed reports, exports and deliveries,
-- sync horizon): what the worker's `ops-monitor` job last measured and since when each
-- check is in its status. Platform-wide aggregates only: counts, ages and queue names,
-- never a club, a player or anything of the `medical` schema.
--
-- It lives in the `ops` schema of 0051_restore_drills (B-702), without USAGE for any
-- connection role: only the SECURITY DEFINER functions below reach it (the worker writes,
-- the API reads). Like 0004 it must run as a superuser or a role with BYPASSRLS (the owner
-- of the functions).
CREATE TYPE "ops"."check_status" AS ENUM ('ok', 'warning', 'critical', 'unknown');
--> statement-breakpoint
CREATE TABLE "ops"."check_state" (
  "code" text PRIMARY KEY NOT NULL,
  "status" "ops"."check_status" NOT NULL,
  -- `NULL`: the source could not be measured (status `unknown`).
  "value" double precision,
  -- Breakdown of the value (per queue), never ids of a club or a person.
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status_since" timestamp with time zone NOT NULL,
  "checked_at" timestamp with time zone NOT NULL,
  -- Last time a failing status was announced (Sentry); NULL while ok.
  "notified_at" timestamp with time zone,
  CONSTRAINT "check_state_code" CHECK ("code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "check_state_detail" CHECK (jsonb_typeof("detail") = 'object' AND pg_column_size("detail") <= 8192),
  CONSTRAINT "check_state_value" CHECK ("value" IS NULL OR ("value" >= 0 AND "value" < 'Infinity'::double precision)),
  CONSTRAINT "check_state_unknown" CHECK (("status" = 'unknown') = ("value" IS NULL)),
  CONSTRAINT "check_state_since" CHECK ("status_since" <= "checked_at")
);
--> statement-breakpoint
-- No policy: nobody but the owner (BYPASSRLS) reads or writes it, through the functions.
ALTER TABLE "ops"."check_state" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ops"."check_state" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "ops"."check_state" FROM PUBLIC;
--> statement-breakpoint

-- The backlog of the worker's own tables, across clubs: the oldest pending recalculation
-- (the outbox of ADR 0046) and the reports, exports and deliveries that failed since
-- `failed_since`. Counts and ages only. Worker only.
CREATE FUNCTION "app"."worker_ops_backlog"(failed_since timestamp with time zone)
RETURNS TABLE (
  derived_refresh_pending_n bigint,
  derived_refresh_oldest_s double precision,
  reports_failed_n bigint,
  exports_failed_n bigint,
  notifications_failed_n bigint
)
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT
    (SELECT count(*) FROM "public"."derived_refresh"),
    (SELECT extract(epoch FROM now() - min(r.requested_at))::double precision
       FROM "public"."derived_refresh" r),
    (SELECT count(*) FROM "public"."player_report" p
      WHERE p.status = 'failed' AND p.updated_at >= failed_since)
      + (SELECT count(*) FROM "public"."category_report" c
          WHERE c.status = 'failed' AND c.updated_at >= failed_since),
    (SELECT count(*) FROM "public"."club_data_export" e
      WHERE e.status = 'failed' AND e.completed_at >= failed_since),
    (SELECT count(*) FROM "public"."notification" n
      WHERE n.status = 'failed' AND n.updated_at >= failed_since)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."worker_ops_backlog"(timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."worker_ops_backlog"(timestamp with time zone) TO "sport_performance_worker";
--> statement-breakpoint

-- Records one pass of the monitor: one element per check, `{code, status, value, detail}`.
-- A check whose status changed starts a new `status_since`; checks the pass no longer
-- reports (a definition removed) are deleted. Returns each check with its previous status
-- and whether to announce it now: a failing status (warning, critical) that is new, that
-- changed, or that was last announced before `renotify_after` ago. Announcing is the
-- caller's job; `notified_at` is stamped here, in the same statement, so two passes never
-- announce the same thing twice. Worker only.
CREATE FUNCTION "app"."worker_record_ops_checks"(checks jsonb, renotify_after interval)
RETURNS TABLE (
  code text,
  status text,
  previous_status text,
  status_since timestamp with time zone,
  notify boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  item record;
  previous record;
  announce boolean;
BEGIN
  IF jsonb_typeof(checks) IS DISTINCT FROM 'array' OR jsonb_array_length(checks) > 100 THEN
    RAISE EXCEPTION 'checks must be an array of at most 100 checks' USING ERRCODE = '22023';
  END IF;
  IF renotify_after IS NULL OR renotify_after < interval '1 minute' THEN
    RAISE EXCEPTION 'renotify_after must be at least one minute' USING ERRCODE = '22023';
  END IF;
  FOR item IN
    SELECT x.code, x.status::"ops"."check_status" AS status, x.value,
           coalesce(x.detail, '{}'::jsonb) AS detail
      FROM jsonb_to_recordset(checks) AS x(code text, status text, value double precision, detail jsonb)
     ORDER BY x.code
  LOOP
    SELECT s.status, s.status_since, s.notified_at INTO previous
      FROM "ops"."check_state" s WHERE s.code = item.code FOR UPDATE;
    announce := item.status IN ('warning', 'critical')
      AND (previous.status IS DISTINCT FROM item.status
           OR previous.notified_at IS NULL
           OR previous.notified_at <= now() - renotify_after);
    INSERT INTO "ops"."check_state" AS s
      (code, status, value, detail, status_since, checked_at, notified_at)
    VALUES (item.code, item.status, item.value, item.detail, now(), now(),
            CASE WHEN announce THEN now() END)
    ON CONFLICT ON CONSTRAINT "check_state_pkey" DO UPDATE SET
      status = EXCLUDED.status,
      value = EXCLUDED.value,
      detail = EXCLUDED.detail,
      checked_at = EXCLUDED.checked_at,
      status_since = CASE WHEN s.status = EXCLUDED.status THEN s.status_since ELSE EXCLUDED.status_since END,
      notified_at = CASE
        WHEN EXCLUDED.status NOT IN ('warning', 'critical') THEN NULL
        WHEN announce THEN EXCLUDED.checked_at
        ELSE s.notified_at
      END;
    code := item.code;
    status := item.status::text;
    previous_status := previous.status::text;
    status_since := CASE WHEN previous.status = item.status THEN previous.status_since ELSE now() END;
    notify := announce;
    RETURN NEXT;
  END LOOP;
  DELETE FROM "ops"."check_state" s
   WHERE s.code <> ALL (ARRAY(SELECT jsonb_array_elements(checks) ->> 'code'));
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."worker_record_ops_checks"(jsonb, interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."worker_record_ops_checks"(jsonb, interval) TO "sport_performance_worker";
--> statement-breakpoint

-- What the API's `/health/ops` serves: the state of every check as the worker last
-- recorded it (the API derives the heartbeat from `checked_at`). API only.
CREATE FUNCTION "app"."ops_status"()
RETURNS TABLE (
  code text,
  status text,
  value double precision,
  detail jsonb,
  status_since timestamp with time zone,
  checked_at timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT s.code, s.status::text, s.value, s.detail, s.status_since, s.checked_at
    FROM "ops"."check_state" s
   ORDER BY s.code
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."ops_status"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."ops_status"() TO "sport_performance_app";
