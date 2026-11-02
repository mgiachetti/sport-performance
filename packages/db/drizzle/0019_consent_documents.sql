CREATE TABLE "consent_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"type" "consent_type" NOT NULL,
	"version" text NOT NULL,
	"locale" text DEFAULT 'es-AR' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"body_sha256" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_document_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "consent_document_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "consent_document_version_format" CHECK ("consent_document"."version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' and char_length("consent_document"."version") <= 40),
	CONSTRAINT "consent_document_locale_format" CHECK ("consent_document"."locale" ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "consent_document_text" CHECK ("consent_document"."title" = btrim("consent_document"."title") and "consent_document"."title" <> '' and btrim("consent_document"."body") <> '')
);
--> statement-breakpoint
ALTER TABLE "consent" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "consent_document" ADD CONSTRAINT "consent_document_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_document" ADD CONSTRAINT "consent_document_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_document" ADD CONSTRAINT "consent_document_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_document_version_key" ON "consent_document" USING btree ("club_id","type","version");--> statement-breakpoint
CREATE INDEX "consent_document_current_idx" ON "consent_document" USING btree ("club_id","type","published_at");--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_document_id_fkey" FOREIGN KEY ("club_id","document_id") REFERENCES "public"."consent_document"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_document_id_idx" ON "consent" USING btree ("club_id","document_id") WHERE "consent"."document_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_current_document_key" ON "consent" USING btree ("club_id","player_id","document_id") WHERE "consent"."revoked_at" is null and "consent"."document_id" is not null;--> statement-breakpoint

-- ─── Hand-written (B-312, ADR 0043) ──────────────────────────────────────────────────
-- `updated_at` trigger of the new club table (see 0001), even if the guard below rejects
-- every change of its content: the audit columns follow the same rules everywhere.
CREATE TRIGGER "consent_document_set_updated_at" BEFORE UPDATE ON "consent_document" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- Consent texts are what the signer read: once published they never change, not even for
-- the owner. A new text is a new version. Only `created_by` / `updated_by` may become NULL,
-- which is what `ON DELETE SET NULL` does when the author's account is deleted. No DELETE.
-- On insert it computes `body_sha256` (UTF-8, hex), whatever the client sent.
CREATE FUNCTION "public"."consent_document_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.body_sha256 := encode(sha256(convert_to(NEW.body, 'UTF8')), 'hex');
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A published consent text is evidence: it is never deleted'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_document_immutable',
            TABLE = 'consent_document';
  END IF;
  IF (NEW.id, NEW.club_id, NEW.client_uuid, NEW.created_at, NEW.type, NEW.version, NEW.locale,
      NEW.title, NEW.body, NEW.body_sha256, NEW.published_at)
     IS DISTINCT FROM
     (OLD.id, OLD.club_id, OLD.client_uuid, OLD.created_at, OLD.type, OLD.version, OLD.locale,
      OLD.title, OLD.body, OLD.body_sha256, OLD.published_at)
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL)
     OR (NEW.updated_by IS DISTINCT FROM OLD.updated_by AND NEW.updated_by IS NOT NULL) THEN
    RAISE EXCEPTION 'A published consent text never changes: publish a new version'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_document_immutable',
            TABLE = 'consent_document';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."consent_document_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "consent_document_guard" BEFORE INSERT OR UPDATE OR DELETE ON "public"."consent_document"
  FOR EACH ROW EXECUTE FUNCTION "public"."consent_document_guard"();
--> statement-breakpoint

-- Every member reads the texts (they sign them, the staff shows them); the administration
-- publishes them (matrix: club.update). Nothing updates them (guard above): no UPDATE grant.
DO $$
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.consent_document',
    '(SELECT "app"."current_role"()) IS NOT NULL', '{admin,superadmin}');
END
$$;
--> statement-breakpoint
REVOKE UPDATE ON "public"."consent_document" FROM "sport_performance_app", "sport_performance_worker";
--> statement-breakpoint

