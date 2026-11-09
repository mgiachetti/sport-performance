CREATE TYPE "public"."pod_metric_config_verification" AS ENUM('unverified', 'club_openfield');--> statement-breakpoint
CREATE TYPE "public"."reference_vmax_source" AS ENUM('pod_rolling_max', 'sprint_40');--> statement-breakpoint
CREATE TABLE "pod_metric_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"sport" "sport",
	"sex" "sex",
	"algorithm_version" text NOT NULL,
	"params" jsonb NOT NULL,
	"verification" "pod_metric_config_verification" DEFAULT 'unverified' NOT NULL,
	"notes" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"archived_at" timestamp with time zone,
	CONSTRAINT "pod_metric_config_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "pod_metric_config_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "pod_metric_config_validity" CHECK ("pod_metric_config"."valid_to" is null or "pod_metric_config"."valid_to" > "pod_metric_config"."valid_from"),
	CONSTRAINT "pod_metric_config_params_object" CHECK (jsonb_typeof("pod_metric_config"."params") = 'object'),
	CONSTRAINT "pod_metric_config_algorithm_version" CHECK ("pod_metric_config"."algorithm_version" ~ '^[a-z][a-z0-9-]*/[0-9]+$'),
	CONSTRAINT "pod_metric_config_notes" CHECK ("pod_metric_config"."notes" is null or char_length("pod_metric_config"."notes") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "pod_metric_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"training_session_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"method_variant" "pod_method_variant" NOT NULL,
	"algorithm_version" text NOT NULL,
	"pod_metric_config_id" uuid,
	"definition_hash" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"pod_raw_upload_ids" uuid[] NOT NULL,
	"firmware_versions" text[] NOT NULL,
	"gnss_firmware_versions" text[] NOT NULL,
	"session_vmax_ms" double precision,
	"reference_vmax_ms" double precision,
	"reference_vmax_source" "reference_vmax_source",
	"stats" jsonb NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pod_metric_run_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "pod_metric_run_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "pod_metric_run_hashes" CHECK ("pod_metric_run"."definition_hash" ~ '^[0-9a-f]{64}$' and "pod_metric_run"."inputs_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pod_metric_run_algorithm_version" CHECK (char_length("pod_metric_run"."algorithm_version") between 1 and 64),
	CONSTRAINT "pod_metric_run_reference" CHECK (("pod_metric_run"."reference_vmax_ms" is null) = ("pod_metric_run"."reference_vmax_source" is null)
          and ("pod_metric_run"."reference_vmax_ms" is null or "pod_metric_run"."reference_vmax_ms" > 0)
          and ("pod_metric_run"."session_vmax_ms" is null or "pod_metric_run"."session_vmax_ms" >= 0)),
	CONSTRAINT "pod_metric_run_stats_object" CHECK (jsonb_typeof("pod_metric_run"."stats") = 'object')
);
--> statement-breakpoint
ALTER TABLE "external_metric" ADD COLUMN "method_variant" "pod_method_variant";--> statement-breakpoint
ALTER TABLE "external_metric" ADD COLUMN "algorithm_version" text;--> statement-breakpoint
ALTER TABLE "external_metric" ADD COLUMN "pod_metric_run_id" uuid;--> statement-breakpoint
ALTER TABLE "pod_metric_config" ADD CONSTRAINT "pod_metric_config_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_metric_config" ADD CONSTRAINT "pod_metric_config_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_metric_config" ADD CONSTRAINT "pod_metric_config_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_metric_run" ADD CONSTRAINT "pod_metric_run_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_metric_run" ADD CONSTRAINT "pod_metric_run_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_metric_run" ADD CONSTRAINT "pod_metric_run_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_metric_run" ADD CONSTRAINT "pod_metric_run_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_metric_run" ADD CONSTRAINT "pod_metric_run_training_session_id_fkey" FOREIGN KEY ("club_id","training_session_id") REFERENCES "public"."training_session"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_metric_run" ADD CONSTRAINT "pod_metric_run_pod_metric_config_id_fkey" FOREIGN KEY ("club_id","pod_metric_config_id") REFERENCES "public"."pod_metric_config"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pod_metric_config_lookup_idx" ON "pod_metric_config" USING btree ("club_id","valid_from");--> statement-breakpoint
CREATE INDEX "pod_metric_run_pod_metric_config_id_idx" ON "pod_metric_run" USING btree ("club_id","pod_metric_config_id") WHERE "pod_metric_run"."pod_metric_config_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pod_metric_run_key" ON "pod_metric_run" USING btree ("club_id","player_id","training_session_id","method_variant");--> statement-breakpoint
CREATE INDEX "pod_metric_run_session_idx" ON "pod_metric_run" USING btree ("club_id","training_session_id");--> statement-breakpoint
CREATE INDEX "pod_metric_run_player_date_idx" ON "pod_metric_run" USING btree ("club_id","player_id","local_date");--> statement-breakpoint
ALTER TABLE "external_metric" ADD CONSTRAINT "external_metric_pod_metric_run_id_fkey" FOREIGN KEY ("club_id","pod_metric_run_id") REFERENCES "public"."pod_metric_run"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_metric_pod_metric_run_id_idx" ON "external_metric" USING btree ("club_id","pod_metric_run_id") WHERE "external_metric"."pod_metric_run_id" is not null;--> statement-breakpoint
DO $$
BEGIN
  -- Pod values written before this migration would have no variant: none should exist (the
  -- worker writes them from here on). Fail loudly instead of inventing their method.
  IF EXISTS (SELECT 1 FROM "public"."external_metric" WHERE "source" = 'pod') THEN
    RAISE EXCEPTION 'external_metric has pod values without a method variant: review them before 0056';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "external_metric" ADD CONSTRAINT "external_metric_pod_method" CHECK (("external_metric"."source" = 'pod') = ("external_metric"."method_variant" is not null)
          and ("external_metric"."method_variant" is null) = ("external_metric"."algorithm_version" is null)
          and ("external_metric"."pod_metric_run_id" is null or "external_metric"."method_variant" is not null));--> statement-breakpoint

