import { DomainValidationError } from '../errors.js';
import {
  addDays,
  dayBoundsInTimeZone,
  type Instant,
  type LocalDate,
  type TimeZone,
} from '../time.js';

/**
 * When a player may submit (or correct) the session RPE (B-318). CR-10 is
 * asked 15–30 min after the session, or the next morning (CLAUDE.md): the
 * window opens when the session starts (the app prompts at its end, B-328)
 * and closes at the end of the club day `closeAfterClubDays` after the
 * session's day. After that the value is no longer a recall of the session
 * and is not accepted.
 */
export interface RpeWindowParameters {
  /** Whole club days after the session's day the window stays open (`1`: until the end of the next day). */
  readonly closeAfterClubDays: number;
}

export const DEFAULT_RPE_WINDOW: RpeWindowParameters = { closeAfterClubDays: 1 };

/** Longest window accepted, in club days after the session's day. */
export const MAX_RPE_WINDOW_CLUB_DAYS = 7;

export interface RpeWindowSession {
  /** Start of the session. */
  readonly startsAt: Instant;
  /** The club day of `startsAt` (`training_session.local_date`). */
  readonly localDate: LocalDate;
}

export interface RpeWindow {
  /** First instant a submission is accepted (inclusive). */
  readonly opensAt: Date;
  /** First instant it is no longer accepted (exclusive). */
  readonly closesAt: Date;
}

/** The RPE window of a session in the club's time zone. */
export function rpeSubmissionWindow(
  session: RpeWindowSession,
  timeZone: TimeZone,
  parameters: RpeWindowParameters = DEFAULT_RPE_WINDOW,
): RpeWindow {
  const days = parameters.closeAfterClubDays;
  if (!Number.isInteger(days) || days < 0 || days > MAX_RPE_WINDOW_CLUB_DAYS) {
    throw new DomainValidationError(
      'invalid_argument',
      `closeAfterClubDays must be an integer from 0 to ${String(MAX_RPE_WINDOW_CLUB_DAYS)}`,
      days,
    );
  }
  const opensAt = new Date(session.startsAt);
  const { end } = dayBoundsInTimeZone(addDays(session.localDate, days), timeZone);
  return { opensAt, closesAt: end };
}

/** Where an instant falls relative to the window. */
export type RpeWindowState = 'not_open' | 'open' | 'closed';

export function rpeWindowState(window: RpeWindow, at: Instant): RpeWindowState {
  const ms = new Date(at).getTime();
  if (ms < window.opensAt.getTime()) return 'not_open';
  if (ms >= window.closesAt.getTime()) return 'closed';
  return 'open';
}
