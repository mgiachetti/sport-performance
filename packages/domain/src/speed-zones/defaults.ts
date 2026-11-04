import type { CoefficientProvenance } from '../maturation/provenance.js';
import type { Sex } from '../sex.js';
import type {
  AbsoluteSpeedZoneSet,
  RelativeSpeedZoneSet,
  SpeedZoneKind,
  SpeedZoneSetOfKind,
} from './zones.js';

/**
 * Default speed zones. Data, not logic: these are the values seeded into the
 * database (B-306) for a club with no configuration of its own, and the
 * fallback of `resolveSpeedZoneSet`. They are heuristics; a club replaces them
 * with the first team's Catapult velocity bands (absolute) or its own
 * percentages (relative).
 */

/**
 * Absolute zones, m/s. High-speed running from 5.5 m/s (CLAUDE.md,
 * `hsr_abs_m`); sprinting from 7 m/s.
 */
export const DEFAULT_ABSOLUTE_SPEED_ZONES = {
  kind: 'absolute',
  zones: [
    { code: 'walking', minSpeedMs: 0 },
    { code: 'jogging', minSpeedMs: 2 },
    { code: 'running', minSpeedMs: 4 },
    { code: 'high_speed_running', minSpeedMs: 5.5 },
    { code: 'sprinting', minSpeedMs: 7 },
  ],
  highSpeedZoneCode: 'high_speed_running',
} as const satisfies AbsoluteSpeedZoneSet;

/**
 * Relative zones, % of the player's Vmax. High-speed running from 60%
 * (CLAUDE.md, `hsr_rel_m`); near-maximal sprinting from 90%.
 */
export const DEFAULT_RELATIVE_SPEED_ZONES = {
  kind: 'relative',
  zones: [
    { code: 'low_intensity', minVmaxPct: 0 },
    { code: 'moderate_intensity', minVmaxPct: 40 },
    { code: 'high_speed_running', minVmaxPct: 60 },
    { code: 'very_high_speed_running', minVmaxPct: 80 },
    { code: 'near_max_sprinting', minVmaxPct: 90 },
  ],
  highSpeedZoneCode: 'high_speed_running',
} as const satisfies RelativeSpeedZoneSet;

/** Default zone set of each kind. */
export const DEFAULT_SPEED_ZONE_SETS: {
  readonly [K in SpeedZoneKind]: SpeedZoneSetOfKind<K>;
} = {
  absolute: DEFAULT_ABSOLUTE_SPEED_ZONES,
  relative: DEFAULT_RELATIVE_SPEED_ZONES,
};

/**
 * Absolute zones for women, m/s (B-804, ADR 0087). Same zone codes as
 * {@link DEFAULT_ABSOLUTE_SPEED_ZONES}, so a zone names the same kind of
 * effort in both branches; only the bounds move. Running from 12.5 km/h
 * (3.47 m/s), high-speed running from 19.0 km/h (5.28 m/s, the threshold of
 * `hsr_abs_m` for women) and sprinting from 22.5 km/h (6.25 m/s). Low-speed
 * bounds (walking, jogging) are not sex specific.
 *
 * Source and status in {@link DEFAULT_SPEED_ZONE_SOURCES}: **verify against
 * the papers before production**. A club whose women's first team uses
 * Catapult replaces them with its velocity bands.
 */
export const DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES = {
  kind: 'absolute',
  zones: [
    { code: 'walking', minSpeedMs: 0 },
    { code: 'jogging', minSpeedMs: 2 },
    { code: 'running', minSpeedMs: 3.47 },
    { code: 'high_speed_running', minSpeedMs: 5.28 },
    { code: 'sprinting', minSpeedMs: 6.25 },
  ],
  highSpeedZoneCode: 'high_speed_running',
} as const satisfies AbsoluteSpeedZoneSet;

/** Default zone sets of one sex, by kind; a missing kind has no sex-specific default. */
export type SexSpeedZoneDefaults = { readonly [K in SpeedZoneKind]?: SpeedZoneSetOfKind<K> };

/**
 * Sex-specific default zone sets, seeded as a row scoped to the sex (sport
 * and player `null`) for every branch of that sex (B-804). A kind missing
 * here falls back to {@link DEFAULT_SPEED_ZONE_SETS}: relative zones are a
 * share of each player's own Vmax, so they already scale with sex, and the
 * general absolute zones are the men's ones.
 */
export const DEFAULT_SPEED_ZONE_SETS_BY_SEX: Readonly<Record<Sex, SexSpeedZoneDefaults>> = {
  male: {},
  female: { absolute: DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES },
};

/**
 * Where each sex-specific default comes from and how far it was checked (the
 * same shape as the maturation coefficients). One entry per set of
 * {@link DEFAULT_SPEED_ZONE_SETS_BY_SEX}; a test keeps them in step.
 */
export const DEFAULT_SPEED_ZONE_SOURCES: Readonly<
  Record<Sex, Readonly<Partial<Record<SpeedZoneKind, CoefficientProvenance>>>>
> = {
  male: {},
  female: {
    absolute: {
      citation:
        "Bradley PS, Vescovi JD. Velocity thresholds for women's soccer matches: sex specificity " +
        'dictates high-speed-running and sprinting thresholds - Female Athletes in Motion (FAiM). ' +
        'Int J Sports Physiol Perform. 2015;10(1):112-116.',
      doi: '10.1123/ijspp.2014-0212',
      errata: [],
      verification: 'unverified',
      verificationNotes:
        'Bounds of 12.5, 19.0 and 22.5 km/h taken from secondary reproductions of FAiM. ' +
        "Park LAF, Scott D, Lovell R. Velocity zone classification in elite women's football: " +
        'where do we draw the lines? Sci Med Footb. 2019;3(1):21-28 ' +
        '(doi:10.1080/24733938.2018.1517947) derives thresholds of the ' +
        'same order. Pending: confirm the DOIs, compare with both original articles, and with the ' +
        "velocity bands of the club's women's first team, before production.",
    },
  },
};

/**
 * The default zone set of a kind for a sex: the sex-specific one when there
 * is one, otherwise the general default. Without a sex, the general default.
 */
export function defaultSpeedZoneSet<K extends SpeedZoneKind>(
  kind: K,
  sex?: Sex | null,
): SpeedZoneSetOfKind<K> {
  const bySex: SexSpeedZoneDefaults | undefined =
    sex === undefined || sex === null ? undefined : DEFAULT_SPEED_ZONE_SETS_BY_SEX[sex];
  return (bySex?.[kind] as SpeedZoneSetOfKind<K> | undefined) ?? DEFAULT_SPEED_ZONE_SETS[kind];
}
