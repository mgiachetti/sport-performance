import {
  MINUTES_PER_DAY,
  instantAtLocalTime,
  isLocalDate,
  localDateTimeInTimeZone,
  type TimeZone,
} from '@sport-performance/domain';

/**
 * The start of a session as the staff types it: a day and a wall-clock time
 * **of the club** (CLAUDE.md: "el día" is the club's), whatever the time zone
 * of the browser. `<input type="date">` and `<input type="time">` give
 * `aaaa-mm-dd` and `HH:mm`.
 */

export interface LocalStart {
  readonly date: string;
  readonly time: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The club's day and time of an instant, for the inputs. */
export function toLocalStart(instant: string | Date, timeZone: TimeZone): LocalStart {
  const { date, minuteOfDay } = localDateTimeInTimeZone(new Date(instant), timeZone);
  return {
    date,
    time: `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`,
  };
}

/** Minute of the day of `HH:mm`, or `null`. */
export function parseTimeOfDay(value: string): number | null {
  const match = TIME.exec(value);
  if (match === null) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute < MINUTES_PER_DAY ? minute : null;
}

/** The instant (ISO) the club's clock shows `date` `time`, or `null` if either is invalid. */
export function fromLocalStart(start: LocalStart, timeZone: TimeZone): string | null {
  if (!isLocalDate(start.date)) return null;
  const minute = parseTimeOfDay(start.time);
  if (minute === null) return null;
  return instantAtLocalTime(start.date, minute, timeZone).toISOString();
}
