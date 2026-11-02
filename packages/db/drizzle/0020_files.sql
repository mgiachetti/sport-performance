CREATE TYPE "public"."file_kind" AS ENUM('club_logo', 'cmj_video', 'pdf_report', 'data_import');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('pending', 'ready', 'deleted');--> statement-breakpoint
CREATE TABLE "file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" "file_kind" NOT NULL,
	"status" "file_status" DEFAULT 'pending' NOT NULL,
	"player_id" uuid,
	"category_id" uuid,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"file_name" text,
	"uploaded_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	CONSTRAINT "file_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "file_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "file_size_positive" CHECK ("file"."size_bytes" > 0),
	CONSTRAINT "file_checksum_format" CHECK ("file"."checksum_sha256" ~ '^[A-Za-z0-9+/]{43}=$'),
	CONSTRAINT "file_content_type_format" CHECK ("file"."content_type" ~ '^[a-z]+/[a-z0-9.+-]+$'),
	CONSTRAINT "file_name_format" CHECK ("file"."file_name" is null or ("file"."file_name" = btrim("file"."file_name") and char_length("file"."file_name") between 1 and 200 and "file"."file_name" !~ '[[:cntrl:]/\\"]')),
	CONSTRAINT "file_subject" CHECK (("file"."kind" in ('cmj_video', 'pdf_report')) = ("file"."player_id" is not null) and ("file"."category_id" is null or "file"."kind" in ('data_import'))),
	CONSTRAINT "file_lifecycle" CHECK (("file"."status" <> 'ready' or "file"."uploaded_at" is not null) and ("file"."status" = 'deleted') = ("file"."deleted_at" is not null) and ("file"."purged_at" is null or "file"."status" = 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_category_id_fkey" FOREIGN KEY ("club_id","category_id") REFERENCES "public"."category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_player_id_idx" ON "file" USING btree ("club_id","player_id") WHERE "file"."player_id" is not null;--> statement-breakpoint
CREATE INDEX "file_category_id_idx" ON "file" USING btree ("club_id","category_id") WHERE "file"."category_id" is not null;--> statement-breakpoint
CREATE INDEX "file_kind_idx" ON "file" USING btree ("club_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "file_purge_idx" ON "file" USING btree ("club_id","expires_at") WHERE "file"."purged_at" is null;--> statement-breakpoint
CREATE INDEX "club_logo_file_id_idx" ON "club" USING btree ("id","logo_file_id") WHERE "club"."logo_file_id" is not null;--> statement-breakpoint

-- ─── Hand-written (B-325, ADR 0044) ──────────────────────────────────────────────────
-- `updated_at` trigger of the new club table (see 0001).
CREATE TRIGGER "file_set_updated_at" BEFORE UPDATE ON "file" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- Who reads a file follows what it is (ADR 0026, under the permission matrix of the API):
-- a file of a player (CMJ video, report) with the player scope; an import, the staff; the
-- crest, every member. Writers: sc (videos, imports) and the administration (crest, and
-- everything of the club); the worker writes the reports. Never deleted: the row stays as
-- the record of a purged object.
DO $$
DECLARE
  member constant text := '(SELECT "app"."current_role"()) IS NOT NULL';
  staff constant text := "app_admin"."role_in"('{coach,sc,medical,admin,superadmin}');
  player_scope constant text := '((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.file',
    format('CASE WHEN player_id IS NOT NULL THEN %s WHEN kind = %L THEN %s ELSE %s END',
           player_scope, 'data_import', staff, member),
    '{sc,admin,superadmin}');
END
$$;
--> statement-breakpoint

-- The crest of a club is one of its files (#44 left `logo_file_id` without a key until the
-- file table existed): `(id, logo_file_id)` → `file (club_id, id)`, so a club only points
-- at a file of its own. No file could be uploaded before this migration: any value set
-- until now points at nothing and is cleared.
UPDATE "club" SET "logo_file_id" = NULL WHERE "logo_file_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "club" ADD CONSTRAINT "club_logo_file_id_fkey" FOREIGN KEY ("id","logo_file_id") REFERENCES "public"."file"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Public theme by slug (ADR 0044): the crest only while its file is `ready` (a crest being
-- deleted is never signed), with its type, so its signed URL fixes the `Content-Type`.
DROP FUNCTION "app"."club_theme"(text);
--> statement-breakpoint
CREATE FUNCTION "app"."club_theme"(club_slug text)
RETURNS TABLE (id uuid, slug text, name text, short_name text, primary_color text,
               secondary_color text, logo_file_id uuid, logo_content_type text,
               updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.id, c.slug, c.name, c.short_name, c.primary_color, c.secondary_color, f.id,
         f.content_type, c.updated_at
    FROM "public"."club" c
    LEFT JOIN "public"."file" f
      ON f.club_id = c.id AND f.id = c.logo_file_id AND f.status = 'ready'
   WHERE c.slug = club_slug
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."club_theme"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."club_theme"(text) TO "sport_performance_app", "sport_performance_worker";
