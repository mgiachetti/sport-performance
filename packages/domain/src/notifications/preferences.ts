import type { Role } from '../role.js';
import {
  NOTIFICATION_CHANNELS,
  notificationKindsForRole,
  type NotificationChannel,
  type NotificationKind,
} from './vocabularies.js';

/** Whether each channel is on, for one kind. */
export type NotificationChannelSwitches = Readonly<Record<NotificationChannel, boolean>>;

/**
 * Defaults when the user never touched a kind (B-328): push for every kind,
 * email only for critical alerts (the staff may be away from the app; the
 * rest is only useful right away, on the phone).
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<
  Record<NotificationKind, NotificationChannelSwitches>
> = Object.freeze({
  rpe_request: Object.freeze({ push: true, email: false }),
  rpe_reminder: Object.freeze({ push: true, email: false }),
  critical_alert: Object.freeze({ push: true, email: true }),
  pre_training_summary: Object.freeze({ push: true, email: false }),
});

/** A stored preference row: only what the user changed. */
export interface StoredNotificationPreference {
  readonly kind: NotificationKind;
  readonly push: boolean | null;
  readonly email: boolean | null;
}

export interface ResolvedNotificationPreference extends NotificationChannelSwitches {
  readonly kind: NotificationKind;
  /** Whether every channel is still at its default. */
  readonly isDefault: boolean;
}

/** One kind over the defaults (`null` = the default). */
export function resolveNotificationPreference(
  kind: NotificationKind,
  stored: Pick<StoredNotificationPreference, 'push' | 'email'> | undefined,
): ResolvedNotificationPreference {
  const defaults = DEFAULT_NOTIFICATION_PREFERENCES[kind];
  const push = stored?.push ?? defaults.push;
  const email = stored?.email ?? defaults.email;
  return { kind, push, email, isDefault: push === defaults.push && email === defaults.email };
}

/** The preferences of a role, in `NOTIFICATION_KINDS` order; rows of other kinds are ignored. */
export function resolveNotificationPreferences(
  role: Role,
  stored: readonly StoredNotificationPreference[],
): ResolvedNotificationPreference[] {
  return notificationKindsForRole(role).map((kind) =>
    resolveNotificationPreference(
      kind,
      stored.find((row) => row.kind === kind),
    ),
  );
}

/**
 * The value to store for one channel: `null` when it equals the default (so
 * a later change of the default reaches users who never chose).
 */
export function storedChannelValue(
  kind: NotificationKind,
  channel: NotificationChannel,
  value: boolean,
): boolean | null {
  return DEFAULT_NOTIFICATION_PREFERENCES[kind][channel] === value ? null : value;
}

/** The channels on for a kind. */
export function enabledChannels(preference: NotificationChannelSwitches): NotificationChannel[] {
  return NOTIFICATION_CHANNELS.filter((channel) => preference[channel]);
}
