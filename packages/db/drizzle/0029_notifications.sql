CREATE TYPE "public"."notification_channel" AS ENUM('push', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('rpe_request', 'rpe_reminder', 'critical_alert', 'pre_training_summary');--> statement-breakpoint
CREATE TYPE "public"."notification_skip_reason" AS ENUM('preference_off', 'already_answered', 'window_closed', 'session_archived', 'session_started', 'alert_resolved', 'not_a_recipient', 'consent_missing', 'no_destination', 'expired');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sending', 'sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."push_platform" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TYPE "public"."push_ticket_status" AS ENUM('pending', 'ok', 'error');--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"player_id" uuid,
	"training_session_id" uuid,
	"alert_id" uuid,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"skip_reason" "notification_skip_reason",
	"failure_code" text,
	CONSTRAINT "notification_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "notification_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "notification_dedupe_key" UNIQUE("club_id","user_id","kind","channel","dedupe_key"),
	CONSTRAINT "notification_dedupe_key_format" CHECK ("notification"."dedupe_key" ~ '^[a-z_]+:[0-9a-f-]{36}$'),
	CONSTRAINT "notification_attempts" CHECK ("notification"."attempts" >= 0),
	CONSTRAINT "notification_sent" CHECK (("notification"."status" = 'sent') = ("notification"."sent_at" is not null)),
	CONSTRAINT "notification_skipped" CHECK (("notification"."status" = 'skipped') = ("notification"."skip_reason" is not null)),
	CONSTRAINT "notification_failure_code" CHECK ("notification"."failure_code" is null or "notification"."failure_code" ~ '^[A-Za-z0-9_.:-]{1,64}$')
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"push" boolean,
	"email" boolean,
	CONSTRAINT "notification_preference_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "notification_preference_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "notification_preference_user_kind_key" UNIQUE("club_id","user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "push_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"client_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"push_token_id" uuid,
	"ticket_id" text,
	"status" "push_ticket_status" NOT NULL,
	"error_code" text,
	"receipt_checked_at" timestamp with time zone,
	CONSTRAINT "push_ticket_club_id_id_key" UNIQUE("club_id","id"),
	CONSTRAINT "push_ticket_club_id_client_uuid_key" UNIQUE("club_id","client_uuid"),
	CONSTRAINT "push_ticket_club_id_ticket_id_key" UNIQUE("club_id","ticket_id"),
	CONSTRAINT "push_ticket_pending_has_id" CHECK ("push_ticket"."status" <> 'pending' or "push_ticket"."ticket_id" is not null),
	CONSTRAINT "push_ticket_error_code" CHECK (("push_ticket"."status" = 'error') = ("push_ticket"."error_code" is not null) and ("push_ticket"."error_code" is null or "push_ticket"."error_code" ~ '^[A-Za-z0-9_.:-]{1,64}$'))
);
--> statement-breakpoint
CREATE TABLE "push_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" "push_platform" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_token_token_key" UNIQUE("token"),
	CONSTRAINT "push_token_session_id_key" UNIQUE("session_id"),
	CONSTRAINT "push_token_format" CHECK ("push_token"."token" ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$')
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_player_id_fkey" FOREIGN KEY ("club_id","player_id") REFERENCES "public"."player"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_training_session_id_fkey" FOREIGN KEY ("club_id","training_session_id") REFERENCES "public"."training_session"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_alert_id_fkey" FOREIGN KEY ("club_id","alert_id") REFERENCES "public"."alert"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_ticket" ADD CONSTRAINT "push_ticket_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_ticket" ADD CONSTRAINT "push_ticket_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_ticket" ADD CONSTRAINT "push_ticket_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_ticket" ADD CONSTRAINT "push_ticket_push_token_id_push_token_id_fk" FOREIGN KEY ("push_token_id") REFERENCES "public"."push_token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_ticket" ADD CONSTRAINT "push_ticket_notification_id_fkey" FOREIGN KEY ("club_id","notification_id") REFERENCES "public"."notification"("club_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_token" ADD CONSTRAINT "push_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_token" ADD CONSTRAINT "push_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_due_idx" ON "notification" USING btree ("club_id","status","scheduled_for");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("club_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_created_idx" ON "notification" USING btree ("club_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_player_id_idx" ON "notification" USING btree ("club_id","player_id") WHERE "notification"."player_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_training_session_id_idx" ON "notification" USING btree ("club_id","training_session_id") WHERE "notification"."training_session_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_alert_id_idx" ON "notification" USING btree ("club_id","alert_id") WHERE "notification"."alert_id" is not null;--> statement-breakpoint
CREATE INDEX "push_ticket_notification_idx" ON "push_ticket" USING btree ("club_id","notification_id");--> statement-breakpoint
CREATE INDEX "push_ticket_pending_idx" ON "push_ticket" USING btree ("club_id","created_at") WHERE "push_ticket"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "push_ticket_push_token_id_idx" ON "push_ticket" USING btree ("push_token_id") WHERE "push_ticket"."push_token_id" is not null;--> statement-breakpoint
CREATE INDEX "push_token_user_id_idx" ON "push_token" USING btree ("user_id");--> statement-breakpoint
-- ─── Hand-written (B-328, ADR 0054): RLS, grants and the push token functions ────────
-- `updated_at` triggers of the new tables (see 0001).
CREATE TRIGGER "notification_set_updated_at" BEFORE UPDATE ON "notification" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "notification_preference_set_updated_at" BEFORE UPDATE ON "notification_preference" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "push_ticket_set_updated_at" BEFORE UPDATE ON "push_ticket" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "push_token_set_updated_at" BEFORE UPDATE ON "push_token" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint

-- Club tables (ADR 0026). Preferences: each member reads and writes their own (a parent has
-- no notification kinds, a superadmin is not a member). Deliveries: the recipient reads their
-- own; only the worker writes them. Push tickets go with their delivery (the subquery runs
-- under the policies of `notification`), written only by the worker.
DO $$
DECLARE
  own constant text := '(SELECT "app"."current_role"()) IS NOT NULL AND user_id = (SELECT "app"."current_user_id"())';
BEGIN
  PERFORM "app_admin"."secure_club_table"('public.notification_preference', own,
    '{player,coach,sc,medical,admin}');
  PERFORM "app_admin"."secure_club_table"('public.notification', own, '{}');
  PERFORM "app_admin"."secure_club_table"('public.push_ticket',
    'EXISTS (SELECT 1 FROM "public"."notification" n WHERE n.club_id = push_ticket.club_id AND n.id = push_ticket.notification_id)',
    '{}');
END
$$;
--> statement-breakpoint
-- Retention (ADR 0054): the worker deletes deliveries (and their tickets) past 90 days. The
-- record of a notification is operational, not evidence; nothing else of it is kept.
GRANT DELETE ON "public"."notification", "public"."push_ticket" TO "sport_performance_worker";
--> statement-breakpoint

-- ─── Push tokens (global, like known_device) ─────────────────────────────────────────
-- No policy and no grant for any connection role: the functions below are the only way in,
-- and each one checks who is asking.
ALTER TABLE "public"."push_token" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."push_token" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The caller's token for one of their live sign-in sessions (the API passes the session of
-- the request). A token belongs to one session: registering it from another session (someone
-- else signing in on the same phone) moves it, so a device never receives two people's
-- notifications.
CREATE FUNCTION "app"."register_push_token"(
  target_session text, device_token text, device_platform "public"."push_platform"
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  me constant text := "app"."current_user_id"();
  result uuid;
BEGIN
  IF me IS NULL OR NOT EXISTS (
    SELECT 1 FROM "public"."session" s
     WHERE s.id = target_session AND s.user_id = me AND s.expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'not a live session of the user' USING ERRCODE = '42501';
  END IF;
  -- Two sessions registering the same token at once: serialized on the token, so the second
  -- one (with a fresh snapshot after the lock) moves it instead of hitting push_token_token_key.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push_token:' || device_token, 0));
  DELETE FROM "public"."push_token" t WHERE t.token = device_token AND t.session_id <> target_session;
  INSERT INTO "public"."push_token" AS t (user_id, session_id, token, platform)
  VALUES (me, target_session, device_token, device_platform)
  ON CONFLICT (session_id) DO UPDATE
     SET token = EXCLUDED.token, platform = EXCLUDED.platform, user_id = EXCLUDED.user_id
  RETURNING t.id INTO result;
  RETURN result;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."register_push_token"(text, text, "public"."push_platform") FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."register_push_token"(text, text, "public"."push_platform") TO "sport_performance_app";
--> statement-breakpoint

-- Removes the token of one of the caller's sessions (sign out, notifications turned off on
-- the device). True if there was one.
CREATE FUNCTION "app"."unregister_push_token"(target_session text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  me constant text := "app"."current_user_id"();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'no user in the context' USING ERRCODE = '42501';
  END IF;
  DELETE FROM "public"."push_token" t WHERE t.session_id = target_session AND t.user_id = me;
  RETURN FOUND;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."unregister_push_token"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."unregister_push_token"(text) TO "sport_performance_app";
--> statement-breakpoint

-- The devices of the given users that the worker may notify for the club of the job: users
-- with an active membership in that club, sessions not expired. Nothing without a club.
CREATE FUNCTION "app"."worker_push_tokens"(users text[])
RETURNS TABLE (id uuid, user_id text, token text, platform "public"."push_platform")
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT t.id, t.user_id, t.token, t.platform
    FROM "public"."push_token" t
    JOIN "public"."session" s ON s.id = t.session_id
   WHERE t.user_id = ANY (users)
     AND s.expires_at > pg_catalog.now()
     AND EXISTS (SELECT 1 FROM "public"."membership" m
                  WHERE m.club_id = "app"."current_club_id"() AND m.user_id = t.user_id
                    AND m.ended_at IS NULL)
   ORDER BY t.user_id, t.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."worker_push_tokens"(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."worker_push_tokens"(text[]) TO "sport_performance_worker";
--> statement-breakpoint

-- Forgets a token Expo reports as no longer registered (the app was uninstalled), only for an
-- active member of the club of the job (the members `app.worker_push_tokens` reads). True if
-- it was there.
CREATE FUNCTION "app"."worker_forget_push_token"(token_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  DELETE FROM "public"."push_token" t
   WHERE t.id = token_id
     AND EXISTS (SELECT 1 FROM "public"."membership" m
                  WHERE m.club_id = "app"."current_club_id"() AND m.user_id = t.user_id
                    AND m.ended_at IS NULL);
  RETURN FOUND;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."worker_forget_push_token"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."worker_forget_push_token"(uuid) TO "sport_performance_worker";
