import { addDays, compareLocalDates, type LocalDate } from '../time.js';
import type { StrengthAssessment } from '../stage.js';
import {
  DEFAULT_E1RM_PROTOCOL,
  epleyE1rmKg,
  type E1rmProtocol,
} from '../physical-tests/strength.js';
import { gymLoadIsCounted, type GymExerciseSpec } from './exercises.js';

/**
 * A performed gym set (B-607, ADR 0075): what the athlete did, checked
 * against how strength is assessed in their stage, and the e1RM it gives.
 */

export interface GymSetValues {
  /** Repetitions done (`measure: 'reps'`). */
  readonly reps: number | null;
  /** Load in kg: the external load, or the added load of `bodyweight_plus`. */
  readonly loadKg: number | null;
  /** Repetitions in reserve reported at the end of the set. */
  readonly rir: number | null;
  /** 1–3, given by the staff (M13/M14 above all). */
  readonly techniqueScore: number | null;
  /** Seconds held (`measure: 'duration'`). */
  readonly durationS: number | null;
}

export const GYM_SET_ISSUES = [
  'reps_required',
  'reps_not_applicable',
  'duration_required',
  'duration_not_applicable',
  /** An external load needs its kg (> 0); an added load its kg (0 when none). */
  'load_required',
  'load_not_applicable',
  /** M13/M14 never lift an external or added load (principle 3). */
  'loaded_exercise_not_allowed',
  /** From M15 a loaded set reports its reps in reserve (never to failure, and the e1RM). */
  'rir_required',
] as const;
export type GymSetIssueCode = (typeof GYM_SET_ISSUES)[number];

export interface GymSetIssue {
  readonly field: keyof GymSetValues | 'exerciseCode';
  readonly code: GymSetIssueCode;
}

/**
 * What makes a set invalid: the values do not fit the exercise (reps or a
 * time, load or not), or the exercise does not fit the stage. The API
 * answers them as `422`; an empty list means the set can be stored.
 */
export function gymSetIssues(
  set: GymSetValues,
  exercise: GymExerciseSpec,
  assessment: StrengthAssessment,
): GymSetIssue[] {
  const issues: GymSetIssue[] = [];
  if (exercise.measure === 'reps') {
    if (set.reps === null || set.reps < 1) issues.push({ field: 'reps', code: 'reps_required' });
    if (set.durationS !== null) {
      issues.push({ field: 'durationS', code: 'duration_not_applicable' });
    }
  } else {
    if (set.durationS === null || set.durationS <= 0) {
      issues.push({ field: 'durationS', code: 'duration_required' });
    }
    if (set.reps !== null) issues.push({ field: 'reps', code: 'reps_not_applicable' });
  }
  switch (exercise.loadKind) {
    case 'external':
      if (set.loadKg === null || set.loadKg <= 0) {
        issues.push({ field: 'loadKg', code: 'load_required' });
      }
      break;
    case 'bodyweight_plus':
      if (set.loadKg === null || set.loadKg < 0) {
        issues.push({ field: 'loadKg', code: 'load_required' });
      }
      break;
    case 'bodyweight':
      if (set.loadKg !== null) issues.push({ field: 'loadKg', code: 'load_not_applicable' });
      break;
  }
  const counted = gymLoadIsCounted(exercise.loadKind);
  if (assessment === 'technique_reps' && counted) {
    issues.push({ field: 'exerciseCode', code: 'loaded_exercise_not_allowed' });
  }
  if (
    assessment !== 'technique_reps' &&
    counted &&
    exercise.measure === 'reps' &&
    set.rir === null
  ) {
    issues.push({ field: 'rir', code: 'rir_required' });
  }
  return issues;
}

export const GYM_SET_WARNINGS = [
  /** RIR 0 before M17/M19: the set went to failure, which the stage never asks for. */
  'to_failure',
  /** M15/M16: fewer reps in reserve than the protocol's minimum (but not 0). */
  'rir_below_protocol',
  /** Reps outside the protocol's range: the set gives no e1RM. */
  'outside_e1rm_range',
] as const;
export type GymSetWarning = (typeof GYM_SET_WARNINGS)[number];

/**
 * Advisory flags of a valid set: stored as it was done, shown to the staff
 * and the athlete (principle: "nunca al fallo" before M17/M19).
 */
export function gymSetWarnings(
  set: GymSetValues,
  exercise: GymExerciseSpec,
  assessment: StrengthAssessment,
  protocol: E1rmProtocol = DEFAULT_E1RM_PROTOCOL,
): GymSetWarning[] {
  const warnings: GymSetWarning[] = [];
  if (set.rir !== null && assessment !== 'direct_rm') {
    if (set.rir === 0) warnings.push('to_failure');
    else if (assessment === 'estimated_rm' && set.rir < protocol.minRir) {
      warnings.push('rir_below_protocol');
    }
  }
  if (
    assessment !== 'technique_reps' &&
    gymLoadIsCounted(exercise.loadKind) &&
    exercise.measure === 'reps' &&
    set.reps !== null &&
    (set.reps < protocol.minReps || set.reps > protocol.maxReps)
  ) {
    warnings.push('outside_e1rm_range');
  }
  return warnings;
}

