-- Female thresholds (B-804, ADR 0088): explicit data migration of the defaults that
-- changed for clubs bootstrapped before (ADR 0027: changing a default for existing clubs
-- is a reviewed migration, never a re-seed). New clubs get the same rows from
-- `bootstrapClub`. The literals below are the domain constants (`DEFAULT_ALERT_RULES`,
-- `DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES`, `DEFAULT_ABSOLUTE_SPEED_ZONES`,
-- `DEFAULT_SEED_VALID_FROM`); a unit test keeps them
-- in step. Thresholds are unverified: verify against the papers before production.
--
-- 1. The growth rule applies to boys only, where the club still has it as seeded (no
--    scope, the seeded parameters). A rule the club edited is left as it is.
UPDATE "public"."alert_rule"
   SET "sexes" = ARRAY['male']::"public"."sex"[]
 WHERE "code" = 'growth_peak'
   AND "kind" = 'growth_peak'
   AND "sports" IS NULL
   AND "sexes" IS NULL
   AND "stages" IS NULL
   AND "params" = '{"warningAtOrAboveCmYear":7.2,"criticalAtOrAboveCmYear":null,"maxMeasurementAgeDays":120}'::jsonb;
--> statement-breakpoint
-- 2. The growth rule for girls, in every club with a growth rule. Enabled only where the
--    growth rule now covers boys alone and is enabled; otherwise (the club edited or
--    disabled it) it starts disabled, so no girl gets two growth alerts for one
--    measurement and the staff decide.
INSERT INTO "public"."alert_rule" ("club_id", "code", "kind", "enabled", "sexes", "params")
SELECT g."club_id",
       'growth_peak_female',
       'growth_peak',
       g."enabled" AND g."sexes" IS NOT DISTINCT FROM ARRAY['male']::"public"."sex"[],
       ARRAY['female']::"public"."sex"[],
       '{"warningAtOrAboveCmYear":6,"criticalAtOrAboveCmYear":null,"maxMeasurementAgeDays":120}'::jsonb
  FROM "public"."alert_rule" g
 WHERE g."code" = 'growth_peak'
ON CONFLICT ("club_id", "code") DO NOTHING;
--> statement-breakpoint
-- 3. Absolute speed zones for women (any sport, no player) in every club with a women's
--    branch and no such row yet (current, closed or archived), from the same first day as
--    the seeded club-wide zones. Only where the club still has the seeded club-wide
--    absolute zones: a sex-scoped row outranks a club-wide one, so a club that replaced
--    them with its own bands keeps those bands for its women too (the staff can add the
--    women's zones by hand).
INSERT INTO "public"."speed_zone_config" ("club_id", "sport", "sex", "player_id", "kind", "zone_set", "valid_from")
SELECT DISTINCT b."club_id",
       NULL::"public"."sport",
       'female'::"public"."sex",
       NULL::uuid,
       'absolute'::"public"."speed_zone_kind",
       '{"kind":"absolute","zones":[{"code":"walking","minSpeedMs":0},{"code":"jogging","minSpeedMs":2},{"code":"running","minSpeedMs":3.47},{"code":"high_speed_running","minSpeedMs":5.28},{"code":"sprinting","minSpeedMs":6.25}],"highSpeedZoneCode":"high_speed_running"}'::jsonb,
       DATE '2000-01-01'
  FROM "public"."club_branch" b
 WHERE b."sex" = 'female'
   AND b."archived_at" IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM "public"."speed_zone_config" z
      WHERE z."club_id" = b."club_id"
        AND z."sport" IS NULL
        AND z."sex" = 'female'
        AND z."player_id" IS NULL
        AND z."kind" = 'absolute'
   )
   AND NOT EXISTS (
     SELECT 1
       FROM "public"."speed_zone_config" c
      WHERE c."club_id" = b."club_id"
        AND c."sport" IS NULL
        AND c."sex" IS NULL
        AND c."player_id" IS NULL
        AND c."kind" = 'absolute'
        AND c."archived_at" IS NULL
        AND c."zone_set" <> '{"kind":"absolute","zones":[{"code":"walking","minSpeedMs":0},{"code":"jogging","minSpeedMs":2},{"code":"running","minSpeedMs":4},{"code":"high_speed_running","minSpeedMs":5.5},{"code":"sprinting","minSpeedMs":7}],"highSpeedZoneCode":"high_speed_running"}'::jsonb
   );
