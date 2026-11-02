CREATE TYPE "public"."parent_kind" AS ENUM('mother', 'father');--> statement-breakpoint
CREATE TYPE "public"."player_leave_reason" AS ENUM('graduated', 'transferred', 'quit', 'other');--> statement-breakpoint
CREATE TABLE "player_parent_height" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"parent" "parent_kind" NOT NULL,
	"height_cm" double precision NOT NULL,
	"source" "height_source" NOT NULL,
	CONSTRAINT "player_parent_height_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "player_parent_height_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "player_parent_height_player_parent_key" UNIQUE("club_id","player_id","parent"),
	CONSTRAINT "player_parent_height_cm" CHECK ("player_parent_height"."height_cm" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "player_parent_height"."height_cm" > 0 and "player_parent_height"."height_cm" < 300)
);
--> statement-breakpoint
CREATE TABLE "player_position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"sort_order" smallint NOT NULL,
	CONSTRAINT "player_position_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "player_position_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "player_position_player_position_key" UNIQUE("club_id","player_id","position_id"),
	CONSTRAINT "player_position_player_order_key" UNIQUE("club_id","player_id","sort_order"),
	CONSTRAINT "player_position_sort_order" CHECK ("player_position"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "player" DROP CONSTRAINT "player_mother_height";--> statement-breakpoint
ALTER TABLE "player" DROP CONSTRAINT "player_father_height";--> statement-breakpoint
ALTER TABLE "player" DROP CONSTRAINT "player_position_id_fkey";
--> statement-breakpoint
DROP INDEX "player_position_id_idx";--> statement-breakpoint
-- Hand-edited (B-315): `sport` is backfilled before it becomes NOT NULL: the sport of the
-- player's latest category, else the club's only branch of the player's sex, else the
-- club's only branch. Several candidate branches are ambiguous and pick none: a player
-- that matches no rule stops the migration (fail loudly, NOT NULL below).
ALTER TABLE "player" ADD COLUMN "sport" "sport";--> statement-breakpoint
UPDATE "player" p SET "sport" = coalesce(
  (SELECT c."sport" FROM "player_category" pc
     JOIN "category" c ON c."club_id" = pc."club_id" AND c."id" = pc."category_id"
    WHERE pc."club_id" = p."club_id" AND pc."player_id" = p."id"
    ORDER BY pc."valid_from" DESC, pc."id" LIMIT 1),
  (SELECT min(b."sport"::text)::"sport" FROM "club_branch" b
    WHERE b."club_id" = p."club_id" AND b."sex" = p."sex"
   HAVING count(*) = 1),
  (SELECT min(b."sport"::text)::"sport" FROM "club_branch" b
    WHERE b."club_id" = p."club_id"
   HAVING count(*) = 1));--> statement-breakpoint
ALTER TABLE "player" ALTER COLUMN "sport" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "left_reason" "player_leave_reason";--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "left_note" text;--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- Hand-edited (B-315): players who already left get a reason and are archived.
UPDATE "player" SET "left_reason" = 'other', "archived_at" = "updated_at" WHERE "left_on" IS NOT NULL;--> statement-breakpoint
UPDATE "player" SET "first_name" = btrim("first_name"), "last_name" = btrim("last_name")
 WHERE "first_name" <> btrim("first_name") OR "last_name" <> btrim("last_name");--> statement-breakpoint
ALTER TABLE "player_parent_height" ADD CONSTRAINT "player_parent_height_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_parent_height" ADD CONSTRAINT "player_parent_height_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_parent_height" ADD CONSTRAINT "player_parent_height_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_parent_height" ADD CONSTRAINT "player_parent_height_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_position" ADD CONSTRAINT "player_position_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_position" ADD CONSTRAINT "player_position_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_position" ADD CONSTRAINT "player_position_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_position" ADD CONSTRAINT "player_position_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_position" ADD CONSTRAINT "player_position_position_id_fkey" FOREIGN KEY ("club_id","position_id") REFERENCES "public"."position"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_position_position_idx" ON "player_position" USING btree ("club_id","position_id");--> statement-breakpoint
-- Hand-edited (B-315): the single position and the parents' heights move to their tables
-- before their columns are dropped. Rows the new tables would refuse stop the migration
-- with a clear message (fail loudly): a position of another sport than the player (the
-- `player_position_sport` trigger is created below, after the copy) and a parent's height
-- outside the new range (the old check only asked for > 0).
DO $$
DECLARE
  bad_positions bigint;
  bad_heights bigint;
BEGIN
  SELECT count(*) INTO bad_positions FROM "player" p
    JOIN "position" pos ON pos."club_id" = p."club_id" AND pos."id" = p."position_id"
   WHERE pos."sport" <> p."sport";
  IF bad_positions > 0 THEN
    RAISE EXCEPTION '0012_players_and_roster: % player(s) have a position of another sport; correct player.position_id first', bad_positions;
  END IF;
  SELECT count(*) INTO bad_heights FROM "player"
   WHERE "mother_height_cm" >= 300 OR "father_height_cm" >= 300;
  IF bad_heights > 0 THEN
    RAISE EXCEPTION '0012_players_and_roster: % player(s) have a parent height of 300 cm or more; correct it first', bad_heights;
  END IF;
END
$$;
--> statement-breakpoint
INSERT INTO "player_position" ("club_id", "player_id", "position_id", "sort_order")
SELECT "club_id", "id", "position_id", 0 FROM "player" WHERE "position_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "player_parent_height" ("club_id", "player_id", "parent", "height_cm", "source")
SELECT "club_id", "id", 'mother'::"parent_kind", "mother_height_cm", "mother_height_source" FROM "player"
 WHERE "mother_height_cm" IS NOT NULL
UNION ALL
SELECT "club_id", "id", 'father'::"parent_kind", "father_height_cm", "father_height_source" FROM "player"
 WHERE "father_height_cm" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "player" DROP COLUMN "position_id";--> statement-breakpoint
ALTER TABLE "player" DROP COLUMN "mother_height_cm";--> statement-breakpoint
ALTER TABLE "player" DROP COLUMN "mother_height_source";--> statement-breakpoint
ALTER TABLE "player" DROP COLUMN "father_height_cm";--> statement-breakpoint
ALTER TABLE "player" DROP COLUMN "father_height_source";--> statement-breakpoint
ALTER TABLE "player" ADD CONSTRAINT "player_first_name_format" CHECK ("player"."first_name" = btrim("player"."first_name") and "player"."first_name" <> '' and char_length("player"."first_name") <= 80);--> statement-breakpoint
ALTER TABLE "player" ADD CONSTRAINT "player_last_name_format" CHECK ("player"."last_name" = btrim("player"."last_name") and "player"."last_name" <> '' and char_length("player"."last_name") <= 80);--> statement-breakpoint
ALTER TABLE "player" ADD CONSTRAINT "player_leave" CHECK (("player"."left_on" is null) = ("player"."left_reason" is null) and ("player"."left_on" is null) = ("player"."archived_at" is null) and ("player"."left_note" is null or ("player"."left_on" is not null and char_length("player"."left_note") between 1 and 500)));--> statement-breakpoint

-- ─── Hand-written (B-315, ADR 0035) ──────────────────────────────────────────────────
-- `updated_at` triggers of the new club tables (see 0001).
CREATE TRIGGER "player_position_set_updated_at" BEFORE UPDATE ON "player_position" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "player_parent_height_set_updated_at" BEFORE UPDATE ON "player_parent_height" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- Row-level security of the new tables (ADR 0026), with the read scope of player data.
--   player_position       the staff that edits a profile (coach, sc, admin) writes it; the
--                         list is replaced on edit, so they may also delete its rows.
--   player_parent_height  reported by a guardian (only `reported`), measured or recorded by
--                         S&C and the administration (B-315, permission `parent_height`).
DO $$
DECLARE
  player_scope constant text := '((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))';
  profile_writers constant text[] := '{coach,sc,admin,superadmin}';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.player_position', player_scope,
    profile_writers, 'true', profile_writers);
  PERFORM "app_admin"."secure_club_table"('public.player_parent_height', player_scope,
    '{parent,sc,admin,superadmin}',
    '(SELECT "app"."current_role"()) <> ''parent'' OR source = ''reported''');
