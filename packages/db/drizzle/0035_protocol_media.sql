ALTER TYPE "public"."file_kind" ADD VALUE 'protocol_media';--> statement-breakpoint
CREATE TABLE "test_protocol_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"test_definition_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"caption" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "test_protocol_media_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "test_protocol_media_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "test_protocol_media_file_key" UNIQUE("club_id","test_definition_id","file_id"),
	CONSTRAINT "test_protocol_media_caption_format" CHECK ("test_protocol_media"."caption" = btrim("test_protocol_media"."caption") and char_length("test_protocol_media"."caption") between 1 and 200),
	CONSTRAINT "test_protocol_media_sort_order" CHECK ("test_protocol_media"."sort_order" between 0 and 999)
);
--> statement-breakpoint
ALTER TABLE "test_protocol_media" ADD CONSTRAINT "test_protocol_media_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_protocol_media" ADD CONSTRAINT "test_protocol_media_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_protocol_media" ADD CONSTRAINT "test_protocol_media_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_protocol_media" ADD CONSTRAINT "test_protocol_media_test_definition_id_fkey" FOREIGN KEY ("club_id","test_definition_id") REFERENCES "public"."test_definition"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_protocol_media" ADD CONSTRAINT "test_protocol_media_file_id_fkey" FOREIGN KEY ("club_id","file_id") REFERENCES "public"."file"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_protocol_media_order_idx" ON "test_protocol_media" USING btree ("club_id","test_definition_id","sort_order");--> statement-breakpoint
CREATE INDEX "test_protocol_media_file_id_idx" ON "test_protocol_media" USING btree ("club_id","file_id");--> statement-breakpoint

-- ─── Hand-written (B-415, ADR 0067) ──────────────────────────────────────────────────
-- `updated_at` trigger of the new club table (see 0001).
CREATE TRIGGER "test_protocol_media_set_updated_at" BEFORE UPDATE ON "test_protocol_media" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- Images and videos of a protocol may show a person: only the staff reads them (players and
-- guardians read the protocol text); `sc` and the administration attach and archive them,
-- like the rest of the club configuration. Never deleted: archived instead.
DO $$
DECLARE
  staff constant text := "app_admin"."role_in"('{coach,sc,medical,admin,superadmin}');
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.test_protocol_media', staff, '{sc,admin,superadmin}');
END
$$;
--> statement-breakpoint

-- The media files themselves follow the same rule (0020 left every club-wide file to every
-- member, the crest). `kind::text`: the new enum value cannot be used as a literal of the
-- type in the transaction that adds it.
DROP POLICY "file_app_select" ON "public"."file";
--> statement-breakpoint
DROP POLICY "file_app_insert" ON "public"."file";
--> statement-breakpoint
DROP POLICY "file_app_update" ON "public"."file";
--> statement-breakpoint
DO $$
DECLARE
  member constant text := '(SELECT "app"."current_role"()) IS NOT NULL';
  staff constant text := "app_admin"."role_in"('{coach,sc,medical,admin,superadmin}');
  writers constant text := "app_admin"."role_in"('{sc,admin,superadmin}');
  player_scope constant text := '((SELECT "app"."sees_whole_club"()) OR player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))';
  read_using text;
BEGIN
  read_using := format('CASE WHEN player_id IS NOT NULL THEN %s WHEN kind::text IN (%L, %L) THEN %s ELSE %s END',
                       player_scope, 'data_import', 'protocol_media', staff, member);
  EXECUTE format('CREATE POLICY "file_app_select" ON "public"."file" FOR SELECT TO "sport_performance_app" USING (%s)',
                 read_using);
  EXECUTE format('CREATE POLICY "file_app_insert" ON "public"."file" FOR INSERT TO "sport_performance_app" WITH CHECK (%s AND (%s) AND (true))',
                 writers, read_using);
  EXECUTE format('CREATE POLICY "file_app_update" ON "public"."file" FOR UPDATE TO "sport_performance_app" USING (%s AND (%s) AND (true)) WITH CHECK (%s AND (%s) AND (true))',
                 writers, read_using, writers, read_using);
END
$$;
