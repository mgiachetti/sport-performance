-- Hand-written migration (ADR 0004, ADR 0023): keeps `updated_at` current on every
-- update, also for raw SQL and bulk updates that bypass the ORM. `updated_at` is the
-- server's audit time; client-side ordering for offline sync uses HLC (B-323).
--
-- Every new table with an `updated_at` column must attach this trigger in its own
-- migration; an integration test fails otherwise.
CREATE FUNCTION "public"."set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "user_set_updated_at" BEFORE UPDATE ON "user" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "session_set_updated_at" BEFORE UPDATE ON "session" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "account_set_updated_at" BEFORE UPDATE ON "account" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "verification_set_updated_at" BEFORE UPDATE ON "verification" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "club_set_updated_at" BEFORE UPDATE ON "club" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "membership_set_updated_at" BEFORE UPDATE ON "membership" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "season_set_updated_at" BEFORE UPDATE ON "season" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "category_set_updated_at" BEFORE UPDATE ON "category" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "position_set_updated_at" BEFORE UPDATE ON "position" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "staff_assignment_set_updated_at" BEFORE UPDATE ON "staff_assignment" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "player_set_updated_at" BEFORE UPDATE ON "player" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "player_category_set_updated_at" BEFORE UPDATE ON "player_category" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "guardian_set_updated_at" BEFORE UPDATE ON "guardian" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "consent_set_updated_at" BEFORE UPDATE ON "consent" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "player_stage_set_updated_at" BEFORE UPDATE ON "player_stage" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "metric_definition_set_updated_at" BEFORE UPDATE ON "metric_definition" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "test_definition_set_updated_at" BEFORE UPDATE ON "test_definition" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "test_definition_metric_set_updated_at" BEFORE UPDATE ON "test_definition_metric" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "battery_config_set_updated_at" BEFORE UPDATE ON "battery_config" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "reference_value_set_updated_at" BEFORE UPDATE ON "reference_value" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "speed_zone_config_set_updated_at" BEFORE UPDATE ON "speed_zone_config" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "device_set_updated_at" BEFORE UPDATE ON "device" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "test_window_set_updated_at" BEFORE UPDATE ON "test_window" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "test_session_set_updated_at" BEFORE UPDATE ON "test_session" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "test_result_set_updated_at" BEFORE UPDATE ON "test_result" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "test_result_value_set_updated_at" BEFORE UPDATE ON "test_result_value" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "anthro_measurement_set_updated_at" BEFORE UPDATE ON "anthro_measurement" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "training_session_set_updated_at" BEFORE UPDATE ON "training_session" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "drill_set_updated_at" BEFORE UPDATE ON "drill" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "participation_set_updated_at" BEFORE UPDATE ON "participation" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "wellness_set_updated_at" BEFORE UPDATE ON "wellness" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "external_metric_set_updated_at" BEFORE UPDATE ON "external_metric" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "gym_program_set_updated_at" BEFORE UPDATE ON "gym_program" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "gym_set_set_updated_at" BEFORE UPDATE ON "gym_set" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "alert_rule_set_updated_at" BEFORE UPDATE ON "alert_rule" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "alert_set_updated_at" BEFORE UPDATE ON "alert" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
