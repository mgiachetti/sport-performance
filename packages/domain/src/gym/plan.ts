import type { StrengthAssessment } from '../stage.js';
import type { E1rmProtocol } from '../physical-tests/strength.js';
import { DEFAULT_E1RM_PROTOCOL } from '../physical-tests/strength.js';
import {
  gymLibraryExercise,
  gymLoadIsCounted,
  type GymExerciseSpec,
  type GymLoadKind,
  type GymMeasure,
} from './exercises.js';

/**
 * The structure of a gym program (B-607, ADR 0075): days, each with its
 * exercises and what is prescribed for them. Stored as `gym_program.plan`;
 * the API checks its shape (contract) and these rules of the stage.
 */

/** Limits of a program, shared by the contract and the forms. */
export const GYM_PLAN_LIMITS = {
  days: 7,
  exercisesPerDay: 20,
  setsPerExercise: 10,
  reps: 50,
  durationS: 600,
  rir: 10,
  loadKg: 500,
  restS: 600,
  nameLength: 80,
  notesLength: 500,
} as const;

/** One exercise of a day, as prescribed. */
export interface GymPlanExercise {
  readonly exerciseCode: string;
  /** Name of a club's own exercise; `null` for one of the library (its name is a UI text). */
  readonly name: string | null;
  readonly loadKind: GymLoadKind;
  readonly measure: GymMeasure;
  readonly sets: number;
  /** Repetitions per set, a range (`measure: 'reps'`). */
  readonly repsMin: number | null;
  readonly repsMax: number | null;
  /** Seconds per set (`measure: 'duration'`). */
  readonly durationS: number | null;
  /** Repetitions to keep in reserve: M15/M16 never below the protocol's minimum. */
  readonly targetRir: number | null;
  /** Suggested load in kg (added load for `bodyweight_plus`). */
  readonly loadKg: number | null;
  readonly restS: number | null;
  readonly notes: string | null;
}

export interface GymPlanDay {
  /** Stable key of the day within the program (`a`, `lower_1`): sets point at it. */
  readonly key: string;
  readonly name: string;
  readonly exercises: readonly GymPlanExercise[];
}

export interface GymPlan {
  readonly days: readonly GymPlanDay[];
}

export const GYM_PLAN_ISSUES = [
  /** The exercise is in the library with another load kind or measure. */
  'load_kind_mismatch',
  'measure_mismatch',
  /** A club's own exercise needs a name. */
  'name_required',
  'reps_required',
  'reps_range',
  'reps_not_applicable',
  'duration_required',
  'duration_not_applicable',
  'load_not_applicable',
  /** M13/M14: only the body or a stick, never an external or added load (principle 3). */
  'loaded_exercise_not_allowed',
  /** M15/M16: a loaded exercise prescribes the reps in reserve… */
  'target_rir_required',
  /** …and never below the protocol's minimum: never to failure. */
  'target_rir_below_protocol',
  'duplicate_day_key',
  'duplicate_exercise',
] as const;
export type GymPlanIssueCode = (typeof GYM_PLAN_ISSUES)[number];

export interface GymPlanIssue {
  /** Path inside the plan (`['days', 0, 'exercises', 2, 'targetRir']`). */
  readonly path: readonly (string | number)[];
  readonly code: GymPlanIssueCode;
}

/** The spec an exercise of a plan declares (load kind and measure). */
export function planExerciseSpec(exercise: GymPlanExercise): GymExerciseSpec {
  return { loadKind: exercise.loadKind, measure: exercise.measure };
}

function exerciseIssues(
  exercise: GymPlanExercise,
  assessment: StrengthAssessment,
  protocol: E1rmProtocol,
): { field: string; code: GymPlanIssueCode }[] {
  const issues: { field: string; code: GymPlanIssueCode }[] = [];
  const library = gymLibraryExercise(exercise.exerciseCode);
  if (library === undefined) {
    if (exercise.name === null || exercise.name.trim() === '') {
      issues.push({ field: 'name', code: 'name_required' });
    }
  } else {
    if (library.loadKind !== exercise.loadKind) {
      issues.push({ field: 'loadKind', code: 'load_kind_mismatch' });
    }
    if (library.measure !== exercise.measure) {
      issues.push({ field: 'measure', code: 'measure_mismatch' });
    }
  }
  if (exercise.measure === 'reps') {
    if (exercise.repsMin === null || exercise.repsMax === null) {
      issues.push({ field: 'repsMin', code: 'reps_required' });
    } else if (exercise.repsMin > exercise.repsMax) {
      issues.push({ field: 'repsMax', code: 'reps_range' });
    }
    if (exercise.durationS !== null) {
      issues.push({ field: 'durationS', code: 'duration_not_applicable' });
    }
  } else {
    if (exercise.durationS === null) issues.push({ field: 'durationS', code: 'duration_required' });
    if (exercise.repsMin !== null || exercise.repsMax !== null) {
      issues.push({ field: 'repsMin', code: 'reps_not_applicable' });
    }
  }
  const counted = gymLoadIsCounted(exercise.loadKind);
  if (!counted && exercise.loadKg !== null) {
    issues.push({ field: 'loadKg', code: 'load_not_applicable' });
  }
  if (assessment === 'technique_reps' && counted) {
    issues.push({ field: 'loadKind', code: 'loaded_exercise_not_allowed' });
  }
  if (assessment === 'estimated_rm' && counted) {
    if (exercise.targetRir === null) {
      issues.push({ field: 'targetRir', code: 'target_rir_required' });
    } else if (exercise.targetRir < protocol.minRir) {
      issues.push({ field: 'targetRir', code: 'target_rir_below_protocol' });
    }
  }
  return issues;
}

/**
 * Where a plan breaks the rules of the stage it is for, by how strength is
 * assessed there (`strengthAssessmentFor`): M13/M14 train technique with
 * the body or a stick; M15/M16 load progressively with RIR at or above the
 * protocol's minimum, never to failure; M17/M19 as the first team. Also the
 * coherence of each exercise (reps or duration, load or not). An empty list
 * means the plan is valid for the stage.
 */
export function gymPlanIssues(
  plan: GymPlan,
  assessment: StrengthAssessment,
  protocol: E1rmProtocol = DEFAULT_E1RM_PROTOCOL,
): GymPlanIssue[] {
  const issues: GymPlanIssue[] = [];
  const keys = new Set<string>();
  plan.days.forEach((day, dayIndex) => {
    if (keys.has(day.key))
      issues.push({ path: ['days', dayIndex, 'key'], code: 'duplicate_day_key' });
    keys.add(day.key);
    const codes = new Set<string>();
    day.exercises.forEach((exercise, exerciseIndex) => {
      const base = ['days', dayIndex, 'exercises', exerciseIndex] as const;
      if (codes.has(exercise.exerciseCode)) {
        issues.push({ path: [...base, 'exerciseCode'], code: 'duplicate_exercise' });
      }
      codes.add(exercise.exerciseCode);
      for (const { field, code } of exerciseIssues(exercise, assessment, protocol)) {
        issues.push({ path: [...base, field], code });
      }
    });
  });
  return issues;
}

/** The exercise of a plan by its code (in any day), or `undefined`. */
export function findPlanExercise(
  plan: GymPlan,
  exerciseCode: string,
  dayKey?: string | null,
): GymPlanExercise | undefined {
  const days =
    dayKey === undefined || dayKey === null
      ? plan.days
      : plan.days.filter((day) => day.key === dayKey);
  for (const day of days) {
    const found = day.exercises.find((exercise) => exercise.exerciseCode === exerciseCode);
    if (found !== undefined) return found;
  }
  return undefined;
}
