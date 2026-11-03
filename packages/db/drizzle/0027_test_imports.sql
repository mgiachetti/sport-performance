CREATE TABLE "test_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"row_count" integer NOT NULL,
	"created_count" integer NOT NULL,
	"skipped_count" integer NOT NULL,
	"body_sha256" text NOT NULL,
	CONSTRAINT "test_import_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "test_import_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "test_import_source_format" CHECK ("test_import"."source" = btrim("test_import"."source") and "test_import"."source" <> '' and char_length("test_import"."source") <= 200),
	CONSTRAINT "test_import_body_sha256_format" CHECK ("test_import"."body_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "test_import_counts" CHECK ("test_import"."row_count" >= 1 and "test_import"."created_count" >= 0 and "test_import"."skipped_count" >= 0 and "test_import"."created_count" + "test_import"."skipped_count" = "test_import"."row_count")
);
--> statement-breakpoint
ALTER TABLE "test_result" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "test_import" ADD CONSTRAINT "test_import_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_import" ADD CONSTRAINT "test_import_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_import" ADD CONSTRAINT "test_import_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_import_created_idx" ON "test_import" USING btree ("club_id","created_at");--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_import_id_fkey" FOREIGN KEY ("club_id","import_id") REFERENCES "public"."test_import"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_result_import_id_idx" ON "test_result" USING btree ("club_id","import_id") WHERE "test_result"."import_id" is not null;--> statement-breakpoint
ALTER TABLE "test_result" ADD CONSTRAINT "test_result_import_historical" CHECK ("test_result"."import_id" is null or ("test_result"."status" = 'done' and "test_result"."method" = 'historical' and "test_result"."test_session_id" is null));
--> statement-breakpoint

-- ─── Hand-written (B-331, ADR 0052) ──────────────────────────────────────────────────
-- `updated_at` trigger of the new club table (see 0001), like every club table.
CREATE TRIGGER "test_import_set_updated_at" BEFORE UPDATE ON "test_import" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- Who imports reads the imports: sc and the administration (matrix: data_import.run). An
-- import is the record of what was loaded: nothing updates it (no UPDATE grant) and nothing
-- deletes it (no DELETE policy).
DO $$
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.test_import',
    "app_admin"."role_in"('{sc,admin,superadmin}'), '{sc,admin,superadmin}');
END
$$;
--> statement-breakpoint
REVOKE UPDATE ON "public"."test_import" FROM "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint

-- `test_result.import_id` is set on insert and never changed: `secure_club_table` (0004)
-- granted UPDATE column by column when `test_result` was secured, so the new column is not
-- among the writable ones of either connection role. Stated here so nobody grants it later.
REVOKE UPDATE ("import_id") ON "public"."test_result" FROM "sport_performance_app", "sport_performance_worker";