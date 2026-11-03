-- Reads of the player profile (B-404, ADR 0060) that the caller's row-level scope cannot
-- answer by itself: the anonymous comparison group of a player's test results (percentiles
-- and the category average by window) and the history of the derived availability. Both are
-- SECURITY DEFINER entry points with a pinned search_path, executable only by the API, that
-- check the subject is visible to the validated context and never return identities of
-- other players nor the cause of an unavailability.

-- ─── app.percentile_samples: the comparison group of one player, anonymous ──────────────
-- Valid (not voided) values of the done results of the club measured in [from_date, to_date],
-- of the metrics asked for, of players of the subject's sport, placed as the percentile
-- engine of the domain needs them (B-208): protocol version and exercise (strength: a metric
-- of two exercises is two comparisons), sex, age band of the category the player was in on
-- the day of the result (same sport), main position and its line, season year (the season of
-- the sport that covers the day, else the calendar year) and test window (the test day's, else
-- the window of that season covering the day; archived seasons and windows do not count).
-- Players and results are numbered with keys that only mean something inside this call
-- (`player_key` is a rank by a hash with the request id, so it changes on every request);
-- `is_subject` marks the subject's own rows. `sexes` and
-- `age_band_codes` (NULL: all) narrow the group when every grouping the caller tries matches
-- them, so a request reads one category's history and not the whole club's. `only_subject`
-- returns only the subject's rows, placed the same way (a read of the player's own series
-- does not need the group).
--
-- The caller must see the subject (`app.visible_player_ids`, or the whole club for the
-- administration); a guardian never compares (the matrix gives `percentile` and
-- `group_reference` to the staff and the player only). The other players' values only leave
-- the API as aggregates (percentile, median, mean of a group of a minimum size).
CREATE FUNCTION "app"."percentile_samples"(
  subject uuid, metric_codes text[], from_date date, to_date date,
  sexes "public"."sex"[] DEFAULT NULL, age_band_codes text[] DEFAULT NULL,
  only_subject boolean DEFAULT false
) RETURNS TABLE (
  player_key integer,
  is_subject boolean,
  result_key integer,
  test_code text,
  protocol_version integer,
  exercise text,
  metric_code text,
  direction "public"."metric_direction",
  attempt_aggregation "public"."attempt_aggregation",
  sex "public"."sex",
  age_band_code text,
  position_code text,
  line_code text,
  measured_on date,
  season_year integer,
  test_window_id uuid,
  method "public"."measurement_method",
  attempt_number smallint,
  value double precision
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  club constant uuid := "app"."current_club_id"();
  ctx_role constant text := "app"."current_role"();
  request constant text := "app"."current_request_id"();
  subject_sport "public"."sport";
BEGIN
  IF club IS NULL OR ctx_role IS NULL OR request IS NULL THEN
    RAISE EXCEPTION 'Comparison groups need a validated tenant context within a request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF ctx_role NOT IN ('player', 'coach', 'sc', 'medical', 'admin', 'superadmin') THEN
    RAISE EXCEPTION 'The % role cannot read comparison groups', ctx_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT ("app"."sees_whole_club"() OR subject = ANY ("app"."visible_player_ids"())) THEN
    RAISE EXCEPTION 'The subject of the comparison is not visible'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF from_date IS NULL OR to_date IS NULL OR to_date < from_date THEN
    RAISE EXCEPTION 'Invalid range of days' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT p.sport INTO subject_sport FROM "public"."player" p
   WHERE p.club_id = club AND p.id = subject;
  IF subject_sport IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH results AS (
    SELECT r.id, r.player_id, r.measured_on, r.method, r.test_session_id, r.exercise,
           d.code AS test_code, d.version AS protocol_version, d.attempt_aggregation, p.sex
      FROM "public"."test_result" r
      JOIN "public"."test_definition" d ON d.club_id = r.club_id AND d.id = r.test_definition_id
      JOIN "public"."player" p ON p.club_id = r.club_id AND p.id = r.player_id
     WHERE r.club_id = club AND r.status = 'done'
       AND r.measured_on BETWEEN from_date AND to_date
       AND p.sport = subject_sport
       AND (sexes IS NULL OR p.sex = ANY (sexes))
       AND (NOT coalesce(only_subject, false) OR r.player_id = subject)
  ), placed AS (
    SELECT r.*, cat.age_band_code, pos.code AS position_code, pos.line_code,
           coalesce(extract(year FROM sea.starts_on)::integer,
                    extract(year FROM r.measured_on)::integer) AS season_year,
           coalesce(tw.id, win.id) AS test_window_id
      FROM results r
      JOIN LATERAL (
        SELECT c.age_band_code FROM "public"."player_category" pc
          JOIN "public"."category" c ON c.club_id = pc.club_id AND c.id = pc.category_id
         WHERE pc.club_id = club AND pc.player_id = r.player_id AND c.sport = subject_sport
           AND pc.valid_from <= r.measured_on
           AND (pc.valid_to IS NULL OR pc.valid_to > r.measured_on)
         ORDER BY c.sort_order, c.id LIMIT 1
      ) cat ON true
      LEFT JOIN LATERAL (
        SELECT po.code, po.line_code FROM "public"."player_position" pp
          JOIN "public"."position" po ON po.club_id = pp.club_id AND po.id = pp.position_id
         WHERE pp.club_id = club AND pp.player_id = r.player_id AND po.sport = subject_sport
         ORDER BY pp.sort_order LIMIT 1
      ) pos ON true
      LEFT JOIN LATERAL (
        SELECT s.id, s.starts_on FROM "public"."season" s
         WHERE s.club_id = club AND s.sport = subject_sport AND s.archived_at IS NULL
           AND s.starts_on <= r.measured_on AND s.ends_on >= r.measured_on
         ORDER BY s.starts_on DESC, s.id LIMIT 1
      ) sea ON true
      LEFT JOIN "public"."test_session" ts ON ts.club_id = club AND ts.id = r.test_session_id
      LEFT JOIN "public"."test_window" tw
        ON tw.club_id = club AND tw.id = ts.test_window_id AND tw.archived_at IS NULL
      LEFT JOIN LATERAL (
        SELECT w.id FROM "public"."test_window" w
         WHERE w.club_id = club AND w.season_id = sea.id AND w.archived_at IS NULL
           AND w.starts_on <= r.measured_on AND w.ends_on >= r.measured_on
         ORDER BY w.number LIMIT 1
      ) win ON true
     WHERE age_band_codes IS NULL OR cat.age_band_code = ANY (age_band_codes)
  )
  SELECT dense_rank() OVER (ORDER BY md5(pl.player_id::text || ':' || request))::integer,
         pl.player_id = subject,
         dense_rank() OVER (ORDER BY pl.id)::integer,
         pl.test_code, pl.protocol_version, pl.exercise, m.code, m.direction,
         pl.attempt_aggregation, pl.sex, pl.age_band_code, pl.position_code, pl.line_code, pl.measured_on, pl.season_year, pl.test_window_id,
         pl.method, v.attempt_number, v.value
    FROM placed pl
    JOIN "public"."test_result_value" v
      ON v.club_id = club AND v.test_result_id = pl.id AND v.voided_at IS NULL
    JOIN "public"."metric_definition" m
      ON m.club_id = v.club_id AND m.id = v.metric_definition_id AND m.code = ANY (metric_codes);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."percentile_samples"(uuid, text[], date, date, "public"."sex"[], text[], boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."percentile_samples"(uuid, text[], date, date, "public"."sex"[], text[], boolean) TO "sport_performance_app";
--> statement-breakpoint

-- ─── medical.availability_history: the derived status day by day, never the cause ──────
-- The same rules as `medical.availability` (blocks in force and not lifted that club day,
-- concussions not cleared by their latest stage) for one player on every day of
-- [from_date, to_date] (at most 731 days). One `read` row in the access log per call. No
-- notes, no diagnosis, no cause: only training, match and the worst of both.
CREATE FUNCTION "medical"."availability_history"(player uuid, from_date date, to_date date)
RETURNS TABLE (
  on_date date,
  training "medical"."availability_status",
  "match" "medical"."availability_status",
  overall "medical"."availability_status"
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  scope uuid[] := "medical"."readable_players"('availability', ARRAY[player]);
  club constant uuid := "app"."current_club_id"();
  club_zone text := (SELECT c.time_zone FROM "public"."club" c WHERE c.id = club);
BEGIN
  IF from_date IS NULL OR to_date IS NULL OR to_date < from_date OR to_date - from_date > 730 THEN
    RAISE EXCEPTION 'Invalid range of days (at most 731)' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM "medical"."log_read"('availability', ARRAY[player],
    scope, ARRAY(SELECT NULL::uuid FROM unnest(scope)));
  IF NOT (player = ANY (scope)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT d::date AS day FROM generate_series(from_date, to_date, interval '1 day') AS d
  ), statuses AS (
    SELECT days.day,
           greatest(coalesce(h.training, 'available'), coalesce(c.training, 'available')) AS training,
           greatest(coalesce(h."match", 'available'),
                    CASE WHEN c.n = 0 THEN 'available' ELSE 'unavailable' END::"medical"."availability_status") AS "match"
      FROM days
      CROSS JOIN LATERAL (
        SELECT max(hh.training) AS training, max(hh."match") AS "match"
          FROM "medical"."hold" hh
         WHERE hh.club_id = club AND hh.player_id = player
           AND hh.valid_from <= days.day AND (hh.valid_to IS NULL OR hh.valid_to > days.day)
           AND (hh.lifted_at IS NULL OR (hh.lifted_at AT TIME ZONE club_zone)::date > days.day)
      ) h
      CROSS JOIN LATERAL (
        SELECT count(*) AS n,
               max(CASE WHEN ls.stage IS NULL OR ls.stage = 1 OR ls.outcome = 'symptomatic'
                        THEN 'unavailable' ELSE 'limited' END::"medical"."availability_status") AS training
          FROM "medical"."concussion" cc
          LEFT JOIN LATERAL (
            SELECT s.stage, s.outcome FROM "medical"."concussion_stage" s
             WHERE s.club_id = cc.club_id AND s.concussion_id = cc.id AND s.started_on <= days.day
             ORDER BY s.started_on DESC, s.created_at DESC LIMIT 1
          ) ls ON true
         WHERE cc.club_id = club AND cc.player_id = player
           AND cc.occurred_on <= days.day AND (cc.cleared_on IS NULL OR cc.cleared_on > days.day)
      ) c
  )
  SELECT s.day, s.training, s."match", greatest(s.training, s."match")
    FROM statuses s ORDER BY s.day;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "medical"."availability_history"(uuid, date, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "medical"."availability_history"(uuid, date, date) TO "sport_performance_app";
