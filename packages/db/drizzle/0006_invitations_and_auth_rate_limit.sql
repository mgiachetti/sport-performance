CREATE TABLE "auth_rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_rate_limit_count_positive" CHECK ("auth_rate_limit"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "invitation_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "invitation_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "invitation_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "invitation_email_lowercase" CHECK ("invitation"."email" = lower("invitation"."email")),
	CONSTRAINT "invitation_token_hash_format" CHECK ("invitation"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "invitation_single_outcome" CHECK ("invitation"."accepted_at" is null or "invitation"."revoked_at" is null),
	CONSTRAINT "invitation_accepted_by" CHECK ("invitation"."accepted_by" is null or "invitation"."accepted_at" is not null),
	CONSTRAINT "invitation_revoked_by" CHECK ("invitation"."revoked_by" is null or "invitation"."revoked_at" is not null),
	CONSTRAINT "invitation_expiry" CHECK ("invitation"."expires_at" > "invitation"."created_at")
);
--> statement-breakpoint
CREATE TABLE "invitation_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "invitation_category_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "invitation_category_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "invitation_category_invitation_category_key" UNIQUE("club_id","invitation_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_category" ADD CONSTRAINT "invitation_category_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_category" ADD CONSTRAINT "invitation_category_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_category" ADD CONSTRAINT "invitation_category_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_category" ADD CONSTRAINT "invitation_category_invitation_id_fkey" FOREIGN KEY ("club_id","invitation_id") REFERENCES "public"."invitation"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_category" ADD CONSTRAINT "invitation_category_category_id_fkey" FOREIGN KEY ("club_id","category_id") REFERENCES "public"."category"("club_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_rate_limit_window_ends_at_idx" ON "auth_rate_limit" USING btree ("window_ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_key" ON "invitation" USING btree ("club_id","email","role") WHERE "invitation"."accepted_at" is null and "invitation"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "invitation_category_category_idx" ON "invitation_category" USING btree ("club_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_assignment_open_category_key" ON "staff_assignment" USING btree ("club_id","membership_id","category_id") WHERE "staff_assignment"."valid_to" is null;--> statement-breakpoint
-- Hand-written (B-309): `updated_at` trigger of the new club tables (see 0001).
CREATE TRIGGER "invitation_set_updated_at" BEFORE UPDATE ON "invitation" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "invitation_category_set_updated_at" BEFORE UPDATE ON "invitation_category" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
-- RLS and grants (ADR 0026, ADR 0028). Like every migration, this runs as a superuser or a
-- role with BYPASSRLS (checked by 0004): the SECURITY DEFINER functions below are owned by it.
--
-- Invitations are managed by the club's admin (and a superadmin supporting the club) inside
-- the club context: nobody else reads them, not even the rest of the staff (they carry the
-- email of someone who is not a member yet). The worker reads and writes the club of its job
-- (the invitation email moves to a job, ADR 0011). No DELETE: an invitation ends accepted,
-- revoked or expired, and stays as the record of who invited whom.
DO $$
DECLARE
  admin_only constant text := "app_admin"."role_in"('{admin,superadmin}');
  admin constant text[] := '{admin,superadmin}';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.invitation', admin_only, admin);
  PERFORM "app_admin"."secure_club_table"('public.invitation_category', admin_only, admin);
END
$$;
--> statement-breakpoint
-- Narrower than the standard grant: the API only revokes invitations (the link, email, role
-- and acceptance never change after creation; accepting goes through accept_invitation), and
-- never edits a category scope. Revoking the table privilege drops its column privileges too.
REVOKE UPDATE ON "public"."invitation", "public"."invitation_category" FROM "sport_performance_app";
--> statement-breakpoint
GRANT UPDATE ("revoked_at", "revoked_by", "updated_at", "updated_by") ON "public"."invitation" TO "sport_performance_app";
--> statement-breakpoint
GRANT UPDATE ("updated_at", "updated_by") ON "public"."invitation_category" TO "sport_performance_app";
--> statement-breakpoint

-- Attempt counters of the sign-in flow: global (no club), only for Better Auth's role, which
-- counts, resets and prunes them. The API and the worker never see them.
ALTER TABLE "public"."auth_rate_limit" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."auth_rate_limit" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "auth_rate_limit_auth_all" ON "public"."auth_rate_limit" FOR ALL TO "sport_performance_auth" USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."auth_rate_limit" TO "sport_performance_auth";
--> statement-breakpoint

-- ─── Invitations by token, outside any club context ──────────────────────────────────
-- Whoever opens the link is not a member of the club yet, so the club policies cannot let
-- them see the invitation. The token (256 random bits) is the capability: these functions
-- find exactly the invitation whose SHA-256 matches and nothing else, and only the API's role
-- may call them (by IP rate limited in the API).

-- What the landing page of the link shows: the club, the role, the email (masked by the API)
-- and the state. No ids of people, no categories.
CREATE FUNCTION "app"."invitation_by_token"(invitation_token_hash text)
RETURNS TABLE (
  club_id uuid,
  club_slug text,
  club_name text,
  email text,
  role "public"."membership_role",
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.club_id, c.slug, c.name, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at
    FROM "public"."invitation" i
    JOIN "public"."club" c ON c.id = i.club_id
   WHERE i.token_hash = invitation_token_hash
$$;
--> statement-breakpoint

-- Accepts the invitation of the token for the user of the context (`app.user_id`, set by the
-- API from the Better Auth session; no club in the context). Strict: the invitation must be
-- pending at the database's clock and addressed to that user's email (read here, never taken
-- from the caller). Creates the membership (`invited_by`) unless an active one with that role
-- exists, the staff assignments of its categories (coach, sc, medical) from the club's day,
-- and marks the invitation accepted. The row lock makes two accepts of one link sequential.
--
-- Idempotent for its own user: accepting again an invitation that user already accepted
-- (a retry after a lost response) answers `joined` with the active membership, unchanged.
--
-- `outcome`: joined | not_found | accepted | revoked | expired | wrong_email. Only `joined`
-- returns the membership (and whether this call created it).
CREATE FUNCTION "app"."accept_invitation"(invitation_token_hash text)
RETURNS TABLE (outcome text, joined_membership_id uuid, membership_created boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  caller text := "app"."current_user_id"();
  caller_email text;
  inv record;
  active uuid;
  inserted boolean := false;
BEGIN
  IF caller IS NULL OR "app"."current_club_id"() IS NOT NULL THEN
    RAISE EXCEPTION 'accept_invitation runs with app.user_id and without app.club_id'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT u.email INTO caller_email FROM "public"."user" u WHERE u.id = caller;
  IF caller_email IS NULL THEN
    RAISE EXCEPTION 'accept_invitation: app.user_id is not a user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT i.id, i.club_id, i.email, i.role, i.expires_at, i.accepted_at, i.accepted_by,
         i.revoked_at, i.created_by, c.time_zone
    INTO inv
    FROM "public"."invitation" i
    JOIN "public"."club" c ON c.id = i.club_id
   WHERE i.token_hash = invitation_token_hash
     FOR UPDATE OF i;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, false;
    RETURN;
  END IF;
  IF inv.accepted_at IS NOT NULL THEN
    IF inv.accepted_by = caller THEN
      SELECT m.id INTO active
        FROM "public"."membership" m
       WHERE m.club_id = inv.club_id AND m.user_id = caller AND m.role = inv.role AND m.ended_at IS NULL;
      IF active IS NOT NULL THEN
        RETURN QUERY SELECT 'joined'::text, active, false;
        RETURN;
      END IF;
    END IF;
    RETURN QUERY SELECT 'accepted'::text, NULL::uuid, false;
    RETURN;
  END IF;
  IF inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revoked'::text, NULL::uuid, false;
    RETURN;
  END IF;
  IF inv.expires_at <= pg_catalog.now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::uuid, false;
    RETURN;
  END IF;
  IF inv.email <> pg_catalog.lower(caller_email) THEN
    RETURN QUERY SELECT 'wrong_email'::text, NULL::uuid, false;
    RETURN;
  END IF;

  SELECT m.id INTO active
    FROM "public"."membership" m
   WHERE m.club_id = inv.club_id AND m.user_id = caller AND m.role = inv.role AND m.ended_at IS NULL;
  IF active IS NULL THEN
    INSERT INTO "public"."membership" (club_id, user_id, role, invited_by, created_by, updated_by)
    VALUES (inv.club_id, caller, inv.role, inv.created_by, caller, caller)
    -- A concurrent accept of another invitation for the same role: keep the first.
    ON CONFLICT DO NOTHING
    RETURNING id INTO active;
    inserted := active IS NOT NULL;
    IF active IS NULL THEN
      SELECT m.id INTO active
        FROM "public"."membership" m
       WHERE m.club_id = inv.club_id AND m.user_id = caller AND m.role = inv.role AND m.ended_at IS NULL;
    END IF;
    IF active IS NULL THEN
      RAISE EXCEPTION 'accept_invitation: membership not found after insert';
    END IF;
  END IF;

  IF inv.role IN ('coach', 'sc', 'medical') THEN
    INSERT INTO "public"."staff_assignment" (club_id, membership_id, category_id, valid_from, created_by, updated_by)
    SELECT inv.club_id, active, ic.category_id, (pg_catalog.now() AT TIME ZONE inv.time_zone)::date, caller, caller
      FROM "public"."invitation_category" ic
     WHERE ic.club_id = inv.club_id AND ic.invitation_id = inv.id
       AND NOT EXISTS (SELECT 1 FROM "public"."staff_assignment" sa
                        WHERE sa.club_id = inv.club_id AND sa.membership_id = active
                          AND sa.category_id = ic.category_id AND sa.valid_to IS NULL)
    -- staff_assignment_open_category_key: a concurrent accept for the same membership.
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE "public"."invitation"
     SET accepted_at = pg_catalog.now(), accepted_by = caller, updated_by = caller
   WHERE id = inv.id;

  RETURN QUERY SELECT 'joined'::text, active, inserted;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."invitation_by_token"(text), "app"."accept_invitation"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."invitation_by_token"(text), "app"."accept_invitation"(text) TO "sport_performance_app";