-- ─── Hand-written: triggers, RLS, grants and data (B-919, ADR 0110) ─────────────────
CREATE TRIGGER "pod_metric_config_set_updated_at" BEFORE UPDATE ON "pod_metric_config" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "pod_metric_run_set_updated_at" BEFORE UPDATE ON "pod_metric_run" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- pod_metric_config: club configuration like the speed zones (every member reads it; S&C and
--   the administration write it, ADR 0041). No player data.
-- pod_metric_run: how a player's pod values were computed, read like the values themselves
--   (external_metric). The worker writes, recomputes and deletes it; the application never
--   writes it. No history: the values it explains are in external_metric, which has it.
DO $$
DECLARE
  member constant text := '(SELECT "app"."current_role"()) IS NOT NULL';
  player_scope constant text := '((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.pod_metric_config', member, '{sc,admin,superadmin}');
  PERFORM "app_admin"."secure_club_table"('public.pod_metric_run', player_scope, '{}');
END
$$;
--> statement-breakpoint
REVOKE UPDATE ON "public"."pod_metric_run" FROM "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint
GRANT UPDATE ("local_date", "algorithm_version", "pod_metric_config_id", "definition_hash", "inputs_hash",
              "pod_raw_upload_ids", "firmware_versions", "gnss_firmware_versions", "session_vmax_ms",
              "reference_vmax_ms", "reference_vmax_source", "stats", "stale", "computed_at",
              "updated_at", "updated_by")
  ON "public"."pod_metric_run" TO "sport_performance_worker";
--> statement-breakpoint
GRANT DELETE ON "public"."pod_metric_run" TO "sport_performance_worker";
--> statement-breakpoint

-- external_metric: the pod's values carry their variant, algorithm and run. Only the worker
-- writes them: the application inserts and edits Catapult, band and manual values, never a
-- pod one. The worker deletes a pod value its definitions no longer give (a reference Vmax
-- gone, an assignment corrected after the trim), never one of another source.
GRANT UPDATE ("method_variant", "algorithm_version", "pod_metric_run_id")
  ON "public"."external_metric" TO "sport_performance_worker";
--> statement-breakpoint
REVOKE UPDATE ("method_variant", "algorithm_version", "pod_metric_run_id")
  ON "public"."external_metric" FROM "sport_performance_app";
--> statement-breakpoint
GRANT DELETE ON "public"."external_metric" TO "sport_performance_worker";
--> statement-breakpoint
CREATE POLICY "external_metric_worker_delete_pod" ON "public"."external_metric" AS RESTRICTIVE
  FOR DELETE TO "sport_performance_worker"
  USING (source = 'pod');
--> statement-breakpoint
CREATE POLICY "external_metric_app_insert_not_pod" ON "public"."external_metric" AS RESTRICTIVE
  FOR INSERT TO "sport_performance_app"
  WITH CHECK (source <> 'pod');
--> statement-breakpoint
CREATE POLICY "external_metric_app_update_not_pod" ON "public"."external_metric" AS RESTRICTIVE
  FOR UPDATE TO "sport_performance_app"
  USING (source <> 'pod') WITH CHECK (source <> 'pod');
--> statement-breakpoint

