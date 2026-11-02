CREATE TABLE "club_branch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"sport" "sport" NOT NULL,
	"sex" "sex" NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "club_branch_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "club_branch_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "club_branch_club_id_sport_sex_key" UNIQUE("club_id","sport","sex")
);
--> statement-breakpoint
-- Hand-edited (B-313): `short_name` is backfilled from the slug before it becomes NOT NULL.
ALTER TABLE "club" ADD COLUMN "short_name" text;--> statement-breakpoint
UPDATE "club" SET "short_name" = left(upper("slug"), 16);--> statement-breakpoint
ALTER TABLE "club" ALTER COLUMN "short_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "club" ADD COLUMN "locale" text DEFAULT 'es-AR' NOT NULL;--> statement-breakpoint
ALTER TABLE "club" ADD COLUMN "primary_color" text DEFAULT '#f1882a' NOT NULL;--> statement-breakpoint
ALTER TABLE "club" ADD COLUMN "secondary_color" text DEFAULT '#050505' NOT NULL;--> statement-breakpoint
ALTER TABLE "club" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
-- Hand-edited (B-313): the colors of the old `branding` jsonb move to typed columns (a valid
-- `#rrggbb`, lowercased; anything else keeps the product default). `logoUrl` and
-- `backgroundColor` are dropped: the crest becomes an uploaded file (#56) and the neutrals are
-- product tokens, not per club.
UPDATE "club" SET
  "primary_color" = CASE WHEN lower("branding" ->> 'primaryColor') ~ '^#[0-9a-f]{6}$'
                         THEN lower("branding" ->> 'primaryColor') ELSE "primary_color" END,
  "secondary_color" = CASE WHEN lower("branding" ->> 'secondaryColor') ~ '^#[0-9a-f]{6}$'
                           THEN lower("branding" ->> 'secondaryColor') ELSE "secondary_color" END;--> statement-breakpoint
-- Hand-edited (B-313): the branches of existing clubs are the ones their categories use.
INSERT INTO "club_branch" ("club_id", "sport", "sex")
SELECT DISTINCT "club_id", "sport", "sex" FROM "category";--> statement-breakpoint
ALTER TABLE "club_branch" ADD CONSTRAINT "club_branch_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_branch" ADD CONSTRAINT "club_branch_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_branch" ADD CONSTRAINT "club_branch_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_branch_fkey" FOREIGN KEY ("club_id","sport","sex") REFERENCES "public"."club_branch"("club_id","sport","sex") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club" DROP COLUMN "branding";--> statement-breakpoint
ALTER TABLE "club" ADD CONSTRAINT "club_name_format" CHECK ("club"."name" = btrim("club"."name") and "club"."name" <> '' and char_length("club"."name") <= 120);--> statement-breakpoint
ALTER TABLE "club" ADD CONSTRAINT "club_short_name_format" CHECK ("club"."short_name" = btrim("club"."short_name") and "club"."short_name" <> '' and char_length("club"."short_name") <= 16);--> statement-breakpoint
ALTER TABLE "club" ADD CONSTRAINT "club_locale_format" CHECK ("club"."locale" ~ '^[a-z]{2}(-[A-Z]{2})?$');--> statement-breakpoint
ALTER TABLE "club" ADD CONSTRAINT "club_primary_color_format" CHECK ("club"."primary_color" ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
ALTER TABLE "club" ADD CONSTRAINT "club_secondary_color_format" CHECK ("club"."secondary_color" ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_name_format" CHECK ("category"."name" = btrim("category"."name") and "category"."name" <> '' and char_length("category"."name") <= 60);--> statement-breakpoint

-- ─── Hand-written (B-313, ADR 0032) ──────────────────────────────────────────────────
-- `updated_at` trigger of the new club table (see 0001).
CREATE TRIGGER "club_branch_set_updated_at" BEFORE UPDATE ON "club_branch" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- Branches are club structure: every member reads them, the administration writes them
-- (ADR 0026). Disabling one archives it; no DELETE.
DO $$
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.club_branch',
    '(SELECT "app"."current_role"()) IS NOT NULL', '{admin,superadmin}');
END
$$;
--> statement-breakpoint

-- The new profile and brand columns are editable by the administration (club_app_update:
-- admin or superadmin of the context's club). `slug` too, but only a superadmin changes it
-- (trigger below): it is part of URLs and deep links.
GRANT UPDATE ("short_name", "locale", "primary_color", "secondary_color", "logo_file_id", "slug") ON "public"."club" TO "sport_performance_app";
--> statement-breakpoint

CREATE FUNCTION "public"."club_slug_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug
     AND EXISTS (SELECT 1 FROM pg_roles r
                  WHERE r.rolname = session_user AND NOT r.rolsuper AND NOT r.rolbypassrls)
     AND "app"."current_role"() IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Only a superadmin changes the slug of a club'
      USING ERRCODE = 'insufficient_privilege', TABLE = 'club', COLUMN = 'slug';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."club_slug_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "club_slug_guard" BEFORE UPDATE OF "slug" ON "public"."club"
  FOR EACH ROW EXECUTE FUNCTION "public"."club_slug_guard"();
--> statement-breakpoint

-- Public theme by slug (B-313): the typed brand columns replace the old `branding` jsonb.
-- Still only what the theme contract exposes: no settings, no people.
DROP FUNCTION "app"."club_theme"(text);
--> statement-breakpoint
CREATE FUNCTION "app"."club_theme"(club_slug text)
RETURNS TABLE (id uuid, slug text, name text, short_name text, primary_color text,
               secondary_color text, logo_file_id uuid, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.id, c.slug, c.name, c.short_name, c.primary_color, c.secondary_color, c.logo_file_id,
         c.updated_at
    FROM "public"."club" c
   WHERE c.slug = club_slug
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."club_theme"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."club_theme"(text) TO "sport_performance_app", "sport_performance_worker";
