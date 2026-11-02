CREATE TYPE "public"."coefficient_verification" AS ENUM('verified_against_publication', 'cross_checked_secondary_sources', 'unverified');--> statement-breakpoint
CREATE TABLE "khamis_roche_coefficient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"sex" "sex" NOT NULL,
	"age_years" double precision NOT NULL,
	"intercept_in" double precision NOT NULL,
	"height_in_coef" double precision NOT NULL,
	"weight_lb_coef" double precision NOT NULL,
	"midparent_height_in_coef" double precision NOT NULL,
	CONSTRAINT "khamis_roche_coefficient_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "khamis_roche_coefficient_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "khamis_roche_coefficient_row_key" UNIQUE("club_id","table_id","sex","age_years"),
	CONSTRAINT "khamis_roche_coefficient_age_range" CHECK ("khamis_roche_coefficient"."age_years" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "khamis_roche_coefficient"."age_years" > 0 and "khamis_roche_coefficient"."age_years" < 25),
	CONSTRAINT "khamis_roche_coefficient_finite" CHECK ("khamis_roche_coefficient"."intercept_in" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "khamis_roche_coefficient"."height_in_coef" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "khamis_roche_coefficient"."weight_lb_coef" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and "khamis_roche_coefficient"."midparent_height_in_coef" not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8))
);
--> statement-breakpoint
CREATE TABLE "khamis_roche_table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"citation" text NOT NULL,
	"doi" text,
	"errata" text[] DEFAULT '{}'::text[] NOT NULL,
	"verification" "coefficient_verification" NOT NULL,
	"verification_notes" text NOT NULL,
	CONSTRAINT "khamis_roche_table_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "khamis_roche_table_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "khamis_roche_table_club_id_code_key" UNIQUE("club_id","code"),
	CONSTRAINT "khamis_roche_table_code_format" CHECK ("khamis_roche_table"."code" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' and char_length("khamis_roche_table"."code") <= 64 and strpos(replace("khamis_roche_table"."code", '_', ''), 'playerload') = 0)
);
--> statement-breakpoint
ALTER TABLE "khamis_roche_coefficient" ADD CONSTRAINT "khamis_roche_coefficient_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "khamis_roche_coefficient" ADD CONSTRAINT "khamis_roche_coefficient_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "khamis_roche_coefficient" ADD CONSTRAINT "khamis_roche_coefficient_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "khamis_roche_coefficient" ADD CONSTRAINT "khamis_roche_coefficient_table_id_fkey" FOREIGN KEY ("club_id","table_id") REFERENCES "public"."khamis_roche_table"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "khamis_roche_table" ADD CONSTRAINT "khamis_roche_table_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "khamis_roche_table" ADD CONSTRAINT "khamis_roche_table_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "khamis_roche_table" ADD CONSTRAINT "khamis_roche_table_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER "khamis_roche_table_set_updated_at" BEFORE UPDATE ON "khamis_roche_table" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "khamis_roche_coefficient_set_updated_at" BEFORE UPDATE ON "khamis_roche_coefficient" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
-- RLS and grants (ADR 0026), as for every club table. Published reference coefficients
-- without personal data: every member of the club reads them, like the other catalogs (the
-- API predicts adult height for whoever may see the player). sc, admin and superadmin
-- write them (club bootstrap inside club creation, B-313). The worker reads and writes the
-- club of its job. No DELETE: a corrected table is a new code (ADR 0027). Like every
-- migration, this runs as a superuser or a role with BYPASSRLS (checked by 0004).
DO $$
DECLARE
  member constant text := '(SELECT "app"."current_role"()) IS NOT NULL';
  sc constant text[] := '{sc,admin,superadmin}';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.khamis_roche_table', member, sc);
  PERFORM "app_admin"."secure_club_table"('public.khamis_roche_coefficient', member, sc);
END
$$;