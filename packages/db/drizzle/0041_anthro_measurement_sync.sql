-- Anthropometry in the offline sync (B-508, ADR 0083): a new collection, `anthro_measurement`,
-- and two operations of the queue, `anthro.record` and `anthro.update`.
--
-- The migrations run in one transaction, and a value added with `ALTER TYPE ... ADD VALUE`
-- cannot be used before that transaction commits; the rows that already exist have to enter
-- the log here. So the collections enum is created again with the new value (the values of a
-- type created in the transaction are usable in it) and the column moves to it. The policy
-- that reads the column is dropped and created again around the change, as 0039 left it (with
-- the programs of a category, `gym_program`).
-- The operations enum is only used at run time: `ADD VALUE` is enough.
ALTER TYPE "public"."sync_operation" ADD VALUE 'anthro.record';--> statement-breakpoint
ALTER TYPE "public"."sync_operation" ADD VALUE 'anthro.update';--> statement-breakpoint
ALTER TYPE "public"."sync_collection" RENAME TO "sync_collection_0040";--> statement-breakpoint
CREATE TYPE "public"."sync_collection" AS ENUM('wellness', 'participation', 'training_session', 'test_session', 'test_result', 'gym_program', 'gym_set', 'anthro_measurement');--> statement-breakpoint
DROP POLICY "sync_change_app_select" ON "public"."sync_change";--> statement-breakpoint
ALTER TABLE "public"."sync_change" ALTER COLUMN "collection" SET DATA TYPE "public"."sync_collection" USING "collection"::text::"public"."sync_collection";--> statement-breakpoint
DROP TYPE "public"."sync_collection_0040";--> statement-breakpoint
CREATE POLICY "sync_change_app_select" ON "public"."sync_change" FOR SELECT TO "sport_performance_app" USING (
  (SELECT "app"."current_role"()) IS NOT NULL AND (CASE
    WHEN collection IN ('training_session', 'test_session')
      THEN ((SELECT "app"."sees_whole_club"()) OR category_id = ANY ((SELECT "app"."assigned_category_ids"())::uuid[]))
    WHEN collection = 'gym_program' AND player_id IS NULL THEN true
    ELSE ((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))
  END));
--> statement-breakpoint

-- The functions that cast to the collections enum, replaced with the same body: a session
-- that already ran them (a connection of the API during a deploy) recompiles them instead of
-- keeping a plan with the old type. `sync_lock_rows` also locks measurements now.
CREATE OR REPLACE FUNCTION "public"."sync_change_record"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  target_collection text := TG_ARGV[0];
  id_column text := TG_ARGV[1];
  player_column text := nullif(TG_ARGV[2], '');
  fields text[] := CASE WHEN coalesce(TG_ARGV[3], '') = '' THEN '{}'::text[] ELSE string_to_array(TG_ARGV[3], ',') END;
  is_child boolean := TG_ARGV[1] <> 'id';
  old_row jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  new_row jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  current_row jsonb;
  target_club uuid;
  target_row uuid;
  old_player uuid;
  old_category uuid;
  old_sport text;
  new_player uuid;
  new_category uuid;
  new_sport text;
  carried jsonb := '{}'::jsonb;
  clocks jsonb := '{}'::jsonb;
  defaulted text[];
  stamp text;
  field text;
