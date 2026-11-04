import { addDays, type LocalDate } from '@sport-performance/domain';

export interface WellnessStreak {
  /** Consecutive club days with a check-in, up to today (or yesterday while today is pending). */
  readonly days: number;
  /** Today's check-in is part of it; `false` while the player can still keep it alive today. */
  readonly includesToday: boolean;
}

/**
 * The player's wellness streak (B-503): consecutive club days with a check-in
 * ending today. A streak that ended yesterday is still alive until today
 * closes, so it counts up to yesterday and says today is missing. Days are
 * club days (`LocalDate`, the club's time zone), never the phone's.
 */
export function wellnessStreak(checkInDays: Iterable<LocalDate>, today: LocalDate): WellnessStreak {
  const days = new Set(checkInDays);
  const includesToday = days.has(today);
  let day = includesToday ? today : addDays(today, -1);
  let count = 0;
  while (days.has(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return { days: count, includesToday };
}