END
$$;
--> statement-breakpoint

-- The permission matrix lets coach and S&C edit the profile of their assigned players
-- (`player_profile.update`); the creation and the leave stay with the administration
-- (INSERT policy unchanged). The UPDATE policy follows the matrix as the backstop.
DROP POLICY "player_app_update" ON "public"."player";
--> statement-breakpoint
CREATE POLICY "player_app_update" ON "public"."player" FOR UPDATE TO "sport_performance_app"
  USING ((SELECT "app"."current_role"()) = ANY ('{coach,sc,admin,superadmin}'::text[])
         AND ((SELECT "app"."sees_whole_club"()) OR id = ANY ((SELECT "app"."visible_player_ids"())::uuid[])))
  WITH CHECK ((SELECT "app"."current_role"()) = ANY ('{coach,sc,admin,superadmin}'::text[])
         AND ((SELECT "app"."sees_whole_club"()) OR id = ANY ((SELECT "app"."visible_player_ids"())::uuid[])));
--> statement-breakpoint
-- `sport_performance_app` already has UPDATE on the old columns; the new ones need it too.
GRANT UPDATE ("sport", "left_reason", "left_note", "archived_at") ON "public"."player" TO "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint

-- Only the administration records or undoes a leave: a coach or S&C editing a profile
-- cannot archive the player (the API checks the matrix first; this is the backstop).
CREATE FUNCTION "public"."player_leave_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.left_on, NEW.left_reason, NEW.left_note, NEW.archived_at)
       IS DISTINCT FROM (OLD.left_on, OLD.left_reason, OLD.left_note, OLD.archived_at)
     AND EXISTS (SELECT 1 FROM pg_roles r
                  WHERE r.rolname = session_user AND NOT r.rolsuper AND NOT r.rolbypassrls)
     AND pg_has_role(session_user, 'sport_performance_app', 'MEMBER')
     AND NOT coalesce("app"."current_role"() IN ('admin', 'superadmin'), false) THEN
    RAISE EXCEPTION 'Only the administration records the leave of a player'
      USING ERRCODE = 'insufficient_privilege', TABLE = 'player';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."player_leave_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "player_leave_guard" BEFORE UPDATE ON "public"."player"
  FOR EACH ROW EXECUTE FUNCTION "public"."player_leave_guard"();
