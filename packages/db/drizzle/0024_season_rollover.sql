CREATE TYPE "public"."season_rollover_decision" AS ENUM('move', 'stay');--> statement-breakpoint
CREATE TYPE "public"."season_rollover_outcome" AS ENUM('moved', 'stayed', 'skipped_left', 'skipped_later_membership', 'skipped_category_unavailable');--> statement-breakpoint
CREATE TYPE "public"."season_rollover_proposal" AS ENUM('birth_year', 'already_there', 'ambiguous', 'no_category', 'aged_out', 'too_young');--> statement-breakpoint
CREATE TYPE "public"."season_rollover_status" AS ENUM('draft', 'applied', 'cancelled');--> statement-breakpoint
CREATE TABLE "season_rollover" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"season_year" smallint NOT NULL,
	"status" "season_rollover_status" DEFAULT 'draft' NOT NULL,
	"applied_at" timestamp with time zone,
	"applied_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	CONSTRAINT "season_rollover_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "season_rollover_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "season_rollover_year" CHECK ("season_rollover"."season_year" between 1900 and 9999),
	CONSTRAINT "season_rollover_lifecycle" CHECK (("season_rollover"."applied_at" is not null) = ("season_rollover"."status" = 'applied') and ("season_rollover"."cancelled_at" is not null) = ("season_rollover"."status" = 'cancelled') and ("season_rollover"."applied_by" is null or "season_rollover"."applied_at" is not null) and ("season_rollover"."cancelled_by" is null or "season_rollover"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "season_rollover_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"rollover_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"age_in_season_year" smallint NOT NULL,
	"age_band_code" text,
	"proposal" "season_rollover_proposal" NOT NULL,
	"proposed_category_id" uuid,
	"needs_review" boolean NOT NULL,
	"decision" "season_rollover_decision" NOT NULL,
	"target_category_id" uuid,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"outcome" "season_rollover_outcome",
	"membership_id" uuid,
	CONSTRAINT "season_rollover_item_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "season_rollover_item_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "season_rollover_item_player_key" UNIQUE("club_id","rollover_id","player_id"),
	CONSTRAINT "season_rollover_item_age" CHECK ("season_rollover_item"."age_in_season_year" between 0 and 150),
	CONSTRAINT "season_rollover_item_age_band_code_format" CHECK ("season_rollover_item"."age_band_code" is null or "season_rollover_item"."age_band_code" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "season_rollover_item_proposal" CHECK (("season_rollover_item"."proposed_category_id" is not null) = ("season_rollover_item"."proposal" in ('birth_year', 'already_there')) and ("season_rollover_item"."age_band_code" is null) = ("season_rollover_item"."proposal" in ('aged_out', 'too_young'))),
	CONSTRAINT "season_rollover_item_decision" CHECK (("season_rollover_item"."target_category_id" is not null) = ("season_rollover_item"."decision" = 'move')),
	CONSTRAINT "season_rollover_item_review" CHECK ("season_rollover_item"."reviewed_by" is null or "season_rollover_item"."reviewed_at" is not null),
	CONSTRAINT "season_rollover_item_outcome" CHECK (("season_rollover_item"."membership_id" is not null) = ("season_rollover_item"."outcome" is not distinct from 'moved') and ("season_rollover_item"."outcome" is distinct from 'moved' or "season_rollover_item"."decision" = 'move'))
);
--> statement-breakpoint
ALTER TABLE "season_rollover" ADD CONSTRAINT "season_rollover_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover" ADD CONSTRAINT "season_rollover_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover" ADD CONSTRAINT "season_rollover_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover" ADD CONSTRAINT "season_rollover_applied_by_user_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover" ADD CONSTRAINT "season_rollover_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover" ADD CONSTRAINT "season_rollover_season_id_fkey" FOREIGN KEY ("club_id","season_id") REFERENCES "public"."season"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover_item" ADD CONSTRAINT "season_rollover_item_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover_item" ADD CONSTRAINT "season_rollover_item_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover_item" ADD CONSTRAINT "season_rollover_item_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover_item" ADD CONSTRAINT "season_rollover_item_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover_item" ADD CONSTRAINT "season_rollover_item_rollover_id_fkey" FOREIGN KEY ("club_id","rollover_id") REFERENCES "public"."season_rollover"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover_item" ADD CONSTRAINT "season_rollover_item_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover_item" ADD CONSTRAINT "season_rollover_item_proposed_category_id_fkey" FOREIGN KEY ("club_id","proposed_category_id") REFERENCES "public"."category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover_item" ADD CONSTRAINT "season_rollover_item_target_category_id_fkey" FOREIGN KEY ("club_id","target_category_id") REFERENCES "public"."category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rollover_item" ADD CONSTRAINT "season_rollover_item_membership_id_fkey" FOREIGN KEY ("club_id","membership_id") REFERENCES "public"."player_category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "season_rollover_season_idx" ON "season_rollover" USING btree ("club_id","season_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "season_rollover_draft_key" ON "season_rollover" USING btree ("club_id","season_id") WHERE "season_rollover"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "season_rollover_item_player_idx" ON "season_rollover_item" USING btree ("club_id","player_id");--> statement-breakpoint
CREATE INDEX "season_rollover_item_proposed_category_id_idx" ON "season_rollover_item" USING btree ("club_id","proposed_category_id") WHERE "season_rollover_item"."proposed_category_id" is not null;--> statement-breakpoint
CREATE INDEX "season_rollover_item_target_category_id_idx" ON "season_rollover_item" USING btree ("club_id","target_category_id") WHERE "season_rollover_item"."target_category_id" is not null;--> statement-breakpoint
CREATE INDEX "season_rollover_item_membership_id_idx" ON "season_rollover_item" USING btree ("club_id","membership_id") WHERE "season_rollover_item"."membership_id" is not null;--> statement-breakpoint

-- ─── Hand-written (B-316, ADR 0049) ──────────────────────────────────────────────────
-- `updated_at` triggers of the new club tables (see 0001).
CREATE TRIGGER "season_rollover_set_updated_at" BEFORE UPDATE ON "season_rollover" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "season_rollover_item_set_updated_at" BEFORE UPDATE ON "season_rollover_item" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- A season change is computed for one season, year and day: those never change. Only a
-- draft changes (every review touches it, so its version changes) and it leaves the draft
-- once, to `applied` or `cancelled`; from then on it is the record of what was done. The
-- `*_by` columns may always become NULL (`ON DELETE SET NULL` of the author's account).
CREATE FUNCTION "public"."season_rollover_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.club_id, NEW.client_uuid, NEW.created_at, NEW.season_id, NEW.effective_on,
      NEW.season_year)
     IS DISTINCT FROM
     (OLD.id, OLD.club_id, OLD.client_uuid, OLD.created_at, OLD.season_id, OLD.effective_on,
      OLD.season_year) THEN
    RAISE EXCEPTION 'The season, day and year of a season change never change: create another one'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'season_rollover_immutable',
            TABLE = 'season_rollover';
  END IF;
  IF OLD.status <> 'draft'
     AND ((NEW.status, NEW.applied_at, NEW.cancelled_at) IS DISTINCT FROM
          (OLD.status, OLD.applied_at, OLD.cancelled_at)
          OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL)
          OR (NEW.updated_by IS DISTINCT FROM OLD.updated_by AND NEW.updated_by IS NOT NULL)
          OR (NEW.applied_by IS DISTINCT FROM OLD.applied_by AND NEW.applied_by IS NOT NULL)
          OR (NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by AND NEW.cancelled_by IS NOT NULL)) THEN
    RAISE EXCEPTION 'An applied or cancelled season change never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'season_rollover_closed',
            TABLE = 'season_rollover';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."season_rollover_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "season_rollover_guard" BEFORE UPDATE ON "public"."season_rollover"
  FOR EACH ROW EXECUTE FUNCTION "public"."season_rollover_guard"();
--> statement-breakpoint

-- What the proposal computed for a player never changes (a new proposal is a new draft);
-- the decision, the review and the outcome change only while the season change is a draft.
-- Applying writes the outcomes first and then leaves the draft. `*_by` may become NULL.
CREATE FUNCTION "public"."season_rollover_item_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  parent_status "public"."season_rollover_status";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.club_id, NEW.client_uuid, NEW.created_at, NEW.rollover_id, NEW.player_id,
        NEW.age_in_season_year, NEW.age_band_code, NEW.proposal, NEW.proposed_category_id,
        NEW.needs_review)
       IS DISTINCT FROM
       (OLD.id, OLD.club_id, OLD.client_uuid, OLD.created_at, OLD.rollover_id, OLD.player_id,
        OLD.age_in_season_year, OLD.age_band_code, OLD.proposal, OLD.proposed_category_id,
        OLD.needs_review) THEN
      RAISE EXCEPTION 'The proposal for a player never changes: review its decision instead'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'season_rollover_item_immutable',
              TABLE = 'season_rollover_item';
    END IF;
    IF (NEW.decision, NEW.target_category_id, NEW.reviewed_at, NEW.outcome, NEW.membership_id)
         IS NOT DISTINCT FROM
       (OLD.decision, OLD.target_category_id, OLD.reviewed_at, OLD.outcome, OLD.membership_id)
       AND (NEW.created_by IS NOT DISTINCT FROM OLD.created_by OR NEW.created_by IS NULL)
       AND (NEW.updated_by IS NOT DISTINCT FROM OLD.updated_by OR NEW.updated_by IS NULL)
       AND (NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by OR NEW.reviewed_by IS NULL) THEN
      -- Nothing but authors removed (account deleted), or a no-op: always allowed.
      RETURN NEW;
    END IF;
  END IF;
  SELECT r.status INTO parent_status
    FROM "public"."season_rollover" r
   WHERE r.club_id = NEW.club_id AND r.id = NEW.rollover_id;
  -- A missing parent is left to the foreign key (23503).
  IF FOUND AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'The season change is no longer a draft: its players never change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'season_rollover_closed',
            TABLE = 'season_rollover_item';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."season_rollover_item_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "season_rollover_item_guard" BEFORE INSERT OR UPDATE ON "public"."season_rollover_item"
  FOR EACH ROW EXECUTE FUNCTION "public"."season_rollover_item_guard"();
--> statement-breakpoint

-- Who moves where, with birth years, is the roster of the whole sport: only the
-- administration reads and writes a season change (matrix: season.manage and
-- category.manage). The worker reaches its club (it will create drafts, #57). No DELETE:
-- a draft that is not applied is cancelled.
DO $$
DECLARE
  administration constant text := "app_admin"."role_in"('{admin,superadmin}');
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.season_rollover', administration,
    '{admin,superadmin}');
  PERFORM "app_admin"."secure_club_table"('public.season_rollover_item', administration,
    '{admin,superadmin}');
END
$$;
