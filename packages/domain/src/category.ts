import { DomainValidationError, describeValue } from './errors.js';
import type { Stage } from './stage.js';

/**
 * A youth age band ("M15"). Clubs name their categories freely per sport
 * (B-005, B-313); every club category maps to one age band so that history is
 * comparable across clubs and sports.
 *
 * Ages are "age reached during the season year" (`seasonYear − birthYear`),
 * the way Argentine youth rugby and hockey assign categories by birth year.
 */
export interface AgeBand {
  /** Canonical code, English `snake_case` (`m15`). */
  readonly code: string;
  /** Short label used by default in the UI (`M15`); clubs may override it. */
  readonly label: string;
  /** Inclusive minimum age reached during the season year. */
  readonly minAgeInSeasonYear: number;
  /** Inclusive maximum age reached during the season year. */
  readonly maxAgeInSeasonYear: number;
  /** Stage suggested by the category alone, before maturation (B-204). */
  readonly defaultStage: Stage;
  /** Whether players in this band may see their own percentiles (from M15). */
  readonly ownPercentilesForPlayers: boolean;
  /** Whether players in this band may see rankings with names (never M13–M16). */
  readonly namedRankingsForPlayers: boolean;
}

/**
 * Default youth bands, M13 to M19. There is no M18: M19 covers ages 18 and 19.
 * Defaults only; the club's category set is data (B-313, B-316).
 */
export const DEFAULT_AGE_BANDS = [
  {
    code: 'm13',
    label: 'M13',
    minAgeInSeasonYear: 13,
    maxAgeInSeasonYear: 13,
    defaultStage: 'foundation',
    ownPercentilesForPlayers: false,
    namedRankingsForPlayers: false,
  },
  {
    code: 'm14',
    label: 'M14',
    minAgeInSeasonYear: 14,
    maxAgeInSeasonYear: 14,
    defaultStage: 'foundation',
    ownPercentilesForPlayers: false,
    namedRankingsForPlayers: false,
  },
  {
    code: 'm15',
    label: 'M15',
    minAgeInSeasonYear: 15,
    maxAgeInSeasonYear: 15,
    defaultStage: 'development',
    ownPercentilesForPlayers: true,
    namedRankingsForPlayers: false,
  },
  {
    code: 'm16',
    label: 'M16',
    minAgeInSeasonYear: 16,
    maxAgeInSeasonYear: 16,
    defaultStage: 'development',
    ownPercentilesForPlayers: true,
    namedRankingsForPlayers: false,
  },
  {
    code: 'm17',
    label: 'M17',
    minAgeInSeasonYear: 17,
    maxAgeInSeasonYear: 17,
    defaultStage: 'performance',
    ownPercentilesForPlayers: true,
    namedRankingsForPlayers: true,
  },
  {
    code: 'm19',
    label: 'M19',
    minAgeInSeasonYear: 18,
    maxAgeInSeasonYear: 19,
    defaultStage: 'performance',
    ownPercentilesForPlayers: true,
    namedRankingsForPlayers: true,
  },
] as const satisfies readonly AgeBand[];

export type DefaultAgeBandCode = (typeof DEFAULT_AGE_BANDS)[number]['code'];

/** Age reached during the season year: `seasonYear − birthYear`. */
export function ageInSeasonYear(birthYear: number, seasonYear: number): number {
  assertYear(birthYear, 'birthYear');
  assertYear(seasonYear, 'seasonYear');
  return seasonYear - birthYear;
}

/**
 * Age band a player belongs to in a season, by birth year. Returns `undefined`
 * when the player is outside every band (too young or already senior).
 * Bands must not overlap; the first match wins.
 */
export function ageBandForBirthYear<B extends AgeBand>(
  birthYear: number,
  seasonYear: number,
  bands: readonly B[],
): B | undefined {
  const age = ageInSeasonYear(birthYear, seasonYear);
  return bands.find((b) => age >= b.minAgeInSeasonYear && age <= b.maxAgeInSeasonYear);
}

function assertYear(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1900 || value > 9999) {
    throw new DomainValidationError(
      'invalid_argument',
      `${name} must be an integer year, got ${describeValue(value)}.`,
      value,
    );
  }
}
