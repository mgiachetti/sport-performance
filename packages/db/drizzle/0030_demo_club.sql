ALTER TABLE "club" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- ─── Hand-written (B-307, ADR 0055) ──────────────────────────────────────────────────
-- Only the owner of the migrations (the demo seed, superuser or BYPASSRLS) marks a club as
-- a demo or unmarks it. The app inserts clubs (a superadmin creating one, B-313) but never
-- with `is_demo`, and has no UPDATE grant on the column; the trigger also covers a future
-- grant by mistake. Same owner check as `club_slug_guard` (0009).
CREATE FUNCTION "public"."club_demo_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF ((TG_OP = 'INSERT' AND NEW.is_demo)
      OR (TG_OP = 'UPDATE' AND NEW.is_demo IS DISTINCT FROM OLD.is_demo))
     AND EXISTS (SELECT 1 FROM pg_roles r
                  WHERE r.rolname = session_user AND NOT r.rolsuper AND NOT r.rolbypassrls) THEN
    RAISE EXCEPTION 'Only the demo seed marks a club as a demo'
      USING ERRCODE = 'insufficient_privilege', TABLE = 'club', COLUMN = 'is_demo';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."club_demo_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "club_demo_guard" BEFORE INSERT OR UPDATE OF "is_demo" ON "public"."club"
  FOR EACH ROW EXECUTE FUNCTION "public"."club_demo_guard"();
