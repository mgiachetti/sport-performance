import { canonicalMetricCode, type CanonicalMetricCode } from '../codes.js';
import type { Sex } from '../sex.js';
import type { PlausibleRange } from './ranges.js';

/** Age-group boundaries, in decimal years, of the age-dependent defaults. */
export const DEFAULT_PLAUSIBLE_AGE_GROUP_BOUNDS_YEARS = [14, 17] as const;

/**
 * Default plausible ranges for the canonical metrics that are entered by hand
 * (B-206). Seeded into the database later (B-306) and overridable per club
 * (B-322) through {@link mergePlausibleRanges}.
 *
 * They are deliberately wide. The goal is to catch typing errors (a 40 m in
 * 3 s, 512 instead of 5,12, a height in metres), not to flag an exceptional
 * player: a value outside the range only produces a warning. Ages are decimal
 * ages at the measurement date; the youth age groups (`< 14`, `14–17`,
 * `≥ 17`) only matter where the size of the body changes the range (height,
 * body mass), and the last group also covers the senior team.
 *
 * Not included:
 * - Derived metrics (`sprint_vmax_ms`, `cod505_asymmetry_pct`, `e1rm_kg`,
 *   `relative_strength_kg_kg`, `phv_offset_years`, `adult_height_pct`,
 *   `growth_velocity_cm_year`, `srpe_au`): they are computed, not typed.
 * - Field (GPS) metrics: they are imported or come from the pod, not typed.
 *
 * `rm1_kg` and `rm3_kg` cover every exercise (the exercise is an attribute of
 * the result), so their range is the envelope across exercises.
 */
export const DEFAULT_PLAUSIBLE_RANGES: readonly PlausibleRange[] = Object.freeze([
  // anthro
  ...byAgeGroup('height_cm', 'male', [125, 200], [140, 210], [150, 215]),
  ...byAgeGroup('height_cm', 'female', [125, 190], [135, 195], [140, 200]),
  ...byAgeGroup('weight_kg', 'male', [25, 120], [35, 150], [45, 170]),
  ...byAgeGroup('weight_kg', 'female', [25, 110], [35, 120], [40, 130]),
  anyAge('sitting_height_cm', null, 60, 115),
  anyAge('skinfolds_sum_mm', null, 20, 300),

  // sprint_40
  anyAge('sprint_10_s', null, 1.4, 3),
  anyAge('sprint_20_s', null, 2.5, 5),
  anyAge('sprint_40_s', 'male', 4.4, 9),
  anyAge('sprint_40_s', 'female', 4.8, 10),

  // cmj
  anyAge('cmj_height_cm', 'male', 10, 80),
  anyAge('cmj_height_cm', 'female', 8, 65),

  // cod_505
  anyAge('cod505_left_s', null, 1.8, 4.5),
  anyAge('cod505_right_s', null, 1.8, 4.5),

  // ift_3015
  anyAge('vift_kmh', null, 10, 25),

  // bronco (3:30 to 12:00)
  anyAge('bronco_time_s', null, 210, 720),

  // strength
  anyAge('pushups_n', null, 0, 150),
  anyAge('pullups_n', null, 0, 60),
  anyAge('plank_s', null, 0, 900),
  anyAge('technique_score', null, 1, 3),
  anyAge('rm1_kg', null, 5, 400),
  anyAge('rm3_kg', null, 5, 380),

  // mobility
  anyAge('knee_to_wall_left_cm', null, 0, 25),
  anyAge('knee_to_wall_right_cm', null, 0, 25),

  // reaction
  anyAge('reaction_simple_msec', null, 100, 700),
  anyAge('reaction_go_no_go_msec', null, 150, 1000),

  // neck
  anyAge('neck_flexion_newton', null, 30, 1000),
  anyAge('neck_extension_newton', null, 30, 1000),
  anyAge('neck_left_newton', null, 30, 1000),
  anyAge('neck_right_newton', null, 30, 1000),

  // load monitoring
  anyAge('rpe_score', null, 0, 10),
  anyAge('session_duration_min', null, 1, 300),
] satisfies PlausibleRange[]);

type Bounds = readonly [minValue: number, maxValue: number];

function anyAge(
  metric: CanonicalMetricCode,
  sex: Sex | null,
  minValue: number,
  maxValue: number,
): PlausibleRange {
  return {
    metricCode: canonicalMetricCode(metric),
    sex,
    minAgeYears: null,
    maxAgeYears: null,
    minValue,
    maxValue,
  };
}

function byAgeGroup(
  metric: CanonicalMetricCode,
  sex: Sex,
  under14: Bounds,
  from14To17: Bounds,
  from17: Bounds,
): PlausibleRange[] {
  const [first, second] = DEFAULT_PLAUSIBLE_AGE_GROUP_BOUNDS_YEARS;
  const groups: readonly [number | null, number | null, Bounds][] = [
    [null, first, under14],
    [first, second, from14To17],
    [second, null, from17],
  ];
  return groups.map(([minAgeYears, maxAgeYears, [minValue, maxValue]]) => ({
    metricCode: canonicalMetricCode(metric),
    sex,
    minAgeYears,
    maxAgeYears,
    minValue,
    maxValue,
  }));
}
