-- Staff assignments (B-314, ADR 0034): an assignment ended before it started keeps an empty
-- range (`valid_to = valid_from`), cancelled and never in force, instead of being deleted.
-- Every reader of the validity (`app.visible_player_ids()`, the permission subject of the
-- API) already treats `valid_from <= today < valid_to` as in force, so an empty range is not.
ALTER TABLE "staff_assignment" DROP CONSTRAINT "staff_assignment_validity";--> statement-breakpoint
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_validity" CHECK ("staff_assignment"."valid_to" is null or "staff_assignment"."valid_to" >= "staff_assignment"."valid_from");