-- A consent is evidence (Ley 25.326): after the insert only the revocation changes, once
-- (`revoked_at` and `revoked_by` from NULL to a value; the CHECK `consent_revocation` keeps
-- them together). `created_by` / `updated_by` may only become NULL (account deleted). On
-- insert, the text it references must be of the same type and version; the connection roles
-- (not the owner's maintenance) always reference one.
CREATE FUNCTION "public"."consent_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  doc_type "public"."consent_type";
  doc_version text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.document_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM pg_roles r
                  WHERE r.rolname = session_user AND NOT r.rolsuper AND NOT r.rolbypassrls) THEN
        RAISE EXCEPTION 'A consent references the text that was signed (document_id)'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_document_required',
                TABLE = 'consent';
      END IF;
      RETURN NEW;
    END IF;
    SELECT d.type, d.version INTO doc_type, doc_version
      FROM "public"."consent_document" d
     WHERE d.club_id = NEW.club_id AND d.id = NEW.document_id;
    -- A missing document is left to the foreign key (23503).
    IF FOUND AND (doc_type, doc_version) IS DISTINCT FROM (NEW.type, NEW.document_version) THEN
      RAISE EXCEPTION 'The type and version of a consent are those of its text'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_document_match',
              TABLE = 'consent';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.club_id, NEW.client_uuid, NEW.created_at, NEW.player_id, NEW.type,
      NEW.document_version, NEW.document_id, NEW.signer_kind, NEW.signed_by, NEW.signed_at)
     IS DISTINCT FROM
     (OLD.id, OLD.club_id, OLD.client_uuid, OLD.created_at, OLD.player_id, OLD.type,
      OLD.document_version, OLD.document_id, OLD.signer_kind, OLD.signed_by, OLD.signed_at)
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL)
     OR (OLD.revoked_at IS NOT NULL
         AND (NEW.revoked_at, NEW.revoked_by) IS DISTINCT FROM (OLD.revoked_at, OLD.revoked_by)) THEN
    RAISE EXCEPTION 'A signed consent only changes to be revoked, once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'consent_immutable', TABLE = 'consent';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."consent_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "consent_guard" BEFORE INSERT OR UPDATE ON "public"."consent"
  FOR EACH ROW EXECUTE FUNCTION "public"."consent_guard"();
--> statement-breakpoint

-- Consent writes follow the permission matrix (consent.sign / consent.revoke): only the
-- holder, the guardian of a minor or the player once of age, on a player they see. They
-- sign as themselves, with the signer kind of their role, and revoke as themselves any
-- current consent of the player (also one another guardian signed). Admin and superadmin
-- no longer write consents (0004 let them record one signed on paper; the matrix never did).
DROP POLICY "consent_app_insert" ON "public"."consent";
--> statement-breakpoint
DROP POLICY "consent_app_update" ON "public"."consent";
--> statement-breakpoint
CREATE POLICY "consent_app_insert" ON "public"."consent" FOR INSERT TO "sport_performance_app" WITH CHECK (
  (SELECT "app"."current_role"()) IN ('parent', 'player')
  AND player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[])
  AND signed_by = (SELECT "app"."current_user_id"())
  AND signer_kind = CASE (SELECT "app"."current_role"()) WHEN 'parent' THEN 'guardian'::"public"."consent_signer"
                                                          ELSE 'player'::"public"."consent_signer" END
  AND revoked_at IS NULL AND revoked_by IS NULL);
--> statement-breakpoint
CREATE POLICY "consent_app_update" ON "public"."consent" FOR UPDATE TO "sport_performance_app"
  USING (
    (SELECT "app"."current_role"()) IN ('parent', 'player')
    AND player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[]))
  WITH CHECK (
    (SELECT "app"."current_role"()) IN ('parent', 'player')
    AND player_id = ANY ((SELECT "app"."visible_player_ids"())::uuid[])
    AND revoked_by = (SELECT "app"."current_user_id"()));
--> statement-breakpoint

-- One definition of a current consent (signed, not revoked) for the API, the policies and
-- the medical schema: the types a player of the context's club has, if the context sees the
-- player (admin/superadmin the club; the rest their visible players). Empty otherwise.
CREATE FUNCTION "app"."current_consent_types"(player uuid) RETURNS "public"."consent_type"[]
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT c.type ORDER BY c.type), '{}')
    FROM "public"."consent" c
   WHERE c.club_id = "app"."current_club_id"() AND c.player_id = player
     AND c.revoked_at IS NULL AND c.signed_at <= now()
     AND ("app"."sees_whole_club"() OR player = ANY ("app"."visible_player_ids"()))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."current_consent_types"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."current_consent_types"(uuid) TO "sport_performance_app";
--> statement-breakpoint

-- The medical schema (0007) asks the same question: same answer for the players it asks
-- about (always visible to the context: the medical role's assigned players, the holder's own).
CREATE OR REPLACE FUNCTION "medical"."has_health_consent"(player uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT 'health'::"public"."consent_type" = ANY ("app"."current_consent_types"(player))
$$;
