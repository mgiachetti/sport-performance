ALTER TABLE "test_result" ADD COLUMN "exercise" text;--> statement-breakpoint
ALTER TABLE "test_result_value" ADD COLUMN "entry_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "test_result_value" ADD COLUMN "inputs" jsonb;--> statement-breakpoint
ALTER TABLE "test_session" ADD COLUMN "evaluator_id" text;--> statement-breakpoint
ALTER TABLE "test_session" ADD CONSTRAINT "test_session_evaluator_id_user_id_fk" FOREIGN KEY ("evaluator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_result_value_entry_idx" ON "test_result_value" USING btree ("club_id","test_result_id","entry_id");--> statement-breakpoint
CREATE INDEX "test_session_evaluator_id_idx" ON "test_session" USING btree ("evaluator_id");--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_exercise_format" CHECK ("test_result"."exercise" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' and char_length("test_result"."exercise") <= 64 and strpos(replace("test_result"."exercise", '_', ''), 'playerload') = 0);--> statement-breakpoint
ALTER TABLE "test_result_value" ADD CONSTRAINT "test_result_value_inputs_object" CHECK ("test_result_value"."inputs" is null or jsonb_typeof("test_result_value"."inputs") = 'object');--> statement-breakpoint

-- ─── Hand-written (B-320, ADR 0039) ──────────────────────────────────────────────────
-- The raw entry of a value (`entry_id`, `inputs`) is part of the value: frozen by the
-- append-only guard like the rest (0003). Same function, two more columns.
CREATE OR REPLACE FUNCTION "public"."test_result_value_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.club_id, NEW.test_result_id, NEW.metric_definition_id, NEW.attempt_number,
        NEW.entry_id, NEW.inputs, NEW.value, NEW.unit, NEW.recorded_at, NEW.created_at,
        NEW.client_uuid)
       IS DISTINCT FROM
       (OLD.id, OLD.club_id, OLD.test_result_id, OLD.metric_definition_id, OLD.attempt_number,
        OLD.entry_id, OLD.inputs, OLD.value, OLD.unit, OLD.recorded_at, OLD.created_at,
        OLD.client_uuid)
       OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL) THEN
      RAISE EXCEPTION 'test_result_value is append-only: void the value and insert a new one'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'test_result_value_append_only',
              TABLE = 'test_result_value';
    END IF;
    IF OLD.voided_at IS NOT NULL AND (
         (NEW.voided_at, NEW.void_reason) IS DISTINCT FROM (OLD.voided_at, OLD.void_reason)
         OR (NEW.voided_by IS DISTINCT FROM OLD.voided_by AND NEW.voided_by IS NOT NULL)) THEN
      RAISE EXCEPTION 'A voided test_result_value cannot be changed or restored'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'test_result_value_void_final',
              TABLE = 'test_result_value';
    END IF;
  END IF;
  IF NEW.voided_at IS NOT NULL AND NEW.voided_by IS NULL
     AND (TG_OP = 'INSERT' OR OLD.voided_at IS NULL) THEN
    RAISE EXCEPTION 'Voiding a test_result_value requires voided_by'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'test_result_value_void_author',
            TABLE = 'test_result_value';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- `secure_club_table` (0004) granted UPDATE on the columns that existed then. The new
-- editable columns get the same grant; `entry_id` and `inputs` of a value stay frozen
-- (no UPDATE grant, and the guard above).
GRANT UPDATE ("evaluator_id") ON "public"."test_session" TO "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint
GRANT UPDATE ("exercise") ON "public"."test_result" TO "sport_performance_app", "sport_performance_worker";