/**
 * The e1RM of a set, Epley with RIR (the formula of the strength test,
 * `epleyE1rmKg`), in kg; `null` when the set does not estimate it:
 *
 * - never in M13/M14 (`technique_reps`): no maximal loads, not even estimated;
 * - only loaded exercises done for reps, with their RIR;
 * - only sets inside the protocol (reps in its range; in M15/M16 also RIR at
 *   or above its minimum, so a set near failure does not estimate);
 * - `bodyweight_plus` adds the body mass measured closest before (none
 *   measured: `null`).
 */
export function gymSetE1rmKg(
  set: GymSetValues,
  exercise: GymExerciseSpec,
  assessment: StrengthAssessment,
  options: { readonly protocol?: E1rmProtocol; readonly bodyMassKg?: number | null } = {},
): number | null {
  const protocol = options.protocol ?? DEFAULT_E1RM_PROTOCOL;
  if (assessment === 'technique_reps') return null;
  if (!gymLoadIsCounted(exercise.loadKind) || exercise.measure !== 'reps') return null;
  const { reps, rir, loadKg } = set;
  if (reps === null || rir === null || loadKg === null) return null;
  if (!Number.isSafeInteger(reps) || reps < protocol.minReps || reps > protocol.maxReps) {
    return null;
  }
  if (rir < 0 || (assessment === 'estimated_rm' && rir < protocol.minRir)) return null;
  let totalKg = loadKg;
  if (exercise.loadKind === 'bodyweight_plus') {
    const bodyMassKg = options.bodyMassKg ?? null;
    if (bodyMassKg === null || !(bodyMassKg > 0)) return null;
    totalKg = bodyMassKg + loadKg;
  }
  if (!(totalKg > 0) || !Number.isFinite(totalKg)) return null;
  return epleyE1rmKg({ loadKg: totalKg, reps, rir });
}

/** A set with its e1RM, for the summary. */
export interface GymE1rmPoint {
  readonly exerciseCode: string;
  readonly performedOn: LocalDate;
  readonly e1rmKg: number | null;
}

export interface GymExerciseSummary {
  readonly exerciseCode: string;
  /** Sets of the exercise. */
  readonly setsN: number;
  readonly lastPerformedOn: LocalDate;
  /** Best e1RM and its day; `null` when no set estimated it. */
  readonly bestE1rmKg: number | null;
  readonly bestOn: LocalDate | null;
  /** Best e1RM of each day it was estimated, oldest first. */
  readonly series: readonly { readonly on: LocalDate; readonly e1rmKg: number }[];
}

/** Per exercise: how many sets, the last day, the best e1RM and its evolution by day. */
export function summarizeGymSets(points: readonly GymE1rmPoint[]): GymExerciseSummary[] {
  const byExercise = new Map<string, GymE1rmPoint[]>();
  for (const point of points) {
    const list = byExercise.get(point.exerciseCode) ?? [];
    list.push(point);
    byExercise.set(point.exerciseCode, list);
  }
  const out: GymExerciseSummary[] = [];
  for (const [exerciseCode, list] of byExercise) {
    const bestByDay = new Map<LocalDate, number>();
    const [first] = list;
    if (first === undefined) continue;
    let lastPerformedOn = first.performedOn;
    for (const point of list) {
      if (compareLocalDates(point.performedOn, lastPerformedOn) > 0) {
        lastPerformedOn = point.performedOn;
      }
      if (point.e1rmKg === null) continue;
      const day = bestByDay.get(point.performedOn);
      if (day === undefined || point.e1rmKg > day) bestByDay.set(point.performedOn, point.e1rmKg);
    }
    const series = [...bestByDay]
      .map(([on, e1rmKg]) => ({ on, e1rmKg }))
      .sort((a, b) => compareLocalDates(a.on, b.on));
    let best: { on: LocalDate; e1rmKg: number } | null = null;
    for (const point of series) if (best === null || point.e1rmKg > best.e1rmKg) best = point;
    out.push({
      exerciseCode,
      setsN: list.length,
      lastPerformedOn,
      bestE1rmKg: best?.e1rmKg ?? null,
      bestOn: best?.on ?? null,
      series,
    });
  }
  return out.sort(
    (a, b) =>
      compareLocalDates(b.lastPerformedOn, a.lastPerformedOn) ||
      (a.exerciseCode < b.exerciseCode ? -1 : 1),
  );
}

/**
 * How many club days back the player logs or corrects their own sets (the
 * offline queue of a week, `SYNC_RECORDED_AT_MAX_AGE_DAYS`). The staff
 * loads any past day (a paper sheet); nobody loads a future day.
 */
export const GYM_PLAYER_WINDOW_DAYS = 7;

/** Whether `day` can be logged: never after `today`; the player only within the window. */
export function isWithinGymLogWindow(
  day: LocalDate,
  today: LocalDate,
  by: 'player' | 'staff',
): boolean {
  if (compareLocalDates(day, today) > 0) return false;
  if (by === 'staff') return true;
  return compareLocalDates(day, addDays(today, -GYM_PLAYER_WINDOW_DAYS)) >= 0;
}
