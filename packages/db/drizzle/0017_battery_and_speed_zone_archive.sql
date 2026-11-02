-- Configuration of the club (B-322, ADR 0041): a battery entry or a speed zone configuration
-- that never applied can be withdrawn (archived) instead of deleted; one in force is closed
-- with `valid_to`. Resolution ignores archived rows.
ALTER TABLE "battery_config" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "speed_zone_config" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- `secure_club_table` granted UPDATE on the columns that existed when it ran (0004).
GRANT UPDATE ("archived_at") ON "public"."battery_config" TO "sport_performance_app", "sport_performance_worker";--> statement-breakpoint
GRANT UPDATE ("archived_at") ON "public"."speed_zone_config" TO "sport_performance_app", "sport_performance_worker";