-- Clubs whose pod metrics may need work, for the worker's sweep (only ids, like
-- app.worker_pod_raw_clubs()): a player's trace in a session (the input of a run) or a run
-- marked stale by a correction. Worker only.
CREATE FUNCTION "app"."worker_pod_metric_clubs"() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT t.club_id FROM "public"."pod_trace_segment" t
  UNION
  SELECT r.club_id FROM "public"."pod_metric_run" r WHERE r.stale
  ORDER BY 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."worker_pod_metric_clubs"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."worker_pod_metric_clubs"() TO "sport_performance_worker";
--> statement-breakpoint

-- Data for the clubs bootstrapped before (ADR 0027: a reviewed migration, never a re-seed).
-- The literals are the domain constants (CANONICAL_METRICS.sprints_n and sprint_dist_m,
-- DEFAULT_CATAPULT_ALIASES, DEFAULT_POD_METRIC_PARAMS, POD_METRICS_ALGORITHM_VERSION,
-- DEFAULT_SEED_VALID_FROM); a unit test keeps them in step. New clubs get the same rows from
-- bootstrapClub. Unverified: replaced with the first team's OpenField settings (B-002).
INSERT INTO "public"."metric_definition" ("club_id", "code", "unit", "source", "direction", "description", "catapult_aliases", "is_canonical")
SELECT c."id", m."code", m."unit"::"public"."unit", 'field'::"public"."metric_source", m."direction"::"public"."metric_direction", m."description", m."aliases", true
  FROM "public"."club" c
 CROSS JOIN (VALUES
   ('sprints_n', 'n', 'neutral', 'Sprint efforts: at or above the sprint zone for the dwell time.', ARRAY['Sprint Efforts', 'Sprint Count']::text[]),
   ('sprint_dist_m', 'm', 'higher_is_better', 'Distance covered inside sprint efforts.', ARRAY['Sprint Distance']::text[])
 ) AS m("code", "unit", "direction", "description", "aliases")
ON CONFLICT ("club_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "public"."pod_metric_config" ("club_id", "sport", "sex", "algorithm_version", "params", "verification", "notes", "valid_from")
SELECT c."id", NULL, NULL, 'pod-metrics/1',
       '{"accelLoad":{"maxGapS":0.05,"sampleRateHz":100,"scale":0.01},"accelerationFilterS":0.3,"accelerations":{"minDwellS":0.5,"thresholdMs2":2},"decelerations":{"minDwellS":0.5,"thresholdMs2":2},"impacts":{"minSeparationS":1,"sports":["rugby"],"thresholdG":8},"live":{"bandZoneCodes":["jogging","running","high_speed_running","sprinting"],"rules":[{"code":"pace_drop","enabled":true,"kind":"pace_drop","params":{"atOrBelowPctOfPeak":60,"minPlayedS":900,"windowS":300},"severity":"info","sports":null},{"code":"match_average_high","enabled":true,"kind":"match_average_high","params":{"atOrAbovePct":130,"metrics":["hsr_abs_m","sprints_n","acc_n"],"minMatches":3,"minPlayedS":600},"severity":"warning","sports":null},{"code":"speed_near_vmax","enabled":true,"kind":"speed_near_vmax","params":{"atOrAbovePct":95,"windowS":60},"severity":"info","sports":null},{"code":"rhie_rugby","enabled":true,"kind":"repeated_high_intensity","params":{"atOrAboveBouts":2,"maxRecoveryS":21,"minEfforts":3,"requireContact":true,"windowS":600},"severity":"warning","sports":["rugby"]},{"code":"rhie_hockey","enabled":true,"kind":"repeated_high_intensity","params":{"atOrAboveBouts":2,"maxRecoveryS":21,"minEfforts":3,"requireContact":false,"windowS":600},"severity":"warning","sports":["hockey"]}]},"plausibility":{"acceptedFixQualities":["fix_3d","dgnss","rtk_float","rtk_fixed"],"maxAccelerationMs2":10,"maxGapS":1,"maxHorizontalAccuracyM":5,"maxSpeedAccuracyMs":1,"maxSpeedMs":12.5,"minChainS":0.5},"referenceVmax":{"podMaxAboveSprint40Pct":115,"podMinSessions":3,"podWindowDays":180,"sources":["pod_rolling_max","sprint_40"],"sprint40MaxAgeDays":365},"speedFilterS":0.3,"sprints":{"minDwellS":1,"zoneCode":"sprinting"},"vmaxWindowS":1}'::jsonb,
       'unverified',
       'Valores por defecto (convenciones publicadas de OpenField), sin verificar: reemplazar con la configuración de OpenField de primera (B-002).',
       DATE '2000-01-01'
  FROM "public"."club" c
 WHERE NOT EXISTS (SELECT 1 FROM "public"."pod_metric_config" p WHERE p."club_id" = c."id");
