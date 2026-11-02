ALTER TABLE "training_session" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint

-- ─── Hand-written (B-318, ADR 0037) ──────────────────────────────────────────────────
-- secure_club_table (0004) granted UPDATE column by column when the table was secured: the
-- new column needs its own grant, for the same writers (the policies stay as they are).
GRANT UPDATE ("archived_at") ON "public"."training_session" TO "sport_performance_app", "sport_performance_worker";--> statement-breakpoint

-- Archiving a session (cancelled, entered by mistake) and restoring it is its lifecycle, not
-- a correction of a submitted value (ADR 0030): `archived_at` is a free column of the change
-- history, like the status of a test session. The change is still recorded.
DROP TRIGGER "training_session_change_history" ON "training_session";--> statement-breakpoint
CREATE TRIGGER "training_session_change_history" AFTER UPDATE OR DELETE ON "training_session" FOR EACH ROW EXECUTE FUNCTION "public"."change_history_record"('', '{archived_at}');
