import { DomainValidationError, describeValue } from '../errors.js';
import { MINUTES_PER_DAY } from '../time.js';

/**
 * Club parameters of the notifications (`club.settings.notifications`,
 * B-328, ADR 0054). Partial JSON: missing keys take the defaults; an unknown
 * key or an invalid value throws, so a typo fails the worker's job loudly
 * instead of silently falling back (same rule as `settings.derived`).
 *
 * Wall-clock times are `HH:MM` in the club's zone.
 */

/** A daily window of wall-clock time `[from, to)`; `to` before `from` crosses midnight. */
export interface AllowedHours {
  /** Minute of the day it opens (inclusive). */
  readonly fromMinute: number;
  /** Minute of the day it closes (exclusive); `1440` for midnight at the end of the day. */
  readonly toMinute: number;
}

export interface NotificationSettings {
  /** Minutes after the end of a session before the RPE is asked (CR-10: 15–30 min after). */
  readonly rpeRequestDelayMin: number;
  /** Wall-clock time of the next morning's reminder. */
  readonly rpeReminderMinute: number;
  /** Duration assumed for a session without a planned duration. */
  readonly defaultSessionDurationMin: number;
  /** Minutes before a session the staff summary goes out. */
  readonly preTrainingSummaryLeadMin: number;
  /** Hours in which anyone may be notified. */
  readonly allowedHours: AllowedHours;
  /** Hours in which minors (under 18 on the club's day) may be notified. */
  readonly minorAllowedHours: AllowedHours;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = Object.freeze({
  rpeRequestDelayMin: 20,
  rpeReminderMinute: 8 * 60,
  defaultSessionDurationMin: 90,
  preTrainingSummaryLeadMin: 120,
  allowedHours: Object.freeze({ fromMinute: 7 * 60, toMinute: 22 * 60 }),
  minorAllowedHours: Object.freeze({ fromMinute: 8 * 60, toMinute: 21 * 60 }),
});

export const NOTIFICATION_SETTINGS_KEYS = [
  'rpeRequestDelayMin',
  'rpeReminderTime',
  'defaultSessionDurationMin',
  'preTrainingSummaryLeadMin',
  'allowedHours',
  'minorAllowedHours',
] as const;

function invalid(message: string, value: unknown): never {
  throw new DomainValidationError('invalid_argument', message, value);
}

function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${name} must be an object, got ${describeValue(value)}.`, value);
  }
}

function assertKnownKeys(value: Record<string, unknown>, keys: readonly string[], name: string) {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length > 0) invalid(`Unknown ${name} parameters: ${unknown.join(', ')}.`, value);
}

function integerInRange(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    invalid(
      `${name} must be an integer from ${String(min)} to ${String(max)}, got ${describeValue(value)}.`,
      value,
    );
  }
  return value;
}

const WALL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `HH:MM` (00:00–23:59) as a minute of the day; `24:00` only where `allowEndOfDay`. */
export function parseWallTime(value: unknown, name: string, allowEndOfDay = false): number {
  if (allowEndOfDay && value === '24:00') return MINUTES_PER_DAY;
  const match = typeof value === 'string' ? WALL_TIME.exec(value) : null;
  if (match === null) invalid(`${name} must be a time HH:MM, got ${describeValue(value)}.`, value);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** A minute of the day as `HH:MM`. */
export function formatWallTime(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function resolveAllowedHours(value: unknown, name: string, fallback: AllowedHours): AllowedHours {
  if (value === undefined) return fallback;
  assertObject(value, name);
  assertKnownKeys(value, ['from', 'to'], name);
  const fromMinute =
    value.from === undefined ? fallback.fromMinute : parseWallTime(value.from, `${name}.from`);
  const toMinute =
    value.to === undefined ? fallback.toMinute : parseWallTime(value.to, `${name}.to`, true);
  if (fromMinute === toMinute % MINUTES_PER_DAY) {
    invalid(`${name} must open and close at different times.`, value);
  }
  return Object.freeze({ fromMinute, toMinute });
}

/**
 * Validates `club.settings.notifications` (any JSON, possibly absent) and
 * fills it with the defaults. Throws {@link DomainValidationError}.
 */
export function resolveNotificationSettings(settings: unknown = {}): NotificationSettings {
  if (settings === undefined || settings === null) return DEFAULT_NOTIFICATION_SETTINGS;
  assertObject(settings, 'notification settings');
  assertKnownKeys(settings, NOTIFICATION_SETTINGS_KEYS, 'notifications');
  const d = DEFAULT_NOTIFICATION_SETTINGS;
  return Object.freeze({
    rpeRequestDelayMin:
      settings.rpeRequestDelayMin === undefined
        ? d.rpeRequestDelayMin
        : integerInRange(settings.rpeRequestDelayMin, 'rpeRequestDelayMin', 0, 240),
    rpeReminderMinute:
      settings.rpeReminderTime === undefined
        ? d.rpeReminderMinute
        : parseWallTime(settings.rpeReminderTime, 'rpeReminderTime'),
    defaultSessionDurationMin:
      settings.defaultSessionDurationMin === undefined
        ? d.defaultSessionDurationMin
        : integerInRange(settings.defaultSessionDurationMin, 'defaultSessionDurationMin', 1, 600),
    preTrainingSummaryLeadMin:
      settings.preTrainingSummaryLeadMin === undefined
        ? d.preTrainingSummaryLeadMin
        : integerInRange(settings.preTrainingSummaryLeadMin, 'preTrainingSummaryLeadMin', 15, 720),
    allowedHours: resolveAllowedHours(settings.allowedHours, 'allowedHours', d.allowedHours),
    minorAllowedHours: resolveAllowedHours(
      settings.minorAllowedHours,
      'minorAllowedHours',
      d.minorAllowedHours,
    ),
  });
}