BEGIN
  -- An update that changes nothing but the audit columns (ON DELETE SET NULL of an author)
  -- is not a change of the data.
  IF TG_OP = 'UPDATE'
     AND (old_row - 'updated_at' - 'updated_by' - 'created_by') = (new_row - 'updated_at' - 'updated_by' - 'created_by') THEN
    RETURN NULL;
  END IF;
  current_row := coalesce(new_row, old_row);
  target_club := (current_row ->> 'club_id')::uuid;
  target_row := (current_row ->> id_column)::uuid;

  IF is_child THEN
    -- A value of a result: the live entry of its result moves to the end of the log. A value
    -- never resurrects nor deletes the result, nor changes its scope.
    UPDATE "public"."sync_change" c
       SET txid = pg_current_xact_id(),
           seq = nextval(pg_get_serial_sequence('"public"."sync_change"', 'seq'))
     WHERE c.club_id = target_club
       AND c.collection = target_collection::"public"."sync_collection"
       AND c.row_id = target_row
       AND NOT c.deleted;
    IF NOT FOUND THEN
      INSERT INTO "public"."sync_change" AS c (club_id, collection, row_id, player_id, txid)
      SELECT r.club_id, target_collection::"public"."sync_collection", r.id, r.player_id, pg_current_xact_id()
        FROM "public"."test_result" r
       WHERE r.club_id = target_club AND r.id = target_row
      ON CONFLICT ON CONSTRAINT "sync_change_scope_key" DO UPDATE
         SET txid = excluded.txid,
             seq = nextval(pg_get_serial_sequence('"public"."sync_change"', 'seq'));
    END IF;
    RETURN NULL;
  END IF;

  -- The scope of the row before and after: its player, or its category and sport (a session).
  IF player_column IS NOT NULL THEN
    old_player := (old_row ->> player_column)::uuid;
    new_player := (new_row ->> player_column)::uuid;
  ELSE
    old_category := (old_row ->> 'category_id')::uuid;
    old_sport := old_row ->> 'sport';
    new_category := (new_row ->> 'category_id')::uuid;
    new_sport := new_row ->> 'sport';
  END IF;

  -- Gone from the old scope (deleted, or moved): its entry becomes a mark at the end of the log.
  -- The clocks of the fields go with the row to its new scope.
  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND (old_player, old_category, old_sport)
                              IS DISTINCT FROM (new_player, new_category, new_sport)) THEN
    INSERT INTO "public"."sync_change" AS c (club_id, collection, row_id, player_id, category_id, sport,
                                             deleted, txid)
    VALUES (target_club, target_collection::"public"."sync_collection", target_row, old_player,
            old_category, old_sport::"public"."sport", true, pg_current_xact_id())
    ON CONFLICT ON CONSTRAINT "sync_change_scope_key" DO UPDATE
       SET txid = excluded.txid,
           seq = nextval(pg_get_serial_sequence('"public"."sync_change"', 'seq')),
           deleted = true
    RETURNING c.field_hlc INTO carried;
    IF TG_OP = 'DELETE' THEN
      RETURN NULL;
    END IF;
  END IF;

  IF cardinality(fields) > 0 THEN
    stamp := "app"."sync_hlc"();
    IF TG_OP = 'INSERT' THEN
      defaulted := string_to_array(
        coalesce(nullif(pg_catalog.current_setting('app.sync_defaulted_fields', true), ''), ''), ',');
    END IF;
    FOREACH field IN ARRAY fields LOOP
      IF TG_OP = 'INSERT' THEN
        IF jsonb_typeof(new_row -> field) IS DISTINCT FROM 'null'
           AND NOT (TG_TABLE_NAME || '.' || field) = ANY (coalesce(defaulted, '{}'::text[])) THEN
          clocks := clocks || jsonb_build_object(field, stamp);
        END IF;
      ELSIF (old_row -> field) IS DISTINCT FROM (new_row -> field) THEN
        clocks := clocks || jsonb_build_object(field, stamp);
      END IF;
    END LOOP;
  END IF;
  INSERT INTO "public"."sync_change" AS c (club_id, collection, row_id, player_id, category_id, sport,
                                           deleted, field_hlc, txid)
  VALUES (target_club, target_collection::"public"."sync_collection", target_row, new_player,
          new_category, new_sport::"public"."sport", false,
          "app"."sync_merge_clocks"(carried, clocks), pg_current_xact_id())
  ON CONFLICT ON CONSTRAINT "sync_change_scope_key" DO UPDATE
     SET txid = excluded.txid,
         seq = nextval(pg_get_serial_sequence('"public"."sync_change"', 'seq')),
         deleted = false,
         field_hlc = "app"."sync_merge_clocks"(c.field_hlc, excluded.field_hlc);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app"."sync_stamp_fields"(target_collection text, target_row uuid, fields text[], stamp text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF "app"."current_role"() IS NULL THEN
    RAISE EXCEPTION 'sync_stamp_fields needs a validated role' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF stamp IS NULL OR stamp !~ '^\d{15}-\d{6}-(?:[0-9a-f]{16,32}|server)$' THEN
    RAISE EXCEPTION 'not a hybrid logical clock' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(fields) f WHERE f IS NULL OR f !~ '^[a-z][a-z0-9_]{0,62}$') THEN
    RAISE EXCEPTION 'not a column name' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE "public"."sync_change" c
     SET field_hlc = "app"."sync_merge_clocks"(
           c.field_hlc, (SELECT coalesce(jsonb_object_agg(f, stamp), '{}'::jsonb) FROM unnest(fields) f))
   WHERE c.club_id = "app"."current_club_id"()
     AND c.collection = target_collection::"public"."sync_collection"
     AND c.row_id = target_row
     AND NOT c.deleted;
END;
$$;
--> statement-breakpoint
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
    WHEN 'anthro_measurement' THEN
      PERFORM 1 FROM "public"."anthro_measurement" t WHERE t.club_id = club AND t.id = ANY (ids)
        ORDER BY t.id FOR NO KEY UPDATE;
    ELSE
      RAISE EXCEPTION 'not a collection with field clocks' USING ERRCODE = 'invalid_parameter_value';
  END CASE;
END;
$$;
--> statement-breakpoint

-- A measurement is logged under its player; the values and the context of the measurement are
-- resolved per field. The maturation the worker derives is not among them: its write moves the
-- row to the end of the log (the device gets the new values) without stamping any clock.
CREATE TRIGGER "anthro_measurement_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "public"."anthro_measurement"
  FOR EACH ROW EXECUTE FUNCTION "public"."sync_change_record"('anthro_measurement', 'id', 'player_id', 'measured_on,height_cm,sitting_height_cm,weight_kg,skinfolds_sum_mm,method,evaluator_id,conditions,notes');--> statement-breakpoint

-- The measurements that already exist enter the log once, without field clocks (any later edit
-- wins over them): the first pull of every device gets them.
INSERT INTO "public"."sync_change" (club_id, collection, row_id, player_id, category_id, sport)
SELECT club_id, 'anthro_measurement'::"public"."sync_collection", id, player_id, NULL::uuid, NULL::"public"."sport"
  FROM "public"."anthro_measurement";
