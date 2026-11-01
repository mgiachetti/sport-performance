import type { LocalDate } from '@sport-performance/domain';
import { date, timestamp } from 'drizzle-orm/pg-core';

/**
 * Column builders shared by every table. They have no dependency on other
 * schema modules, so every module can import them without cycles.
 */

/** An instant: `timestamptz`, read as a `Date`. Every instant is stored with time zone. */
export function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true, mode: 'date' });
}

/**
 * A calendar day in the club's time zone (`date`), read as the domain's
 * `LocalDate` string (`YYYY-MM-DD`). "The day" is always the club's day
 * (CLAUDE.md), so local dates are never derived from a UTC instant in SQL.
 */
export function localDate(name: string) {
  return date(name, { mode: 'string' }).$type<LocalDate>();
}
