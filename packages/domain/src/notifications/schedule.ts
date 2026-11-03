import { majorityDate } from '../consent.js';
import {
  MINUTES_PER_DAY,
  addDays,
  compareLocalDates,
  instantAtLocalTime,
  localDateTimeInTimeZone,
  type Instant,
  type LocalDate,
  type TimeZone,
} from '../time.js';
import type { AllowedHours, NotificationSettings } from './settings.js';

const MS_PER_MINUTE = 60_000;

/** Whether a minute of the day falls inside the window `[from, to)` (crossing midnight if `to < from`). */
export function isWithinAllowedHours(minuteOfDay: number, hours: AllowedHours): boolean {
  const { fromMinute, toMinute } = hours;
  if (fromMinute < toMinute) return minuteOfDay >= fromMinute && minuteOfDay < toMinute;
  return minuteOfDay >= fromMinute || minuteOfDay < toMinute;
}

/**
 * The first instant at or after `at` inside the allowed hours, in the club's
 * zone: `at` itself when allowed, otherwise the next opening (today's or
 * tomorrow's). Correct across DST changes: the opening is the wall-clock
 * time, wherever the offset moved.
 */
export function nextAllowedInstant(at: Instant, timeZone: TimeZone, hours: AllowedHours): Date {
  const instant = new Date(at);
  const { date, minuteOfDay } = localDateTimeInTimeZone(instant, timeZone);
  if (isWithinAllowedHours(minuteOfDay, hours)) return instant;
  // Closed: the window opens later today (before `from`) or tomorrow (after `to`).
  const openingDay = minuteOfDay < hours.fromMinute ? date : addDays(date, 1);
  const opening = instantAtLocalTime(openingDay, hours.fromMinute % MINUTES_PER_DAY, timeZone);
  // A DST jump may skip the opening itself; never go back in time.
  return opening.getTime() > instant.getTime() ? opening : instant;
}

/** Whether a player born on `birthDate` is a minor on the club's day `onDate`. */
export function isMinorOn(birthDate: LocalDate, onDate: LocalDate): boolean {
  return compareLocalDates(onDate, majorityDate(birthDate)) < 0;
}

/** The allowed hours of a recipient: the minors' window for a minor player, else the general one. */
export function allowedHoursFor(settings: NotificationSettings, minor: boolean): AllowedHours {
  return minor ? settings.minorAllowedHours : settings.allowedHours;
}

export interface NotifiedSession {
  readonly startsAt: Instant;
  /** The club day of `startsAt`. */
  readonly localDate: LocalDate;
  readonly plannedDurationMin: number | null;
}

/** When a session ends: its start plus the planned duration (or the club's default). */
export function sessionEndsAt(session: NotifiedSession, settings: NotificationSettings): Date {
  const minutes = session.plannedDurationMin ?? settings.defaultSessionDurationMin;
  return new Date(new Date(session.startsAt).getTime() + minutes * MS_PER_MINUTE);
}

/** When the RPE is asked: the end of the session plus the club's delay (before the allowed hours). */
export function rpeRequestDueAt(session: NotifiedSession, settings: NotificationSettings): Date {
  return new Date(
    sessionEndsAt(session, settings).getTime() + settings.rpeRequestDelayMin * MS_PER_MINUTE,
  );
}

/** The morning after the session's club day, at the club's reminder time. */
export function rpeReminderDueAt(
  session: Pick<NotifiedSession, 'localDate'>,
  timeZone: TimeZone,
  settings: NotificationSettings,
): Date {
  return instantAtLocalTime(addDays(session.localDate, 1), settings.rpeReminderMinute, timeZone);
}

/** When the staff summary of a session goes out (before the allowed hours). */
export function preTrainingSummaryDueAt(
  session: Pick<NotifiedSession, 'startsAt'>,
  settings: NotificationSettings,
): Date {
  return new Date(
    new Date(session.startsAt).getTime() - settings.preTrainingSummaryLeadMin * MS_PER_MINUTE,
  );
}