--> statement-breakpoint

-- The sport of a player is fixed once created: their categories, positions and history
-- are of that sport (ADR 0017). A player who changes sport is a new player.
CREATE FUNCTION "public"."player_sport_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.sport IS DISTINCT FROM OLD.sport THEN
    RAISE EXCEPTION 'The sport of a player cannot change'
      USING ERRCODE = 'check_violation', TABLE = 'player', COLUMN = 'sport',
            CONSTRAINT = 'player_sport_fixed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."player_sport_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "player_sport_guard" BEFORE UPDATE OF "sport" ON "public"."player"
  FOR EACH ROW EXECUTE FUNCTION "public"."player_sport_guard"();
--> statement-breakpoint

-- A category membership and a position must be of the player's sport. Runs as the owner:
-- the check must not depend on what the writer's policies let it see.
CREATE FUNCTION "public"."player_sport_matches"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  player_sport text;
  target_sport text;
BEGIN
  SELECT p.sport::text INTO player_sport FROM "public"."player" p
   WHERE p.club_id = NEW.club_id AND p.id = NEW.player_id;
  IF TG_TABLE_NAME = 'player_category' THEN
    SELECT c.sport::text INTO target_sport FROM "public"."category" c
     WHERE c.club_id = NEW.club_id AND c.id = NEW.category_id;
  ELSE
    SELECT p.sport::text INTO target_sport FROM "public"."position" p
     WHERE p.club_id = NEW.club_id AND p.id = NEW.position_id;
  END IF;
  -- A missing row is the foreign key's to report.
  IF player_sport IS NOT NULL AND target_sport IS NOT NULL AND player_sport <> target_sport THEN
    RAISE EXCEPTION 'The % is of another sport than the player', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', TABLE = TG_TABLE_NAME,
            CONSTRAINT = TG_TABLE_NAME || '_sport';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."player_sport_matches"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "player_category_sport" BEFORE INSERT OR UPDATE OF "category_id", "player_id" ON "public"."player_category"
  FOR EACH ROW EXECUTE FUNCTION "public"."player_sport_matches"();
--> statement-breakpoint
CREATE TRIGGER "player_position_sport" BEFORE INSERT OR UPDATE OF "position_id", "player_id" ON "public"."player_position"
  FOR EACH ROW EXECUTE FUNCTION "public"."player_sport_matches"();
