CREATE TYPE "public"."alert_rule_kind" AS ENUM('acwr_high', 'acwr_low', 'wellness_low', 'wellness_zscore_low', 'cmj_drop', 'growth_peak');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('open', 'acknowledged', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."attempt_aggregation" AS ENUM('best', 'mean');--> statement-breakpoint
CREATE TYPE "public"."consent_signer" AS ENUM('guardian', 'player');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('data', 'image', 'health');--> statement-breakpoint
CREATE TYPE "public"."contact_level" AS ENUM('none', 'controlled', 'full');--> statement-breakpoint
CREATE TYPE "public"."device_kind" AS ENUM('phone', 'tablet', 'hr_band', 'photocell', 'reaction_lights', 'dynamometer', 'pod', 'gps_vest');--> statement-breakpoint
CREATE TYPE "public"."dominant_side" AS ENUM('left', 'right', 'both');--> statement-breakpoint
CREATE TYPE "public"."external_metric_source" AS ENUM('catapult', 'pod', 'hr_band', 'manual');--> statement-breakpoint
CREATE TYPE "public"."guardian_relationship" AS ENUM('mother', 'father', 'legal_guardian', 'other');--> statement-breakpoint
CREATE TYPE "public"."height_source" AS ENUM('measured', 'reported');--> statement-breakpoint
CREATE TYPE "public"."maturity_offset_equation" AS ENUM('mirwald_2002', 'moore_2015', 'moore_2015_height');--> statement-breakpoint
CREATE TYPE "public"."measurement_method" AS ENUM('manual', 'video', 'photocell', 'pod', 'app', 'historical');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('player', 'parent', 'coach', 'sc', 'medical', 'admin');--> statement-breakpoint
CREATE TYPE "public"."metric_direction" AS ENUM('higher_is_better', 'lower_is_better', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."metric_source" AS ENUM('field', 'test', 'load');--> statement-breakpoint
CREATE TYPE "public"."participation_status" AS ENUM('full', 'partial', 'absent', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('training', 'match');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."speed_zone_kind" AS ENUM('absolute', 'relative');--> statement-breakpoint
CREATE TYPE "public"."sport" AS ENUM('rugby', 'hockey');--> statement-breakpoint
CREATE TYPE "public"."stage_basis" AS ENUM('manual', 'maturation', 'category');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('foundation', 'development', 'performance');--> statement-breakpoint
CREATE TYPE "public"."stage_reason" AS ENUM('pinned', 'no_maturation_estimate', 'maturation_estimate_stale', 'maturation_estimate_after_date', 'maturation_matches_category', 'within_uncertainty_margin', 'maturation_disabled', 'maturation_shift', 'maturation_shift_capped');--> statement-breakpoint
CREATE TYPE "public"."test_not_done_reason" AS ENUM('absent', 'injured', 'not_applicable_to_stage', 'other');--> statement-breakpoint
CREATE TYPE "public"."test_result_status" AS ENUM('done', 'not_done');--> statement-breakpoint
CREATE TYPE "public"."test_session_status" AS ENUM('scheduled', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."unit" AS ENUM('mm', 'cm', 'm', 'km', 'kg', 'msec', 's', 'min', 'h', 'years', 'ms', 'kmh', 'm_min', 'cm_year', 'ms2', 'newton', 'deg', 'bpm', 'kg_kg', 'pct', 'au', 'score', 'n');--> statement-breakpoint
CREATE TABLE "club" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"time_zone" text DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	CONSTRAINT "club_slug_unique" UNIQUE("slug"),
	CONSTRAINT "club_client_uuid_key" UNIQUE("client_uuid"),
	CONSTRAINT "club_slug_format" CHECK ("club"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_superadmin" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"sport" "sport" NOT NULL,
	"sex" "sex" NOT NULL,
	"age_band_code" text NOT NULL,
	"name" text NOT NULL,
	"default_stage" "stage" NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "category_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "category_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "category_club_id_sport_sex_name_key" UNIQUE("club_id","sport","sex","name"),
	CONSTRAINT "category_age_band_code_format" CHECK ("category"."age_band_code" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' and char_length("category"."age_band_code") <= 64 and strpos(replace("category"."age_band_code", '_', ''), 'playerload') = 0)
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"invited_by" text,
	CONSTRAINT "membership_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "membership_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "membership_period" CHECK ("membership"."ended_at" is null or "membership"."ended_at" > "membership"."started_at")
);
--> statement-breakpoint
CREATE TABLE "position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"sport" "sport" NOT NULL,
	"code" text NOT NULL,
	"label" text,
	"line_code" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "position_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "position_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "position_club_id_sport_code_key" UNIQUE("club_id","sport","code"),
	CONSTRAINT "position_code_format" CHECK ("position"."code" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' and char_length("position"."code") <= 64 and strpos(replace("position"."code", '_', ''), 'playerload') = 0),
	CONSTRAINT "position_line_code_format" CHECK ("position"."line_code" is null or "position"."line_code" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "season" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"sport" "sport" NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	CONSTRAINT "season_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "season_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "season_club_id_sport_name_key" UNIQUE("club_id","sport","name"),
	CONSTRAINT "season_span" CHECK ("season"."ends_on" >= "season"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "staff_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"category_id" uuid,
	"sport" "sport",
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "staff_assignment_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "staff_assignment_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "staff_assignment_one_target" CHECK (num_nonnulls("staff_assignment"."category_id", "staff_assignment"."sport") = 1),
	CONSTRAINT "staff_assignment_validity" CHECK ("staff_assignment"."valid_to" is null or "staff_assignment"."valid_to" > "staff_assignment"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"type" "consent_type" NOT NULL,
	"document_version" text NOT NULL,
	"signer_kind" "consent_signer" NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "consent_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "consent_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "consent_revocation" CHECK (("consent"."revoked_at" is null) = ("consent"."revoked_by" is null) and ("consent"."revoked_at" is null or "consent"."revoked_at" >= "consent"."signed_at"))
);
--> statement-breakpoint
CREATE TABLE "guardian" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"relationship" "guardian_relationship" NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "guardian_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "guardian_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "guardian_validity" CHECK ("guardian"."valid_to" is null or "guardian"."valid_to" > "guardian"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "player" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"birth_date" date NOT NULL,
	"sex" "sex" NOT NULL,
	"position_id" uuid,
	"dominant_side" "dominant_side",
	"mother_height_cm" double precision,
	"mother_height_source" "height_source",
	"father_height_cm" double precision,
	"father_height_source" "height_source",
	"joined_on" date NOT NULL,
	"left_on" date,
	CONSTRAINT "player_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "player_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "player_mother_height" CHECK (("player"."mother_height_cm" is null) = ("player"."mother_height_source" is null) and ("player"."mother_height_cm" is null or ("player"."mother_height_cm" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player"."mother_height_cm" > 0))),
	CONSTRAINT "player_father_height" CHECK (("player"."father_height_cm" is null) = ("player"."father_height_source" is null) and ("player"."father_height_cm" is null or ("player"."father_height_cm" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player"."father_height_cm" > 0))),
	CONSTRAINT "player_membership_period" CHECK ("player"."left_on" is null or "player"."left_on" >= "player"."joined_on")
);
--> statement-breakpoint
CREATE TABLE "player_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"season_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "player_category_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "player_category_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "player_category_validity" CHECK ("player_category"."valid_to" is null or "player_category"."valid_to" > "player_category"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "player_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"stage" "stage" NOT NULL,
	"basis" "stage_basis" NOT NULL,
	"reason" "stage_reason" NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"phv_offset_years" double precision,
	"note" text,
	CONSTRAINT "player_stage_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "player_stage_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "player_stage_manual_is_pinned" CHECK (("player_stage"."basis" = 'manual') = ("player_stage"."reason" = 'pinned')),
	CONSTRAINT "player_stage_phv_offset_finite" CHECK ("player_stage"."phv_offset_years" is null or "player_stage"."phv_offset_years" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)),
	CONSTRAINT "player_stage_validity" CHECK ("player_stage"."valid_to" is null or "player_stage"."valid_to" > "player_stage"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "battery_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"sport" "sport" NOT NULL,
	"sex" "sex",
	"stage" "stage",
	"category_id" uuid,
	"test_code" text NOT NULL,
	"windows" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"cadence_weeks_min" smallint,
	"cadence_weeks_max" smallint,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "battery_config_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "battery_config_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "battery_config_test_code_format" CHECK ("battery_config"."test_code" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' and char_length("battery_config"."test_code") <= 64 and strpos(replace("battery_config"."test_code", '_', ''), 'playerload') = 0),
	CONSTRAINT "battery_config_windows" CHECK ("battery_config"."windows" <@ '{1,2,3,4}'::smallint[] and array_position("battery_config"."windows", null) is null),
	CONSTRAINT "battery_config_cadence" CHECK (("battery_config"."cadence_weeks_min" is null) = ("battery_config"."cadence_weeks_max" is null) and ("battery_config"."cadence_weeks_min" is null or ("battery_config"."cadence_weeks_min" >= 1 and "battery_config"."cadence_weeks_max" >= "battery_config"."cadence_weeks_min"))),
	CONSTRAINT "battery_config_scheduled" CHECK (cardinality("battery_config"."windows") > 0 or "battery_config"."cadence_weeks_min" is not null),
	CONSTRAINT "battery_config_validity" CHECK ("battery_config"."valid_to" is null or "battery_config"."valid_to" > "battery_config"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" "device_kind" NOT NULL,
	"label" text NOT NULL,
	"model" text,
	"serial_number" text,
	"firmware_version" text,
	"retired_at" timestamp with time zone,
	CONSTRAINT "device_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "device_club_id_client_uuid_key" UNIQUE("club_id","client_uuid")
);
--> statement-breakpoint
CREATE TABLE "metric_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"unit" "unit" NOT NULL,
	"source" "metric_source" NOT NULL,
	"direction" "metric_direction" NOT NULL,
	"test_code" text,
	"sports" "sport"[],
	"description" text,
	"catapult_aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_canonical" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "metric_definition_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "metric_definition_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "metric_definition_club_id_code_key" UNIQUE("club_id","code"),
	CONSTRAINT "metric_definition_code_format" CHECK ("metric_definition"."code" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' and char_length("metric_definition"."code") <= 64 and strpos(replace("metric_definition"."code", '_', ''), 'playerload') = 0),
	CONSTRAINT "metric_definition_test_code" CHECK (("metric_definition"."source" = 'test') = ("metric_definition"."test_code" is not null)),
	CONSTRAINT "metric_definition_sports_not_empty" CHECK ("metric_definition"."sports" is null or cardinality("metric_definition"."sports") > 0)
);
--> statement-breakpoint
CREATE TABLE "reference_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"metric_definition_id" uuid NOT NULL,
	"sport" "sport" NOT NULL,
	"sex" "sex" NOT NULL,
	"position_id" uuid,
	"line_code" text,
	"value" double precision NOT NULL,
	"unit" "unit" NOT NULL,
	"method" "measurement_method",
	"valid_from" date NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "reference_value_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "reference_value_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "reference_value_value_finite" CHECK ("reference_value"."value" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)),
	CONSTRAINT "reference_value_one_scope" CHECK (num_nonnulls("reference_value"."position_id", "reference_value"."line_code") <= 1)
);
--> statement-breakpoint
CREATE TABLE "speed_zone_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"sport" "sport",
	"sex" "sex",
	"player_id" uuid,
	"kind" "speed_zone_kind" NOT NULL,
	"zone_set" jsonb NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "speed_zone_config_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "speed_zone_config_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "speed_zone_config_kind_matches" CHECK ("speed_zone_config"."zone_set" ->> 'kind' = "speed_zone_config"."kind"::text),
	CONSTRAINT "speed_zone_config_validity" CHECK ("speed_zone_config"."valid_to" is null or "speed_zone_config"."valid_to" > "speed_zone_config"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "test_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer NOT NULL,
	"sports" "sport"[],
	"attempt_count" smallint DEFAULT 1 NOT NULL,
	"attempt_aggregation" "attempt_aggregation" DEFAULT 'best' NOT NULL,
	"maximal_load" boolean DEFAULT false NOT NULL,
	"protocol" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "test_definition_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "test_definition_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "test_definition_club_id_code_version_key" UNIQUE("club_id","code","version"),
	CONSTRAINT "test_definition_code_format" CHECK ("test_definition"."code" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' and char_length("test_definition"."code") <= 64 and strpos(replace("test_definition"."code", '_', ''), 'playerload') = 0),
	CONSTRAINT "test_definition_version_positive" CHECK ("test_definition"."version" >= 1),
	CONSTRAINT "test_definition_attempt_count_positive" CHECK ("test_definition"."attempt_count" >= 1),
	CONSTRAINT "test_definition_sports_not_empty" CHECK ("test_definition"."sports" is null or cardinality("test_definition"."sports") > 0),
	CONSTRAINT "test_definition_validity" CHECK ("test_definition"."valid_to" is null or "test_definition"."valid_to" > "test_definition"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "test_definition_metric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"test_definition_id" uuid NOT NULL,
	"metric_definition_id" uuid NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_derived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "test_definition_metric_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "test_definition_metric_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "test_definition_metric_key" UNIQUE("club_id","test_definition_id","metric_definition_id")
);
--> statement-breakpoint
CREATE TABLE "anthro_measurement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"test_session_id" uuid,
	"measured_on" date NOT NULL,
	"height_cm" double precision,
	"sitting_height_cm" double precision,
	"weight_kg" double precision,
	"skinfolds_sum_mm" double precision,
	"method" "measurement_method" DEFAULT 'manual' NOT NULL,
	"evaluator_id" text,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"phv_offset_years" double precision,
	"maturity_offset_equation" "maturity_offset_equation",
	"adult_height_pct" double precision,
	"derived_at" timestamp with time zone,
	CONSTRAINT "anthro_measurement_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "anthro_measurement_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "anthro_measurement_has_value" CHECK (num_nonnulls("anthro_measurement"."height_cm", "anthro_measurement"."sitting_height_cm", "anthro_measurement"."weight_kg", "anthro_measurement"."skinfolds_sum_mm") >= 1),
	CONSTRAINT "anthro_measurement_positive" CHECK (("anthro_measurement"."height_cm" is null or ("anthro_measurement"."height_cm" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "anthro_measurement"."height_cm" > 0)) and ("anthro_measurement"."sitting_height_cm" is null or ("anthro_measurement"."sitting_height_cm" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "anthro_measurement"."sitting_height_cm" > 0)) and ("anthro_measurement"."weight_kg" is null or ("anthro_measurement"."weight_kg" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "anthro_measurement"."weight_kg" > 0)) and ("anthro_measurement"."skinfolds_sum_mm" is null or ("anthro_measurement"."skinfolds_sum_mm" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "anthro_measurement"."skinfolds_sum_mm" > 0))),
	CONSTRAINT "anthro_measurement_sitting_below_height" CHECK ("anthro_measurement"."height_cm" is null or "anthro_measurement"."sitting_height_cm" is null or "anthro_measurement"."sitting_height_cm" < "anthro_measurement"."height_cm"),
	CONSTRAINT "anthro_measurement_maturation" CHECK (("anthro_measurement"."phv_offset_years" is null) = ("anthro_measurement"."maturity_offset_equation" is null))
);
--> statement-breakpoint
CREATE TABLE "test_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"test_definition_id" uuid NOT NULL,
	"test_session_id" uuid,
	"measured_on" date NOT NULL,
	"status" "test_result_status" NOT NULL,
	"not_done_reason" "test_not_done_reason",
	"not_done_note" text,
	"method" "measurement_method",
	"evaluator_id" text,
	"device_id" uuid,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	CONSTRAINT "test_result_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "test_result_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "test_result_status" CHECK (("test_result"."status" = 'done' and "test_result"."not_done_reason" is null and "test_result"."method" is not null) or ("test_result"."status" = 'not_done' and "test_result"."not_done_reason" is not null)),
	CONSTRAINT "test_result_other_reason_note" CHECK ("test_result"."not_done_reason" is distinct from 'other' or char_length(btrim(coalesce("test_result"."not_done_note", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "test_result_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"test_result_id" uuid NOT NULL,
	"metric_definition_id" uuid NOT NULL,
	"attempt_number" smallint,
	"value" double precision NOT NULL,
	"unit" "unit" NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "test_result_value_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "test_result_value_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "test_result_value_value_finite" CHECK ("test_result_value"."value" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)),
	CONSTRAINT "test_result_value_attempt_number" CHECK ("test_result_value"."attempt_number" is null or "test_result_value"."attempt_number" >= 1),
	CONSTRAINT "test_result_value_void" CHECK (("test_result_value"."voided_at" is null) = ("test_result_value"."void_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "test_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"sport" "sport" NOT NULL,
	"test_window_id" uuid,
	"category_id" uuid,
	"scheduled_on" date NOT NULL,
	"status" "test_session_status" DEFAULT 'scheduled' NOT NULL,
	"location" text,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "test_session_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "test_session_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "test_session_completion" CHECK ("test_session"."completed_at" is null or ("test_session"."started_at" is not null and "test_session"."completed_at" >= "test_session"."started_at"))
);
--> statement-breakpoint
CREATE TABLE "test_window" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	CONSTRAINT "test_window_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "test_window_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "test_window_club_id_season_id_number_key" UNIQUE("club_id","season_id","number"),
	CONSTRAINT "test_window_number" CHECK ("test_window"."number" between 1 and 4),
	CONSTRAINT "test_window_span" CHECK ("test_window"."ends_on" >= "test_window"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "drill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"training_session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"duration_min" smallint,
	"contact_level" "contact_level" DEFAULT 'none' NOT NULL,
	"notes" text,
	CONSTRAINT "drill_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "drill_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "drill_duration" CHECK ("drill"."duration_min" is null or "drill"."duration_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "external_metric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"training_session_id" uuid,
	"drill_id" uuid,
	"metric_definition_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"value" double precision NOT NULL,
	"unit" "unit" NOT NULL,
	"source" "external_metric_source" NOT NULL,
	"device_id" uuid,
	"external_ref" text,
	"import_id" uuid,
	CONSTRAINT "external_metric_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "external_metric_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "external_metric_value_finite" CHECK ("external_metric"."value" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8))
);
--> statement-breakpoint
CREATE TABLE "gym_program" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"player_id" uuid,
	"stage" "stage",
	"plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "gym_program_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "gym_program_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "gym_program_validity" CHECK ("gym_program"."valid_to" is null or "gym_program"."valid_to" > "gym_program"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "gym_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"gym_program_id" uuid,
	"performed_on" date NOT NULL,
	"exercise_code" text NOT NULL,
	"set_number" smallint NOT NULL,
	"reps" smallint,
	"load_kg" double precision,
	"rir" smallint,
	"technique_score" smallint,
	"duration_s" integer,
	"notes" text,
	CONSTRAINT "gym_set_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "gym_set_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "gym_set_exercise_code_format" CHECK ("gym_set"."exercise_code" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' and char_length("gym_set"."exercise_code") <= 64 and strpos(replace("gym_set"."exercise_code", '_', ''), 'playerload') = 0),
	CONSTRAINT "gym_set_set_number" CHECK ("gym_set"."set_number" >= 1),
	CONSTRAINT "gym_set_reps" CHECK ("gym_set"."reps" is null or "gym_set"."reps" >= 0),
	CONSTRAINT "gym_set_load" CHECK ("gym_set"."load_kg" is null or ("gym_set"."load_kg" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "gym_set"."load_kg" >= 0)),
	CONSTRAINT "gym_set_rir" CHECK ("gym_set"."rir" is null or "gym_set"."rir" between 0 and 10),
	CONSTRAINT "gym_set_technique_score" CHECK ("gym_set"."technique_score" is null or "gym_set"."technique_score" between 1 and 3),
	CONSTRAINT "gym_set_duration" CHECK ("gym_set"."duration_s" is null or "gym_set"."duration_s" > 0),
	CONSTRAINT "gym_set_has_value" CHECK (num_nonnulls("gym_set"."reps", "gym_set"."duration_s") >= 1)
);
--> statement-breakpoint
CREATE TABLE "participation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"training_session_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"status" "participation_status" NOT NULL,
	"minutes" smallint,
	"contacts_n" smallint,
	"rpe" smallint,
	"rpe_reported_at" timestamp with time zone,
	"srpe_au" integer GENERATED ALWAYS AS ("rpe"::integer * "minutes") STORED,
	CONSTRAINT "participation_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "participation_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "participation_club_id_session_player_key" UNIQUE("club_id","training_session_id","player_id"),
	CONSTRAINT "participation_rpe" CHECK ("participation"."rpe" is null or "participation"."rpe" between 0 and 10),
	CONSTRAINT "participation_minutes" CHECK ("participation"."minutes" is null or "participation"."minutes" between 0 and 600),
	CONSTRAINT "participation_contacts" CHECK ("participation"."contacts_n" is null or "participation"."contacts_n" >= 0),
	CONSTRAINT "participation_absent_has_no_load" CHECK ("participation"."status" not in ('absent', 'unavailable') or (coalesce("participation"."minutes", 0) = 0 and "participation"."rpe" is null)),
	CONSTRAINT "participation_rpe_reported" CHECK (("participation"."rpe" is null) = ("participation"."rpe_reported_at" is null))
);
--> statement-breakpoint
CREATE TABLE "training_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"sport" "sport" NOT NULL,
	"kind" "session_kind" NOT NULL,
	"category_id" uuid,
	"title" text,
	"starts_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"planned_duration_min" smallint,
	"location" text,
	"opponent" text,
	"notes" text,
	CONSTRAINT "training_session_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "training_session_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "training_session_planned_duration" CHECK ("training_session"."planned_duration_min" is null or "training_session"."planned_duration_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "wellness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"item_count" smallint NOT NULL,
	"sleep" smallint,
	"fatigue" smallint,
	"soreness" smallint,
	"stress" smallint,
	"mood" smallint,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wellness_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "wellness_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "wellness_club_id_player_id_local_date_key" UNIQUE("club_id","player_id","local_date"),
	CONSTRAINT "wellness_item_count" CHECK ("wellness"."item_count" in (3, 5)),
	CONSTRAINT "wellness_answered_items" CHECK (num_nonnulls("wellness"."sleep", "wellness"."fatigue", "wellness"."soreness", "wellness"."stress", "wellness"."mood") = "wellness"."item_count"),
	CONSTRAINT "wellness_sleep" CHECK ("wellness"."sleep" is null or "wellness"."sleep" between 1 and 5),
	CONSTRAINT "wellness_fatigue" CHECK ("wellness"."fatigue" is null or "wellness"."fatigue" between 1 and 5),
	CONSTRAINT "wellness_soreness" CHECK ("wellness"."soreness" is null or "wellness"."soreness" between 1 and 5),
	CONSTRAINT "wellness_stress" CHECK ("wellness"."stress" is null or "wellness"."stress" between 1 and 5),
	CONSTRAINT "wellness_mood" CHECK ("wellness"."mood" is null or "wellness"."mood" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"alert_rule_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"kind" "alert_rule_kind" NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"local_date" date NOT NULL,
	"observed_on" date NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"acknowledgement_note" text,
	CONSTRAINT "alert_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "alert_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "alert_club_id_rule_player_day_key" UNIQUE("club_id","alert_rule_id","player_id","local_date"),
	CONSTRAINT "alert_acknowledgement" CHECK (("alert"."status" = 'open') = ("alert"."acknowledged_at" is null))
);
--> statement-breakpoint
CREATE TABLE "alert_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "alert_rule_kind" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sports" "sport"[],
	"sexes" "sex"[],
	"stages" "stage"[],
	"params" jsonb NOT NULL,
	CONSTRAINT "alert_rule_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "alert_rule_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "alert_rule_club_id_code_key" UNIQUE("club_id","code"),
	CONSTRAINT "alert_rule_code_format" CHECK ("alert_rule"."code" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' and char_length("alert_rule"."code") <= 64 and strpos(replace("alert_rule"."code", '_', ''), 'playerload') = 0),
	CONSTRAINT "alert_rule_scope_not_empty" CHECK (("alert_rule"."sports" is null or cardinality("alert_rule"."sports") > 0) and ("alert_rule"."sexes" is null or cardinality("alert_rule"."sexes") > 0) and ("alert_rule"."stages" is null or cardinality("alert_rule"."stages") > 0)),
	CONSTRAINT "alert_rule_params_object" CHECK (jsonb_typeof("alert_rule"."params") = 'object')
);
--> statement-breakpoint
ALTER TABLE "club" ADD CONSTRAINT "club_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club" ADD CONSTRAINT "club_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_membership_id_fkey" FOREIGN KEY ("club_id","membership_id") REFERENCES "public"."membership"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_category_id_fkey" FOREIGN KEY ("club_id","category_id") REFERENCES "public"."category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_signed_by_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player" ADD CONSTRAINT "player_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player" ADD CONSTRAINT "player_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player" ADD CONSTRAINT "player_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player" ADD CONSTRAINT "player_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player" ADD CONSTRAINT "player_position_id_fkey" FOREIGN KEY ("club_id","position_id") REFERENCES "public"."position"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_category" ADD CONSTRAINT "player_category_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_category" ADD CONSTRAINT "player_category_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_category" ADD CONSTRAINT "player_category_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_category" ADD CONSTRAINT "player_category_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_category" ADD CONSTRAINT "player_category_category_id_fkey" FOREIGN KEY ("club_id","category_id") REFERENCES "public"."category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_category" ADD CONSTRAINT "player_category_season_id_fkey" FOREIGN KEY ("club_id","season_id") REFERENCES "public"."season"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stage" ADD CONSTRAINT "player_stage_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stage" ADD CONSTRAINT "player_stage_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stage" ADD CONSTRAINT "player_stage_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stage" ADD CONSTRAINT "player_stage_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battery_config" ADD CONSTRAINT "battery_config_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battery_config" ADD CONSTRAINT "battery_config_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battery_config" ADD CONSTRAINT "battery_config_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battery_config" ADD CONSTRAINT "battery_config_category_id_fkey" FOREIGN KEY ("club_id","category_id") REFERENCES "public"."category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_definition" ADD CONSTRAINT "metric_definition_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_definition" ADD CONSTRAINT "metric_definition_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_definition" ADD CONSTRAINT "metric_definition_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_value" ADD CONSTRAINT "reference_value_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_value" ADD CONSTRAINT "reference_value_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_value" ADD CONSTRAINT "reference_value_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_value" ADD CONSTRAINT "reference_value_metric_definition_id_fkey" FOREIGN KEY ("club_id","metric_definition_id") REFERENCES "public"."metric_definition"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_value" ADD CONSTRAINT "reference_value_position_id_fkey" FOREIGN KEY ("club_id","position_id") REFERENCES "public"."position"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speed_zone_config" ADD CONSTRAINT "speed_zone_config_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speed_zone_config" ADD CONSTRAINT "speed_zone_config_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speed_zone_config" ADD CONSTRAINT "speed_zone_config_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speed_zone_config" ADD CONSTRAINT "speed_zone_config_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_definition" ADD CONSTRAINT "test_definition_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_definition" ADD CONSTRAINT "test_definition_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_definition" ADD CONSTRAINT "test_definition_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_definition_metric" ADD CONSTRAINT "test_definition_metric_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_definition_metric" ADD CONSTRAINT "test_definition_metric_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_definition_metric" ADD CONSTRAINT "test_definition_metric_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_definition_metric" ADD CONSTRAINT "test_definition_metric_test_definition_id_fkey" FOREIGN KEY ("club_id","test_definition_id") REFERENCES "public"."test_definition"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_definition_metric" ADD CONSTRAINT "test_definition_metric_metric_definition_id_fkey" FOREIGN KEY ("club_id","metric_definition_id") REFERENCES "public"."metric_definition"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anthro_measurement" ADD CONSTRAINT "anthro_measurement_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anthro_measurement" ADD CONSTRAINT "anthro_measurement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anthro_measurement" ADD CONSTRAINT "anthro_measurement_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anthro_measurement" ADD CONSTRAINT "anthro_measurement_evaluator_id_user_id_fk" FOREIGN KEY ("evaluator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anthro_measurement" ADD CONSTRAINT "anthro_measurement_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anthro_measurement" ADD CONSTRAINT "anthro_measurement_test_session_id_fkey" FOREIGN KEY ("club_id","test_session_id") REFERENCES "public"."test_session"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_evaluator_id_user_id_fk" FOREIGN KEY ("evaluator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_test_definition_id_fkey" FOREIGN KEY ("club_id","test_definition_id") REFERENCES "public"."test_definition"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_test_session_id_fkey" FOREIGN KEY ("club_id","test_session_id") REFERENCES "public"."test_session"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_device_id_fkey" FOREIGN KEY ("club_id","device_id") REFERENCES "public"."device"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result_value" ADD CONSTRAINT "test_result_value_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result_value" ADD CONSTRAINT "test_result_value_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result_value" ADD CONSTRAINT "test_result_value_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result_value" ADD CONSTRAINT "test_result_value_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result_value" ADD CONSTRAINT "test_result_value_test_result_id_fkey" FOREIGN KEY ("club_id","test_result_id") REFERENCES "public"."test_result"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result_value" ADD CONSTRAINT "test_result_value_metric_definition_id_fkey" FOREIGN KEY ("club_id","metric_definition_id") REFERENCES "public"."metric_definition"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_session" ADD CONSTRAINT "test_session_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_session" ADD CONSTRAINT "test_session_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_session" ADD CONSTRAINT "test_session_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_session" ADD CONSTRAINT "test_session_test_window_id_fkey" FOREIGN KEY ("club_id","test_window_id") REFERENCES "public"."test_window"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_session" ADD CONSTRAINT "test_session_category_id_fkey" FOREIGN KEY ("club_id","category_id") REFERENCES "public"."category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_window" ADD CONSTRAINT "test_window_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_window" ADD CONSTRAINT "test_window_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_window" ADD CONSTRAINT "test_window_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_window" ADD CONSTRAINT "test_window_season_id_fkey" FOREIGN KEY ("club_id","season_id") REFERENCES "public"."season"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drill" ADD CONSTRAINT "drill_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drill" ADD CONSTRAINT "drill_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drill" ADD CONSTRAINT "drill_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drill" ADD CONSTRAINT "drill_training_session_id_fkey" FOREIGN KEY ("club_id","training_session_id") REFERENCES "public"."training_session"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_metric" ADD CONSTRAINT "external_metric_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_metric" ADD CONSTRAINT "external_metric_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_metric" ADD CONSTRAINT "external_metric_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_metric" ADD CONSTRAINT "external_metric_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_metric" ADD CONSTRAINT "external_metric_training_session_id_fkey" FOREIGN KEY ("club_id","training_session_id") REFERENCES "public"."training_session"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_metric" ADD CONSTRAINT "external_metric_drill_id_fkey" FOREIGN KEY ("club_id","drill_id") REFERENCES "public"."drill"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_metric" ADD CONSTRAINT "external_metric_metric_definition_id_fkey" FOREIGN KEY ("club_id","metric_definition_id") REFERENCES "public"."metric_definition"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_metric" ADD CONSTRAINT "external_metric_device_id_fkey" FOREIGN KEY ("club_id","device_id") REFERENCES "public"."device"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_program" ADD CONSTRAINT "gym_program_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_program" ADD CONSTRAINT "gym_program_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_program" ADD CONSTRAINT "gym_program_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_program" ADD CONSTRAINT "gym_program_category_id_fkey" FOREIGN KEY ("club_id","category_id") REFERENCES "public"."category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_program" ADD CONSTRAINT "gym_program_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_set" ADD CONSTRAINT "gym_set_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_set" ADD CONSTRAINT "gym_set_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_set" ADD CONSTRAINT "gym_set_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_set" ADD CONSTRAINT "gym_set_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_set" ADD CONSTRAINT "gym_set_gym_program_id_fkey" FOREIGN KEY ("club_id","gym_program_id") REFERENCES "public"."gym_program"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_training_session_id_fkey" FOREIGN KEY ("club_id","training_session_id") REFERENCES "public"."training_session"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_session" ADD CONSTRAINT "training_session_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_session" ADD CONSTRAINT "training_session_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_session" ADD CONSTRAINT "training_session_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_session" ADD CONSTRAINT "training_session_category_id_fkey" FOREIGN KEY ("club_id","category_id") REFERENCES "public"."category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wellness" ADD CONSTRAINT "wellness_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wellness" ADD CONSTRAINT "wellness_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wellness" ADD CONSTRAINT "wellness_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wellness" ADD CONSTRAINT "wellness_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_acknowledged_by_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_alert_rule_id_fkey" FOREIGN KEY ("club_id","alert_rule_id") REFERENCES "public"."alert_rule"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule" ADD CONSTRAINT "alert_rule_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule" ADD CONSTRAINT "alert_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule" ADD CONSTRAINT "alert_rule_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_active_role_key" ON "membership" USING btree ("club_id","user_id","role") WHERE "membership"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "membership_user_id_idx" ON "membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "staff_assignment_membership_idx" ON "staff_assignment" USING btree ("club_id","membership_id");--> statement-breakpoint
CREATE INDEX "staff_assignment_category_idx" ON "staff_assignment" USING btree ("club_id","category_id");--> statement-breakpoint
CREATE INDEX "consent_player_idx" ON "consent" USING btree ("club_id","player_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_active_key" ON "guardian" USING btree ("club_id","player_id","user_id") WHERE "guardian"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "guardian_user_id_idx" ON "guardian" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "player_position_id_idx" ON "player" USING btree ("club_id","position_id") WHERE "player"."position_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "player_club_id_user_id_key" ON "player" USING btree ("club_id","user_id") WHERE "player"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "player_name_idx" ON "player" USING btree ("club_id","last_name","first_name");--> statement-breakpoint
CREATE INDEX "player_category_season_id_idx" ON "player_category" USING btree ("club_id","season_id") WHERE "player_category"."season_id" is not null;--> statement-breakpoint
CREATE INDEX "player_category_player_idx" ON "player_category" USING btree ("club_id","player_id","valid_from");--> statement-breakpoint
CREATE INDEX "player_category_category_idx" ON "player_category" USING btree ("club_id","category_id");--> statement-breakpoint
CREATE INDEX "player_stage_player_idx" ON "player_stage" USING btree ("club_id","player_id","valid_from");--> statement-breakpoint
CREATE INDEX "battery_config_category_id_idx" ON "battery_config" USING btree ("club_id","category_id") WHERE "battery_config"."category_id" is not null;--> statement-breakpoint
CREATE INDEX "battery_config_scope_idx" ON "battery_config" USING btree ("club_id","sport","test_code");--> statement-breakpoint
CREATE UNIQUE INDEX "device_serial_number_key" ON "device" USING btree ("club_id","kind","serial_number") WHERE "device"."serial_number" is not null;--> statement-breakpoint
CREATE INDEX "reference_value_position_id_idx" ON "reference_value" USING btree ("club_id","position_id") WHERE "reference_value"."position_id" is not null;--> statement-breakpoint
CREATE INDEX "reference_value_lookup_idx" ON "reference_value" USING btree ("club_id","metric_definition_id","sport","sex");--> statement-breakpoint
CREATE INDEX "speed_zone_config_player_id_idx" ON "speed_zone_config" USING btree ("club_id","player_id") WHERE "speed_zone_config"."player_id" is not null;--> statement-breakpoint
CREATE INDEX "speed_zone_config_lookup_idx" ON "speed_zone_config" USING btree ("club_id","kind","valid_from");--> statement-breakpoint
CREATE INDEX "test_definition_metric_metric_definition_id_idx" ON "test_definition_metric" USING btree ("club_id","metric_definition_id") WHERE "test_definition_metric"."metric_definition_id" is not null;--> statement-breakpoint
CREATE INDEX "anthro_measurement_test_session_id_idx" ON "anthro_measurement" USING btree ("club_id","test_session_id") WHERE "anthro_measurement"."test_session_id" is not null;--> statement-breakpoint
CREATE INDEX "anthro_measurement_player_idx" ON "anthro_measurement" USING btree ("club_id","player_id","measured_on");--> statement-breakpoint
CREATE INDEX "test_result_device_id_idx" ON "test_result" USING btree ("club_id","device_id") WHERE "test_result"."device_id" is not null;--> statement-breakpoint
CREATE INDEX "test_result_player_idx" ON "test_result" USING btree ("club_id","player_id","measured_on");--> statement-breakpoint
CREATE INDEX "test_result_session_idx" ON "test_result" USING btree ("club_id","test_session_id");--> statement-breakpoint
CREATE INDEX "test_result_definition_idx" ON "test_result" USING btree ("club_id","test_definition_id","measured_on");--> statement-breakpoint
CREATE INDEX "test_result_value_result_idx" ON "test_result_value" USING btree ("club_id","test_result_id");--> statement-breakpoint
CREATE INDEX "test_result_value_metric_idx" ON "test_result_value" USING btree ("club_id","metric_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_result_value_result_level_key" ON "test_result_value" USING btree ("club_id","test_result_id","metric_definition_id") WHERE "test_result_value"."attempt_number" is null and "test_result_value"."voided_at" is null;--> statement-breakpoint
CREATE INDEX "test_session_test_window_id_idx" ON "test_session" USING btree ("club_id","test_window_id") WHERE "test_session"."test_window_id" is not null;--> statement-breakpoint
CREATE INDEX "test_session_category_id_idx" ON "test_session" USING btree ("club_id","category_id") WHERE "test_session"."category_id" is not null;--> statement-breakpoint
CREATE INDEX "test_session_scheduled_on_idx" ON "test_session" USING btree ("club_id","scheduled_on");--> statement-breakpoint
CREATE INDEX "drill_session_idx" ON "drill" USING btree ("club_id","training_session_id");--> statement-breakpoint
CREATE INDEX "external_metric_drill_id_idx" ON "external_metric" USING btree ("club_id","drill_id") WHERE "external_metric"."drill_id" is not null;--> statement-breakpoint
CREATE INDEX "external_metric_metric_definition_id_idx" ON "external_metric" USING btree ("club_id","metric_definition_id") WHERE "external_metric"."metric_definition_id" is not null;--> statement-breakpoint
CREATE INDEX "external_metric_device_id_idx" ON "external_metric" USING btree ("club_id","device_id") WHERE "external_metric"."device_id" is not null;--> statement-breakpoint
CREATE INDEX "external_metric_player_idx" ON "external_metric" USING btree ("club_id","player_id","local_date");--> statement-breakpoint
CREATE INDEX "external_metric_session_idx" ON "external_metric" USING btree ("club_id","training_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_metric_source_ref_key" ON "external_metric" USING btree ("club_id","source","external_ref","player_id","metric_definition_id") WHERE "external_metric"."external_ref" is not null;--> statement-breakpoint
CREATE INDEX "gym_program_category_idx" ON "gym_program" USING btree ("club_id","category_id");--> statement-breakpoint
CREATE INDEX "gym_program_player_idx" ON "gym_program" USING btree ("club_id","player_id");--> statement-breakpoint
CREATE INDEX "gym_set_gym_program_id_idx" ON "gym_set" USING btree ("club_id","gym_program_id") WHERE "gym_set"."gym_program_id" is not null;--> statement-breakpoint
CREATE INDEX "gym_set_player_idx" ON "gym_set" USING btree ("club_id","player_id","performed_on");--> statement-breakpoint
CREATE INDEX "participation_player_idx" ON "participation" USING btree ("club_id","player_id");--> statement-breakpoint
CREATE INDEX "training_session_local_date_idx" ON "training_session" USING btree ("club_id","local_date");--> statement-breakpoint
CREATE INDEX "training_session_category_idx" ON "training_session" USING btree ("club_id","category_id","local_date");--> statement-breakpoint
CREATE INDEX "alert_status_idx" ON "alert" USING btree ("club_id","status","local_date");--> statement-breakpoint
CREATE INDEX "alert_player_idx" ON "alert" USING btree ("club_id","player_id","local_date");