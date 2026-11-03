CREATE TYPE "public"."gym_load_kind" AS ENUM('external', 'bodyweight', 'bodyweight_plus');--> statement-breakpoint
ALTER TYPE "public"."sync_collection" ADD VALUE 'gym_program';--> statement-breakpoint
ALTER TYPE "public"."sync_collection" ADD VALUE 'gym_set';--> statement-breakpoint
ALTER TYPE "public"."sync_operation" ADD VALUE 'gym_set.log';--> statement-breakpoint
ALTER TYPE "public"."sync_operation" ADD VALUE 'gym_set.correct';--> statement-breakpoint
ALTER TYPE "public"."sync_operation" ADD VALUE 'gym_set.void';--> statement-breakpoint
ALTER TABLE "gym_program" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_set" ADD COLUMN "day_key" text;--> statement-breakpoint
ALTER TABLE "gym_set" ADD COLUMN "load_kind" "gym_load_kind";--> statement-breakpoint
-- Sets logged before the load kind was kept (none through the API): a load means an external one.
UPDATE "gym_set" SET "load_kind" = CASE WHEN "load_kg" IS NULL THEN 'bodyweight'::"gym_load_kind" ELSE 'external'::"gym_load_kind" END;--> statement-breakpoint
ALTER TABLE "gym_set" ALTER COLUMN "load_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_set" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_set" ADD COLUMN "voided_by" text;--> statement-breakpoint
ALTER TABLE "gym_set" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "gym_set" ADD CONSTRAINT "gym_set_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_set_voided_by_idx" ON "gym_set" USING btree ("voided_by");--> statement-breakpoint
ALTER TABLE "gym_program" ADD CONSTRAINT "gym_program_target" CHECK (num_nonnulls("gym_program"."category_id", "gym_program"."player_id") = 1);--> statement-breakpoint
ALTER TABLE "gym_program" ADD CONSTRAINT "gym_program_stage_target" CHECK ("gym_program"."stage" is null or "gym_program"."category_id" is not null);--> statement-breakpoint
ALTER TABLE "gym_program" ADD CONSTRAINT "gym_program_name" CHECK (char_length("gym_program"."name") between 1 and 80);--> statement-breakpoint
ALTER TABLE "gym_program" ADD CONSTRAINT "gym_program_plan_object" CHECK (jsonb_typeof("gym_program"."plan") = 'object');--> statement-breakpoint
ALTER TABLE "gym_set" ADD CONSTRAINT "gym_set_load_kind" CHECK (("gym_set"."load_kind" = 'bodyweight') = ("gym_set"."load_kg" is null));--> statement-breakpoint
ALTER TABLE "gym_set" ADD CONSTRAINT "gym_set_day_key" CHECK ("gym_set"."day_key" is null or "gym_set"."gym_program_id" is not null);--> statement-breakpoint
ALTER TABLE "gym_set" ADD CONSTRAINT "gym_set_void" CHECK (("gym_set"."voided_at" is null) = ("gym_set"."void_reason" is null));--> statement-breakpoint
ALTER TABLE "gym_set" ADD CONSTRAINT "gym_set_voided_by" CHECK ("gym_set"."voided_at" is not null or "gym_set"."voided_by" is null);--> statement-breakpoint

-- ─── Hand-written (B-607, ADR 0075) ──────────────────────────────────────────────────
-- Columns added after `secure_club_table` granted UPDATE: the same grant for the new ones.
GRANT UPDATE ("archived_at") ON "public"."gym_program" TO "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint
GRANT UPDATE ("day_key", "load_kind", "voided_at", "voided_by", "void_reason") ON "public"."gym_set"
  TO "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint

-- Offline sync (ADR 0050): the sets are player rows edited per field on the phone (the reps,
-- the load, the RIR, the technique score, the time and the notes); the programs are read-only
-- on the phone and logged by the player they are for (`NULL` for a category's program).
-- No rows exist before this migration (the API is their first writer), so there is nothing to
-- enter in the log: the new enum values cannot be used in this transaction anyway.
CREATE TRIGGER "gym_set_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "public"."gym_set"
  FOR EACH ROW EXECUTE FUNCTION "public"."sync_change_record"('gym_set', 'id', 'player_id', 'reps,load_kg,rir,technique_score,duration_s,notes');
--> statement-breakpoint
CREATE TRIGGER "gym_program_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "public"."gym_program"
  FOR EACH ROW EXECUTE FUNCTION "public"."sync_change_record"('gym_program', 'id', 'player_id', '');
--> statement-breakpoint

-- The entries of a category's program (no player) are visible to every member, as the program
-- itself is (`gym_program_app_select`): the pull filters them by the scope of the matrix. The
-- rest stays as in 0025. `collection::text`: the new value cannot be used in this transaction.
ALTER POLICY "sync_change_app_select" ON "public"."sync_change" USING (
  (SELECT "app"."current_role"()) IS NOT NULL AND (CASE
    WHEN collection IN ('training_session', 'test_session')
      THEN ((SELECT "app"."sees_whole_club"()) OR category_id = ANY ((SELECT "app"."assigned_category_ids"())::uuid[]))
    WHEN collection::text = 'gym_program' AND player_id IS NULL THEN true
    ELSE ((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))
  END));
--> statement-breakpoint

-- The push locks the sets it edits, as the other rows with field clocks.
CREATE OR REPLACE FUNCTION "app"."sync_lock_rows"(target_collection text, ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  club uuid := "app"."current_club_id"();
BEGIN
  IF "app"."current_role"() IS NULL OR club IS NULL THEN
    RAISE EXCEPTION 'sync_lock_rows needs a validated role' USING ERRCODE = 'insufficient_privilege';
  END IF;
  CASE target_collection
    WHEN 'wellness' THEN
      PERFORM 1 FROM "public"."wellness" t WHERE t.club_id = club AND t.id = ANY (ids)
        ORDER BY t.id FOR NO KEY UPDATE;
    WHEN 'participation' THEN
      PERFORM 1 FROM "public"."participation" t WHERE t.club_id = club AND t.id = ANY (ids)
        ORDER BY t.id FOR NO KEY UPDATE;
    WHEN 'test_result' THEN
      PERFORM 1 FROM "public"."test_result" t WHERE t.club_id = club AND t.id = ANY (ids)
        ORDER BY t.id FOR NO KEY UPDATE;
    WHEN 'gym_set' THEN
      PERFORM 1 FROM "public"."gym_set" t WHERE t.club_id = club AND t.id = ANY (ids)
        ORDER BY t.id FOR NO KEY UPDATE;
    ELSE
      RAISE EXCEPTION 'not a collection with field clocks' USING ERRCODE = 'invalid_parameter_value';
  END CASE;
END;
$$;
