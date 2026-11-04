ALTER TABLE "participation" DROP CONSTRAINT "participation_absent_has_no_load";--> statement-breakpoint
ALTER TABLE "participation" ADD COLUMN "period_minutes" smallint[];--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_period_minutes" CHECK ("participation"."period_minutes" is null or (
        array_ndims("participation"."period_minutes") = 1
        and array_lower("participation"."period_minutes", 1) = 1
        and cardinality("participation"."period_minutes") between 1 and 8
        and array_position("participation"."period_minutes", null) is null
        and 0 <= all("participation"."period_minutes")
        and 600 >= all("participation"."period_minutes")
        and "participation"."minutes" = coalesce("participation"."period_minutes"[1], 0) + coalesce("participation"."period_minutes"[2], 0)
          + coalesce("participation"."period_minutes"[3], 0) + coalesce("participation"."period_minutes"[4], 0)
          + coalesce("participation"."period_minutes"[5], 0) + coalesce("participation"."period_minutes"[6], 0)
          + coalesce("participation"."period_minutes"[7], 0) + coalesce("participation"."period_minutes"[8], 0)
      ));--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_absent_has_no_load" CHECK ("participation"."status" not in ('absent', 'unavailable') or (coalesce("participation"."minutes", 0) = 0 and "participation"."rpe" is null and "participation"."period_minutes" is null));--> statement-breakpoint
-- Hockey field data (B-803, ADR 0091): with rolling substitutions a player plays several
-- stints, so a match's minutes are loaded by period and `minutes` is their sum (the CHECK
-- above). The staff writes the periods like the minutes.
GRANT UPDATE ("period_minutes") ON "public"."participation" TO "sport_performance_app", "sport_performance_worker";--> statement-breakpoint
-- The periods get their own field clock in the offline sync (ADR 0050): a change of the periods
-- that keeps the total does not touch `minutes`, so its clock alone would not record it. The
-- sync engine resolves minutes and periods as one field against the later of the two clocks.
DROP TRIGGER "participation_sync_change" ON "public"."participation";--> statement-breakpoint
CREATE TRIGGER "participation_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "public"."participation"
  FOR EACH ROW EXECUTE FUNCTION "public"."sync_change_record"('participation', 'id', 'player_id', 'status,minutes,period_minutes,contacts_n,rpe');
