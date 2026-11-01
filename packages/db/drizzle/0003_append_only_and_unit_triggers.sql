-- Hand-written migration (ADR 0015, ADR 0023): invariants that a CHECK cannot express
-- because they compare a row with its previous version or with another table.

-- test_result_value is append-only. After the insert only the void (`voided_*`) and the
-- audit columns (`updated_*`) may change; `created_by` may only become NULL, which is
-- what `ON DELETE SET NULL` does when the author's account is deleted. A void is final:
-- once voided, `voided_at` and `void_reason` never change and `voided_by` may only
-- become NULL for the same reason. A new void needs its author.
CREATE FUNCTION "public"."test_result_value_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.club_id, NEW.test_result_id, NEW.metric_definition_id, NEW.attempt_number,
        NEW.value, NEW.unit, NEW.recorded_at, NEW.created_at, NEW.client_uuid)
       IS DISTINCT FROM
       (OLD.id, OLD.club_id, OLD.test_result_id, OLD.metric_definition_id, OLD.attempt_number,
        OLD.value, OLD.unit, OLD.recorded_at, OLD.created_at, OLD.client_uuid)
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
CREATE TRIGGER "test_result_value_guard" BEFORE INSERT OR UPDATE ON "test_result_value" FOR EACH ROW EXECUTE FUNCTION "public"."test_result_value_guard"();
--> statement-breakpoint
-- A measured or reference value is stored with its unit (principle 4), and that unit
-- must be the unit of its metric when the row is written. Later changes to
-- metric_definition.unit do not rewrite history: old rows keep the unit they were
-- recorded in, and conversions are explicit. A missing metric is left to the foreign key.
CREATE FUNCTION "public"."unit_matches_metric"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  metric_unit "public"."unit";
BEGIN
  SELECT m.unit INTO metric_unit
    FROM "public"."metric_definition" m
   WHERE m.club_id = NEW.club_id AND m.id = NEW.metric_definition_id;
  IF FOUND AND metric_unit IS DISTINCT FROM NEW.unit THEN
    RAISE EXCEPTION 'unit % does not match the unit % of metric %', NEW.unit, metric_unit,
      NEW.metric_definition_id
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_unit_matches_metric',
            TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "test_result_value_unit_matches_metric" BEFORE INSERT OR UPDATE OF "unit", "metric_definition_id" ON "test_result_value" FOR EACH ROW EXECUTE FUNCTION "public"."unit_matches_metric"();--> statement-breakpoint
CREATE TRIGGER "reference_value_unit_matches_metric" BEFORE INSERT OR UPDATE OF "unit", "metric_definition_id" ON "reference_value" FOR EACH ROW EXECUTE FUNCTION "public"."unit_matches_metric"();--> statement-breakpoint
CREATE TRIGGER "external_metric_unit_matches_metric" BEFORE INSERT OR UPDATE OF "unit", "metric_definition_id" ON "external_metric" FOR EACH ROW EXECUTE FUNCTION "public"."unit_matches_metric"();
