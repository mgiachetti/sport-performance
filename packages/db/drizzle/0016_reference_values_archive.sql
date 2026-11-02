ALTER TABLE "reference_value" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- Hand-edited (B-321, ADR 0040): rows written before this migration are made valid before the
-- new constraints: trimmed sources (an empty one says so), malformed line codes dropped, and of
-- two active references with the same key only the latest one stays active.
UPDATE "reference_value" SET "source" = left(coalesce(nullif(btrim("source"), ''), 'Sin fuente'), 200)
  WHERE "source" <> btrim("source") OR "source" = '' OR char_length("source") > 200;--> statement-breakpoint
UPDATE "reference_value" SET "line_code" = NULL
  WHERE "line_code" IS NOT NULL AND "line_code" !~ '^[a-z][a-z0-9_]*$';--> statement-breakpoint
UPDATE "reference_value" AS "r" SET "archived_at" = now()
  FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "club_id", "metric_definition_id", "sport", "sex",
        coalesce("position_id", '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce("line_code", ''), "valid_from"
      ORDER BY "created_at" DESC, "id" DESC) AS "rank"
    FROM "reference_value"
  ) AS "d"
  WHERE "r"."id" = "d"."id" AND "d"."rank" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "reference_value_active_key" ON "reference_value" USING btree ("club_id","metric_definition_id","sport","sex",coalesce("position_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("line_code", ''),"valid_from") WHERE "reference_value"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "reference_value" ADD CONSTRAINT "reference_value_line_code_format" CHECK ("reference_value"."line_code" is null or "reference_value"."line_code" ~ '^[a-z][a-z0-9_]*$');--> statement-breakpoint
ALTER TABLE "reference_value" ADD CONSTRAINT "reference_value_source_format" CHECK ("reference_value"."source" = btrim("reference_value"."source") and "reference_value"."source" <> '' and char_length("reference_value"."source") <= 200);
--> statement-breakpoint

-- ─── Hand-written (B-321, ADR 0040) ──────────────────────────────────────────────────
-- `secure_club_table` (0004) granted UPDATE column by column: the new column joins the
-- writable ones of both connection roles. RLS and policies are unchanged (member reads, sc
-- and the administration write).
GRANT UPDATE ("archived_at") ON "public"."reference_value" TO "sport_performance_app", "sport_performance_worker";
