import {
  isTimeZone,
  localDateInTimeZone,
  type LocalDate,
  type TimeZone,
} from '@sport-performance/domain';
import type { PreferenceStorage } from '../platform/storage.ts';

/**
 * "The day" of the club on the phone (CLAUDE.md: every club day is in the
 * club's time zone). The zone comes from `GET /v1/club` and is kept in the
 * plain preferences (it is no personal data), so the screens that pick a
 * club day work without signal.
 */

export const CLUB_TIME_ZONE_KEY_PREFIX = 'club.time_zone.';

export interface ClubTimeZoneStore {
  /** The last zone the API served for the club; `null` before the first one. */
  get(clubId: string): Promise<TimeZone | null>;
  save(clubId: string, timeZone: string): Promise<void>;
}

export function createClubTimeZoneStore(storage: PreferenceStorage): ClubTimeZoneStore {
  return {
    async get(clubId) {
      try {
        const stored = await storage.get(CLUB_TIME_ZONE_KEY_PREFIX + clubId);
        return stored !== null && isTimeZone(stored) ? stored : null;
      } catch {
        return null;
      }
    },
    async save(clubId, timeZone) {
      if (!isTimeZone(timeZone)) return;
      try {
        await storage.set(CLUB_TIME_ZONE_KEY_PREFIX + clubId, timeZone);
      } catch {
        // Best effort: the next visit asks the API again.
      }
    },
  };
}

/** The zone the phone is set to, the fallback before the club's is known. */
export function deviceTimeZone(): TimeZone | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** Today in `timeZone` at `nowMs`. */
export function clubDay(nowMs: number, timeZone: TimeZone): LocalDate {
  return localDateInTimeZone(nowMs, timeZone);
}
