ALTER TABLE "file" ADD COLUMN "test_result_id" uuid;--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "test_entry_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "file_test_entry_key" ON "file" USING btree ("club_id","test_result_id","test_entry_id") WHERE "file"."test_entry_id" is not null and "file"."status" <> 'deleted';--> statement-breakpoint
CREATE INDEX "file_test_result_id_idx" ON "file" USING btree ("club_id","test_result_id") WHERE "file"."test_result_id" is not null;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_test_entry" CHECK (("file"."test_result_id" is null or "file"."test_entry_id" is not null) and ("file"."test_entry_id" is null or "file"."kind" = 'cmj_video'));--> statement-breakpoint

-- ─── Hand-written (B-604, ADR 0085) ──────────────────────────────────────────────────
-- The attempt a CMJ video is the evidence of: `(club_id, test_result_id)` → its result.
-- Erasing a player (app.erase_player, ADR 0051) detaches their files first and deletes
-- their results afterwards: the key lets go of the result, never of the club (the entry id
-- stays as a record), and the file waits for the retention job like any deleted file. Not
-- in the Drizzle schema: it cannot express the column list of `SET NULL`.
ALTER TABLE "file" ADD CONSTRAINT "file_test_result_id_fkey" FOREIGN KEY ("club_id","test_result_id") REFERENCES "public"."test_result"("club_id","id") ON DELETE SET NULL ("test_result_id") ON UPDATE no action;--> statement-breakpoint

-- The video is of the attempt it names: a `cmj_video_frames` entry of that result, whose
-- player is the video's. Checked here as well as in the API (which also refuses a voided
-- attempt), with the definer's rights: the caller's RLS does not hide the attempt from the
-- check. Set on insert and never changed, except by the key above.
CREATE FUNCTION "public"."file_test_entry_check"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only the key may let go of the result (its row was deleted); nothing else moves.
    IF NEW.test_entry_id IS DISTINCT FROM OLD.test_entry_id
       OR (NEW.test_result_id IS NOT NULL AND NEW.test_result_id IS DISTINCT FROM OLD.test_result_id) THEN
      RAISE EXCEPTION 'The attempt of a video is set when it is uploaded and never changed'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'file_test_entry_frozen', TABLE = 'file';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.test_result_id IS NULL AND NEW.test_entry_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM 1
     FROM "public"."test_result" r
    WHERE NEW.test_result_id IS NOT NULL
      AND r.club_id = NEW.club_id AND r.id = NEW.test_result_id AND r.player_id = NEW.player_id
      AND EXISTS (SELECT 1 FROM "public"."test_result_value" v
                   WHERE v.club_id = r.club_id AND v.test_result_id = r.id
                     AND v.entry_id = NEW.test_entry_id
                     AND v.inputs ->> 'kind' = 'cmj_video_frames');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A CMJ video is of a video attempt of its own player'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'file_test_entry_attempt', TABLE = 'file';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."file_test_entry_check"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "file_test_entry_check" BEFORE INSERT OR UPDATE OF "test_result_id", "test_entry_id" ON "public"."file"
  FOR EACH ROW EXECUTE FUNCTION "public"."file_test_entry_check"();
--> statement-breakpoint

-- The result shows the video of each attempt (`videoFileId`, only while it is ready): a
-- video that is uploaded, confirmed, deleted or expires is a change of its result for the
-- offline pull (ADR 0050), like a value of the result. A file of no result changes nothing.
CREATE TRIGGER "file_test_result_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "public"."file"
  FOR EACH ROW EXECUTE FUNCTION "public"."sync_change_record"('test_result', 'test_result_id', '', '');
