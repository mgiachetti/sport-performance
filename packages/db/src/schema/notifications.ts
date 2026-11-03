import type { PlayerId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import { alert } from './alerts.js';
import { session, user } from './auth.js';
import { timestamptz } from './columns.js';
import {
  notificationChannelEnum,
  notificationKindEnum,
  notificationSkipReasonEnum,
  notificationStatusEnum,
  pushPlatformEnum,
  pushTicketStatusEnum,
} from './enums.js';
import { player } from './players.js';
import { tenantColumns, tenantConstraints, tenantReference } from './tenant.js';
import { trainingSession } from './training.js';

/**
 * Notifications (B-328, ADR 0054): push through Expo and email through
 * Resend, planned and delivered by the worker.
 */

/** Longest provider error code kept (`DeviceNotRegistered`, `MessageRateExceeded`, an HTTP status…). */
export const NOTIFICATION_FAILURE_CODE_MAX_LENGTH = 64;

/**
 * The Expo push token of one signed-in device. Global like the identity
 * tables (a device belongs to a user, not to a club): the worker sends a
 * club's notifications to the devices of that club's members. One token per
 * sign-in session, and a token belongs to one session only: signing in as
 * someone else on the same phone moves it. It goes with the session (sign
 * out, revocation, B-333) and with the user.
 *
 * RLS: no policy and no grant for any connection role. The API registers
 * and removes the caller's token through `app.register_push_token` /
 * `app.unregister_push_token`; the worker reads the tokens of the members of
 * its club through `app.worker_push_tokens` and forgets the ones Expo
 * reports as no longer registered (`app.worker_forget_push_token`).
 */
export const pushToken = pgTable(
  'push_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: pushPlatformEnum('platform').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('push_token_token_key').on(t.token),
    unique('push_token_session_id_key').on(t.sessionId),
    index('push_token_user_id_idx').on(t.userId),
    check(
      'push_token_format',
      sql`${t.token} ~ '^Expo(nent)?PushToken\\[[A-Za-z0-9_-]{8,200}\\]$'`,
    ),
  ],
);

/**
 * What a user changed of their notifications in a club, per kind (B-328).
 * `NULL` is the domain's default (`DEFAULT_NOTIFICATION_PREFERENCES`), so a
 * later change of a default reaches everyone who never chose. RLS: each user
 * reads and writes their own; the worker reads the club's.
 */
export const notificationPreference = pgTable(
  'notification_preference',
  {
    ...tenantColumns(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    push: boolean('push'),
    email: boolean('email'),
  },
  (t) => [
    ...tenantConstraints('notification_preference', t),
    unique('notification_preference_user_kind_key').on(t.clubId, t.userId, t.kind),
  ],
);

/**
 * One delivery: a recipient, a kind and a channel, idempotent by
 * `dedupe_key` (`session:<id>`, `alert:<id>`). The row never holds the text:
 * the worker renders it when sending, from ids, so nothing personal or
 * health related is stored or logged here. RLS: the recipient reads their
 * own; only the worker writes, and deletes past the retention.
 */
export const notification = pgTable(
  'notification',
  {
    ...tenantColumns(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    status: notificationStatusEnum('status').notNull().default('pending'),
    /** Not before this instant (the allowed hours already applied). */
    scheduledFor: timestamptz('scheduled_for').notNull(),
    /** The player it is about (RPE kinds, critical alerts); never shown in the text of an alert. */
    playerId: uuid('player_id').$type<PlayerId>(),
    trainingSessionId: uuid('training_session_id'),
    alertId: uuid('alert_id'),
    attempts: smallint('attempts').notNull().default(0),
    lastAttemptAt: timestamptz('last_attempt_at'),
    sentAt: timestamptz('sent_at'),
    skipReason: notificationSkipReasonEnum('skip_reason'),
    /** Provider or transport error code, never a message with personal data. */
    failureCode: text('failure_code'),
  },
  (t) => [
    ...tenantConstraints('notification', t),
    tenantReference('notification', t.clubId, t.playerId, player).onDelete('cascade'),
    tenantReference('notification', t.clubId, t.trainingSessionId, trainingSession).onDelete(
      'cascade',
    ),
    tenantReference('notification', t.clubId, t.alertId, alert).onDelete('cascade'),
    unique('notification_dedupe_key').on(t.clubId, t.userId, t.kind, t.channel, t.dedupeKey),
    index('notification_due_idx').on(t.clubId, t.status, t.scheduledFor),
    index('notification_user_idx').on(t.clubId, t.userId, t.createdAt),
    /** Retention: the oldest deliveries of a club first. */
    index('notification_created_idx').on(t.clubId, t.createdAt),
    index('notification_player_id_idx')
      .on(t.clubId, t.playerId)
      .where(sql`${t.playerId} is not null`),
    index('notification_training_session_id_idx')
      .on(t.clubId, t.trainingSessionId)
      .where(sql`${t.trainingSessionId} is not null`),
    index('notification_alert_id_idx')
      .on(t.clubId, t.alertId)
      .where(sql`${t.alertId} is not null`),
    check('notification_dedupe_key_format', sql`${t.dedupeKey} ~ '^[a-z_]+:[0-9a-f-]{36}$'`),
    check('notification_attempts', sql`${t.attempts} >= 0`),
    check('notification_sent', sql`(${t.status} = 'sent') = (${t.sentAt} is not null)`),
    check('notification_skipped', sql`(${t.status} = 'skipped') = (${t.skipReason} is not null)`),
    check(
      'notification_failure_code',
      sql`${t.failureCode} is null or ${t.failureCode} ~ '^[A-Za-z0-9_.:-]{1,${sql.raw(String(NOTIFICATION_FAILURE_CODE_MAX_LENGTH))}}$'`,
    ),
  ],
);

/**
 * A push ticket of Expo (one per device a notification went to) until its
 * receipt is read: a receipt `DeviceNotRegistered` forgets the token. The
 * token reference goes `NULL` when the token is gone. Only the worker reads
 * and writes it.
 */
export const pushTicket = pgTable(
  'push_ticket',
  {
    ...tenantColumns(),
    notificationId: uuid('notification_id').notNull(),
    pushTokenId: uuid('push_token_id').references(() => pushToken.id, { onDelete: 'set null' }),
    /** Expo's ticket id; `NULL` when the ticket was already an error. */
    ticketId: text('ticket_id'),
    status: pushTicketStatusEnum('status').notNull(),
    errorCode: text('error_code'),
    receiptCheckedAt: timestamptz('receipt_checked_at'),
  },
  (t) => [
    ...tenantConstraints('push_ticket', t),
    tenantReference('push_ticket', t.clubId, t.notificationId, notification).onDelete('cascade'),
    index('push_ticket_notification_idx').on(t.clubId, t.notificationId),
    index('push_ticket_pending_idx')
      .on(t.clubId, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    index('push_ticket_push_token_id_idx')
      .on(t.pushTokenId)
      .where(sql`${t.pushTokenId} is not null`),
    unique('push_ticket_club_id_ticket_id_key').on(t.clubId, t.ticketId),
    check('push_ticket_pending_has_id', sql`${t.status} <> 'pending' or ${t.ticketId} is not null`),
    check(
      'push_ticket_error_code',
      sql`(${t.status} = 'error') = (${t.errorCode} is not null) and (${t.errorCode} is null or ${t.errorCode} ~ '^[A-Za-z0-9_.:-]{1,${sql.raw(String(NOTIFICATION_FAILURE_CODE_MAX_LENGTH))}}$')`,
    ),
  ],
);
