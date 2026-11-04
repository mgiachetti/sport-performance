import type { ExposureContext } from '../exposure/contexts.js';
import type { Sport } from '../sport.js';

/**
 * Field rules of each sport (B-803, ADR 0090): what a session of the sport
 * records and on what pitch. They are rules of the sport, not settings of a
 * club, and every client evaluates the same data: the API to validate, the
 * web and the app to show or hide a column. Adding a sport is adding a row
 * here, never a branch on the sport's name.
 *
 * Verify against the current rules of each federation before production:
 * the values below are transcribed from the cited documents.
 */

/** How the players of a match come on and off. */
export const SUBSTITUTION_MODES = ['limited', 'rolling'] as const;
export type SubstitutionMode = (typeof SUBSTITUTION_MODES)[number];

/** Playing area (inside the boundary lines; rugby without the in-goal), in metres. */
export interface PitchDimensions {
  readonly lengthM: number;
  readonly widthM: number;
}

export interface SportFieldRules {
  /**
   * `limited`: a player who comes off rarely comes back (rugby), so the
   * minutes of a match are one total. `rolling`: unlimited substitutions
   * (hockey), so a player plays several stints and the minutes are loaded
   * by period of the match.
   */
  readonly substitutions: SubstitutionMode;
  /**
   * Whether contacts are part of the sport (tackles, rucks, scrums): a
   * participation's `contactsN` and a drill's contact level. Without them
   * the API refuses both and no screen asks for them.
   */
  readonly recordsContacts: boolean;
  /** Periods of a regulation match (halves, quarters): the default number of periods. */
  readonly matchPeriodCount: number;
  /** Regulation pitch: the canvas of the field heat map (ADR 0061, F3). */
  readonly pitch: PitchDimensions;
  /** Where the values come from. */
  readonly source: string;
}

export const SPORT_FIELD_RULES = {
  rugby: {
    substitutions: 'limited',
    recordsContacts: true,
    matchPeriodCount: 2,
    pitch: { lengthM: 100, widthM: 70 },
    source:
      'World Rugby, Laws of the Game (Law 1, the ground: field of play up to 100 m between the try lines and up to 70 m wide; Law 3, a limited number of replacements; Law 5, two halves).',
  },
  hockey: {
    substitutions: 'rolling',
    recordsContacts: false,
    matchPeriodCount: 4,
    pitch: { lengthM: 91.4, widthM: 55 },
    source:
      'FIH, Rules of Hockey (field of play: 91.40 m × 55.00 m; a match of four quarters; substitutions without a limit on their number; players may not physically obstruct or play an opponent).',
  },
} as const satisfies Readonly<Record<Sport, SportFieldRules>>;

export function sportFieldRules(sport: Sport): SportFieldRules {
  return SPORT_FIELD_RULES[sport];
}

/** Whether sessions of the sport record contacts (participation and drills). */
export function sportRecordsContacts(sport: Sport): boolean {
  return SPORT_FIELD_RULES[sport].recordsContacts;
}

/** Most periods of a match a participation keeps (youth tournaments split matches further). */
export const MATCH_PERIODS_MAX = 8;

/**
 * Whether a participation of this session carries its minutes by period:
 * matches of a sport with rolling substitutions. Trainings and matches of
 * sports with limited substitutions carry a total.
 */
export function recordsPeriodMinutes(session: { sport: Sport; kind: ExposureContext }): boolean {
  return session.kind === 'match' && SPORT_FIELD_RULES[session.sport].substitutions === 'rolling';
}

/** Minutes of a participation loaded by period: their sum. */
export function periodMinutesTotal(periodMinutes: readonly number[]): number {
  return periodMinutes.reduce((sum, minutes) => sum + minutes, 0);
}

export type PeriodMinutesProblem =
  /** The session does not load minutes by period (a training, or limited substitutions). */
  | 'not_by_period'
  /** No periods, or more than {@link MATCH_PERIODS_MAX}. */
  | 'period_count'
  /** A period longer than the whole planned match. */
  | 'period_too_long';

export interface PeriodMinutesIssue {
  readonly problem: PeriodMinutesProblem;
  /** The period, for `period_too_long`. */
  readonly index?: number;
}

/**
 * What is wrong with the minutes by period of a participation of a session
 * (empty when they fit). Each period is a non-negative integer (the contract
 * checks it); the total is capped like any participation's minutes.
 */
export function periodMinutesIssues(
  session: { sport: Sport; kind: ExposureContext; plannedDurationMin: number | null },
  periodMinutes: readonly number[],
): PeriodMinutesIssue[] {
  if (!recordsPeriodMinutes(session)) return [{ problem: 'not_by_period' }];
  if (periodMinutes.length === 0 || periodMinutes.length > MATCH_PERIODS_MAX) {
    return [{ problem: 'period_count' }];
  }
  const planned = session.plannedDurationMin;
  if (planned === null) return [];
  return periodMinutes.flatMap((minutes, index) =>
    minutes > planned ? [{ problem: 'period_too_long' as const, index }] : [],
  );
}
