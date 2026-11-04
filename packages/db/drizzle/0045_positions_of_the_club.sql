-- Positions of the club (B-801, ADR 0087): the club renames, reorders and adds positions
-- inside the lines of its sport, and archives the ones it does not use (never deletes them:
-- a player keeps an archived position).
ALTER TABLE "position" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- Hand-edited: a label written before this migration is made valid first (trimmed, empty
-- ones dropped so the catalog name shows, long ones cut to the new limit).
UPDATE "position" SET "label" = nullif(left(btrim("label"), 40), '')
  WHERE "label" IS NOT NULL AND ("label" <> btrim("label") OR btrim("label") = '' OR char_length("label") > 40);--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_label_format" CHECK ("position"."label" is null or ("position"."label" = btrim("position"."label") and "position"."label" <> '' and char_length("position"."label") <= 40));
--> statement-breakpoint

-- ─── Hand-written (B-801, ADR 0087) ──────────────────────────────────────────────────
-- `secure_club_table` (0004) granted UPDATE column by column: the new column joins the
-- writable ones of both connection roles. RLS and policies are unchanged (every member
-- reads, the administration writes).
GRANT UPDATE ("archived_at") ON "public"."position" TO "sport_performance_app", "sport_performance_worker";
