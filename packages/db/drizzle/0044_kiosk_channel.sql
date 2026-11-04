-- Kiosk mode (B-504, ADR 0086): wellness and RPE loaded on a shared club device, under the
-- session of a staff member, for a player who picked themselves there. The row keeps the
-- channel it came by (principle 4: every value keeps how it was taken); the author is the
-- staff member (`created_by` / `updated_by` and the change history).
ALTER TABLE "participation" ADD COLUMN "rpe_via_kiosk" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wellness" ADD COLUMN "via_kiosk" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_rpe_via_kiosk" CHECK ("participation"."rpe" is not null or not "participation"."rpe_via_kiosk");--> statement-breakpoint
-- The channel of an RPE follows the RPE (a later report from the player's account, or the
-- staff clearing it with an absence); the channel of a wellness check-in never changes: a
-- correction is the player's, from their own account, and keeps how the entry was loaded.
GRANT UPDATE ("rpe_via_kiosk") ON "public"."participation" TO "sport_performance_app", "sport_performance_worker";
