import { isWellFormedCode } from '../codes.js';
import { memberGuard, memberParser } from '../enum.js';

/**
 * Gym exercises (B-607, ADR 0075). An exercise is a `snake_case` code with
 * what its sets record: how the load is counted and whether it is done for
 * repetitions or held for a time.
 */

/**
 * How the load of a set is counted:
 *
 * - `external`: a load in kg the athlete moves (barbell, dumbbell, trap bar,
 *   kettlebell). The set records it.
 * - `bodyweight`: the body alone or a stick (palo): the set records no load.
 * - `bodyweight_plus`: the body plus an added load (weighted pull-up or dip):
 *   the set records the added kg; the total is body mass plus it.
 */
export const GYM_LOAD_KINDS = ['external', 'bodyweight', 'bodyweight_plus'] as const;
export type GymLoadKind = (typeof GYM_LOAD_KINDS)[number];
export const isGymLoadKind = memberGuard(GYM_LOAD_KINDS);
export const parseGymLoadKind = memberParser(GYM_LOAD_KINDS, 'invalid_argument', 'gym load kind');

/** `reps`: repetitions per set; `duration`: a hold in seconds (plank). */
export const GYM_MEASURES = ['reps', 'duration'] as const;
export type GymMeasure = (typeof GYM_MEASURES)[number];
export const isGymMeasure = memberGuard(GYM_MEASURES);

/** Whether a set of this kind moves a load the e1RM can be estimated from. */
export function gymLoadIsCounted(loadKind: GymLoadKind): boolean {
  return loadKind !== 'bodyweight';
}

export interface GymExerciseSpec {
  readonly loadKind: GymLoadKind;
  readonly measure: GymMeasure;
}

/**
 * The default library: the exercises of the stage table (goblet or trap bar,
 * bench, pull-ups; push-ups, pull-ups and plank in M13/M14) and the usual
 * ones of a youth program. Names are UI texts (`gym.exercise.<code>` in
 * `packages/i18n`); a program can add the club's own exercises with a name.
 */
export const GYM_EXERCISE_LIBRARY = {
  // Technique with the body or a stick (M13/M14 onwards).
  push_up: { loadKind: 'bodyweight', measure: 'reps' },
  pull_up: { loadKind: 'bodyweight', measure: 'reps' },
  inverted_row: { loadKind: 'bodyweight', measure: 'reps' },
  bodyweight_squat: { loadKind: 'bodyweight', measure: 'reps' },
  stick_overhead_squat: { loadKind: 'bodyweight', measure: 'reps' },
  stick_romanian_deadlift: { loadKind: 'bodyweight', measure: 'reps' },
  split_squat: { loadKind: 'bodyweight', measure: 'reps' },
  walking_lunge: { loadKind: 'bodyweight', measure: 'reps' },
  glute_bridge: { loadKind: 'bodyweight', measure: 'reps' },
  nordic_curl: { loadKind: 'bodyweight', measure: 'reps' },
  copenhagen_plank: { loadKind: 'bodyweight', measure: 'duration' },
  plank: { loadKind: 'bodyweight', measure: 'duration' },
  side_plank: { loadKind: 'bodyweight', measure: 'duration' },
  // Loaded strength (M15/M16 with RIR, M17/M19 as the first team).
  goblet_squat: { loadKind: 'external', measure: 'reps' },
  trap_bar_deadlift: { loadKind: 'external', measure: 'reps' },
  back_squat: { loadKind: 'external', measure: 'reps' },
  front_squat: { loadKind: 'external', measure: 'reps' },
  romanian_deadlift: { loadKind: 'external', measure: 'reps' },
  hip_thrust: { loadKind: 'external', measure: 'reps' },
  bench_press: { loadKind: 'external', measure: 'reps' },
  overhead_press: { loadKind: 'external', measure: 'reps' },
  dumbbell_row: { loadKind: 'external', measure: 'reps' },
  power_clean: { loadKind: 'external', measure: 'reps' },
  weighted_pull_up: { loadKind: 'bodyweight_plus', measure: 'reps' },
  weighted_dip: { loadKind: 'bodyweight_plus', measure: 'reps' },
} as const satisfies Readonly<Record<string, GymExerciseSpec>>;

export type GymLibraryExerciseCode = keyof typeof GYM_EXERCISE_LIBRARY;
export const GYM_LIBRARY_EXERCISE_CODES = Object.keys(
  GYM_EXERCISE_LIBRARY,
) as GymLibraryExerciseCode[];

export function isGymLibraryExercise(code: string): code is GymLibraryExerciseCode {
  return Object.hasOwn(GYM_EXERCISE_LIBRARY, code);
}

/** The spec of a library exercise, or `undefined` for a club's own. */
export function gymLibraryExercise(code: string): GymExerciseSpec | undefined {
  return isGymLibraryExercise(code) ? GYM_EXERCISE_LIBRARY[code] : undefined;
}

/** An exercise code: the canonical code format (`snake_case`, at most 64, no `playerload`). */
export function isGymExerciseCode(value: unknown): value is string {
  return isWellFormedCode(value);
}
