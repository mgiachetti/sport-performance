CREATE TABLE "roster_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"request_sha256" text NOT NULL,
	"row_count" integer NOT NULL,
	"created_count" integer NOT NULL,
	"updated_count" integer NOT NULL,
	"skipped_count" integer NOT NULL,
	"guardians_linked_count" integer NOT NULL,
	"invitations_to_send_count" integer NOT NULL,
	"outcomes" jsonb NOT NULL,
	CONSTRAINT "roster_import_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "roster_import_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "roster_import_request_sha256_format" CHECK ("roster_import"."request_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "roster_import_counts" CHECK ("roster_import"."row_count" >= 1 and "roster_import"."created_count" >= 0 and "roster_import"."updated_count" >= 0 and "roster_import"."skipped_count" >= 0 and "roster_import"."created_count" + "roster_import"."updated_count" + "roster_import"."skipped_count" = "roster_import"."row_count" and "roster_import"."guardians_linked_count" >= 0 and "roster_import"."invitations_to_send_count" >= 0),
	CONSTRAINT "roster_import_outcomes_array" CHECK (jsonb_typeof("roster_import"."outcomes") = 'array' and jsonb_array_length("roster_import"."outcomes") = "roster_import"."row_count")
);
--> statement-breakpoint
ALTER TABLE "roster_import" ADD CONSTRAINT "roster_import_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_import" ADD CONSTRAINT "roster_import_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_import" ADD CONSTRAINT "roster_import_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_import_created_at_idx" ON "roster_import" USING btree ("club_id","created_at");--> statement-breakpoint

-- ─── Hand-written (B-330, ADR 0047) ──────────────────────────────────────────────────
-- `updated_at` trigger of the new club table (see 0001): the audit columns follow the same
-- rules everywhere, even if the application never updates this one.
CREATE TRIGGER "roster_import_set_updated_at" BEFORE UPDATE ON "roster_import" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- Only the administration runs a roster import (matrix: data_import.run, which without a
-- category only the administration passes) and reads its record. A record: no UPDATE for
-- the connection roles, no DELETE.
DO $$
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.roster_import',
    "app_admin"."role_in"('{admin,superadmin}'), '{admin,superadmin}');
END
$$;
--> statement-breakpoint
REVOKE UPDATE ON "public"."roster_import" FROM "sport_performance_app", "sport_performance_worker";