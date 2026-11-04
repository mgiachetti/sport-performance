import { DomainValidationError, describeValue } from './errors.js';
import type { Sport } from './sport.js';
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
  /**
   * Whether players in this band may do maximal loaded tests at all (never
   * M13/M14, principle 3). The stage alone is not enough: a staff pin or a
   * club step cap of 2 can put an M13/M14 at `performance`. Test protocols
   * must use `maximalLoadTestsAllowed` / `strengthAssessmentFor`, which
   * combine both.
   */
  readonly maximalLoadTestsForPlayers: boolean;
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
    maximalLoadTestsForPlayers: false,
  },
  {
    code: 'm14',
    label: 'M14',
    minAgeInSeasonYear: 14,
    maxAgeInSeasonYear: 14,
    defaultStage: 'foundation',
    ownPercentilesForPlayers: false,
    namedRankingsForPlayers: false,
    maximalLoadTestsForPlayers: false,
  },
  {
    code: 'm15',
    label: 'M15',
    minAgeInSeasonYear: 15,
    maxAgeInSeasonYear: 15,
    defaultStage: 'development',
    ownPercentilesForPlayers: true,
    namedRankingsForPlayers: false,
    maximalLoadTestsForPlayers: true,
  },
  {
    code: 'm16',
    label: 'M16',
    minAgeInSeasonYear: 16,
    maxAgeInSeasonYear: 16,
    defaultStage: 'development',
    ownPercentilesForPlayers: true,
    namedRankingsForPlayers: false,
    maximalLoadTestsForPlayers: true,
  },
  {
    code: 'm17',
    label: 'M17',
    minAgeInSeasonYear: 17,
    maxAgeInSeasonYear: 17,
    defaultStage: 'performance',
    ownPercentilesForPlayers: true,
    namedRankingsForPlayers: true,
    maximalLoadTestsForPlayers: true,
  },
  {
    code: 'm19',
    label: 'M19',
    minAgeInSeasonYear: 18,
    maxAgeInSeasonYear: 19,
    defaultStage: 'performance',
    ownPercentilesForPlayers: true,
    namedRankingsForPlayers: true,
    maximalLoadTestsForPlayers: true,
  },
] as const satisfies readonly AgeBand[];

export type DefaultAgeBandCode = (typeof DEFAULT_AGE_BANDS)[number]['code'];

/**
 * Default name of a club category per sport and band (B-801, ADR 0087): what
 * the bootstrap seeds and what `POST /v1/categories` uses without a name.
 * Data, not UI text: the club renames its categories freely ("Séptima",
 * "Menores de 15"); the band is what defines ages, stage and privacy, never
 * the name. Rugby uses the band label (`M15`, Argentine youth rugby); field
 * hockey the "Sub" wording of Argentine youth hockey with the same number as
 * the band (`Sub 15` = band `m15`, age 15 reached in the season year). Verify
 * the wording with each club before production (B-005).
 */
export const DEFAULT_CATEGORY_NAMES = {
  rugby: { m13: 'M13', m14: 'M14', m15: 'M15', m16: 'M16', m17: 'M17', m19: 'M19' },
  hockey: {
    m13: 'Sub 13',
    m14: 'Sub 14',
    m15: 'Sub 15',
    m16: 'Sub 16',
    m17: 'Sub 17',
    m19: 'Sub 19',
  },
} as const satisfies Record<Sport, Record<DefaultAgeBandCode, string>>;

/** Default name of the category of `sport` for a default band (`Sub 15` for hockey `m15`). */
export function defaultCategoryName(sport: Sport, bandCode: DefaultAgeBandCode): string {
  return DEFAULT_CATEGORY_NAMES[sport][bandCode];
}

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
