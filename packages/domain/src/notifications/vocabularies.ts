import { memberGuard, memberParser } from '../enum.js';
import type { Role } from '../role.js';

/**
 * Notifications (B-328, ADR 0054). Every notification is an operational
 * nudge: it never carries health data, metric values or, next to an alert, a
 * player's name. The texts are in `packages/i18n` (`notification.<kind>.*`).
 *
 * - `rpe_request`: to the player, when the session ends (plus a delay).
 * - `rpe_reminder`: to the player, the next morning, if the RPE is still missing.
 * - `critical_alert`: to the assigned staff, when a critical alert appears.
 * - `pre_training_summary`: to the assigned staff, before a session.
 */
export const NOTIFICATION_KINDS = [
  'rpe_request',
  'rpe_reminder',
  'critical_alert',
  'pre_training_summary',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export const isNotificationKind = memberGuard(NOTIFICATION_KINDS);
export const parseNotificationKind = memberParser(
  NOTIFICATION_KINDS,
  'invalid_argument',
  'notification kind',
);

export const NOTIFICATION_CHANNELS = ['push', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const isNotificationChannel = memberGuard(NOTIFICATION_CHANNELS);
export const parseNotificationChannel = memberParser(
  NOTIFICATION_CHANNELS,
  'invalid_argument',
  'notification channel',
);

/**
 * Life of one delivery (one recipient, one channel):
 * `pending` (due at `scheduled_for`) → `sending` (claimed by the worker) →
 * `sent`, `skipped` (no longer applies, or nothing to send it to) or
 * `failed` (the provider refused it, or every attempt failed).
 */
export const NOTIFICATION_STATUSES = ['pending', 'sending', 'sent', 'skipped', 'failed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export const isNotificationStatus = memberGuard(NOTIFICATION_STATUSES);
export const parseNotificationStatus = memberParser(
  NOTIFICATION_STATUSES,
  'invalid_argument',
  'notification status',
);

/** Why a delivery was skipped, checked again right before sending. */
export const NOTIFICATION_SKIP_REASONS = [
  /** The user turned the kind off for the channel. */
  'preference_off',
  /** The player already reported the RPE. */
  'already_answered',
  /** The RPE window closed before the notification could go out. */
  'window_closed',
  /** The session was archived (cancelled). */
  'session_archived',
  /** The session already started (a summary that could not go out in time). */
  'session_started',
  /** The alert was acknowledged or is no longer critical. */
  'alert_resolved',
  /** The player left the club or the recipient's membership ended. */
  'not_a_recipient',
  /** The player has no current data consent: their data is not collected. */
  'consent_missing',
  /** No registered device (push) or no deliverable address (email). */
  'no_destination',
  /** Waited too long for the allowed hours: it no longer makes sense. */
  'expired',
  /**
   * A demo club (`club.is_demo`, ADR 0055): its accounts are fictitious, so
   * nothing is delivered, except to the catch-all domains the worker allows.
   */
  'demo_club',
] as const;
export type NotificationSkipReason = (typeof NOTIFICATION_SKIP_REASONS)[number];
export const isNotificationSkipReason = memberGuard(NOTIFICATION_SKIP_REASONS);

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];
export const isPushPlatform = memberGuard(PUSH_PLATFORMS);
export const parsePushPlatform = memberParser(PUSH_PLATFORMS, 'invalid_argument', 'push platform');

/** A push ticket (Expo) until its receipt is read. */
export const PUSH_TICKET_STATUSES = ['pending', 'ok', 'error'] as const;
export type PushTicketStatus = (typeof PUSH_TICKET_STATUSES)[number];
export const isPushTicketStatus = memberGuard(PUSH_TICKET_STATUSES);

/** Who each kind is for. */
export const NOTIFICATION_AUDIENCES = ['player', 'staff'] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_KIND_AUDIENCE: Readonly<Record<NotificationKind, NotificationAudience>> =
  Object.freeze({
    rpe_request: 'player',
    rpe_reminder: 'player',
    critical_alert: 'staff',
    pre_training_summary: 'staff',
  });

/** Club roles that receive the staff kinds (when an assignment covers the player or category). */
export const NOTIFIED_STAFF_ROLES = ['coach', 'sc', 'medical', 'admin'] as const;
export type NotifiedStaffRole = (typeof NOTIFIED_STAFF_ROLES)[number];
export const isNotifiedStaffRole = memberGuard(NOTIFIED_STAFF_ROLES);

/**
 * The kinds a role may receive (and set preferences for). A parent receives
 * none (out of B-328); a superadmin is never a member, so none either.
 */
export function notificationKindsForRole(role: Role): readonly NotificationKind[] {
  const audience: NotificationAudience | null =
    role === 'player' ? 'player' : isNotifiedStaffRole(role) ? 'staff' : null;
  if (audience === null) return [];
  return NOTIFICATION_KINDS.filter((kind) => NOTIFICATION_KIND_AUDIENCE[kind] === audience);
}

/**
 * Expo push token (`ExponentPushToken[…]` or the older `ExpoPushToken[…]`).
 * The inner value is opaque; it is bounded so a stored token can never be a
 * payload of its own.
 */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;
export const EXPO_PUSH_TOKEN_MAX_LENGTH = 230;

export function isExpoPushToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= EXPO_PUSH_TOKEN_MAX_LENGTH &&
    EXPO_PUSH_TOKEN_PATTERN.test(value)
  );
}
