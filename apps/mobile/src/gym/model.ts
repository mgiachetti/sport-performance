import type {
  GymProgram,
  GymSet,
  GymSetWarningDto,
  SyncOperationRequest,
} from '@sport-performance/contracts';
import {
  GYM_PLAN_LIMITS,
  compareLocalDates,
  summarizeGymSets,
  type GymExerciseSummary,
  type GymLoadKind,
  type GymMeasure,
  type LocalDate,
  type MembershipRole,
} from '@sport-performance/domain';
import { isMessageKey, parseNumber, type Translator } from '@sport-performance/i18n';
import type { LocalRow, QueuedMutation } from '../offline/local-store.ts';

/**
 * The gym on the phone (B-607, ADR 0075): pure logic of the screen. Programs
 * and sets come from the local database (synced rows with the queue laid
 * over), new sets go through the offline queue (`gym_set.log`), so the
 * player logs a whole session in the basement without signal.
 */

/** Only the player logs from the phone; the staff loads sets from the web. */
export function canLogGym(role: MembershipRole): boolean {
  return role === 'player';
}

type PlanExercise = GymProgram['plan']['days'][number]['exercises'][number];
export type GymPlanDayDto = GymProgram['plan']['days'][number];
export type GymPlanExerciseDto = PlanExercise;

/** Programs in force on the day (not archived, `validFrom <= day < validTo`): own first. */
export function programsInForce(
  rows: readonly LocalRow<'gym_program'>[],
  day: LocalDate,
): GymProgram[] {
  return rows
    .map((row) => row.data)
    .filter(
      (program) =>
        program.archivedAt === null &&
        compareLocalDates(program.validFrom, day) <= 0 &&
        (program.validTo === null || compareLocalDates(program.validTo, day) > 0),
    )
    .sort(
      (a, b) =>
        Number(a.playerId === null) - Number(b.playerId === null) ||
        a.name.localeCompare(b.name, 'es'),
    );
}

/** A set as the screen shows it: served, or queued and not back yet. */
export interface GymSetView {
  readonly key: string;
  readonly exerciseCode: string;
  readonly setNumber: number;
  readonly reps: number | null;
  readonly loadKg: number | null;
  readonly rir: number | null;
  readonly durationS: number | null;
  readonly techniqueScore: number | null;
  readonly e1rmKg: number | null;
  readonly warnings: readonly GymSetWarningDto[];
  /** Not on the server yet (or edited offline). */
  readonly pending: boolean;
}

function fromServed(row: LocalRow<'gym_set'>): GymSetView {
  const set: GymSet = row.data;
  return {
    key: row.id,
    exerciseCode: set.exerciseCode,
    setNumber: set.setNumber,
    reps: set.reps,
    loadKg: set.loadKg,
    rir: set.rir,
    durationS: set.durationS,
    techniqueScore: set.techniqueScore,
    e1rmKg: set.e1rmKg,
    warnings: set.warnings,
    pending: row.pending,
  };
}

/**
 * The sets of the session: the served ones of the day (voided left out) and
 * those still in the queue, which the server dates when it gets them (the
 * club day they were recorded): they belong to the session being loaded.
 * By exercise and set number.
 */
export function sessionSets(
  served: readonly LocalRow<'gym_set'>[],
  queued: readonly QueuedMutation<'gym_set.log'>[],
  day: LocalDate,
): GymSetView[] {
  const known = new Set(served.flatMap((row) => (row.clientUuid === null ? [] : [row.clientUuid])));
  const views: GymSetView[] = served
    .filter((row) => row.data.voidedAt === null && row.data.performedOn === day)
    .map(fromServed);
  for (const mutation of queued) {
    for (const set of mutation.input.body.sets) {
      if (set.clientUuid === undefined || known.has(set.clientUuid)) continue;
      known.add(set.clientUuid);
      views.push({
        key: set.clientUuid,
        exerciseCode: set.exerciseCode,
        setNumber: set.setNumber,
        reps: set.reps ?? null,
        loadKg: set.loadKg ?? null,
        rir: set.rir ?? null,
        durationS: set.durationS ?? null,
        techniqueScore: set.techniqueScore ?? null,
        e1rmKg: null,
        warnings: [],
        pending: true,
      });
    }
  }
  return views.sort(
    (a, b) =>
      (a.exerciseCode < b.exerciseCode ? -1 : a.exerciseCode > b.exerciseCode ? 1 : 0) ||
      a.setNumber - b.setNumber,
  );
}

/** The number of the next set of an exercise in the session. */
export function nextSetNumber(sets: readonly GymSetView[], exerciseCode: string): number {
  return (
    sets.reduce(
      (max, set) => (set.exerciseCode === exerciseCode ? Math.max(max, set.setNumber) : max),
      0,
    ) + 1
  );
}

/** Best e1RM per exercise from the served sets (the server's e1RM; voided left out). */
export function bestE1rms(served: readonly LocalRow<'gym_set'>[]): GymExerciseSummary[] {
  return summarizeGymSets(
    served
      .filter((row) => row.data.voidedAt === null)
      .map((row) => ({
        exerciseCode: row.data.exerciseCode,
        performedOn: row.data.performedOn,
        e1rmKg: row.data.e1rmKg,
      })),
  ).filter((summary) => summary.bestE1rmKg !== null);
}

/** What the player types for one set. */
export interface SetForm {
  readonly reps: string;
  readonly loadKg: string;
  readonly rir: string;
  readonly durationS: string;
}

export const EMPTY_SET_FORM: SetForm = { reps: '', loadKg: '', rir: '', durationS: '' };

/** The form prefilled from the prescription (the reps at the top of the range, the load). */
export function prefilledForm(exercise: PlanExercise): SetForm {
  return {
    reps: exercise.repsMax === null ? '' : String(exercise.repsMax),
    loadKg: exercise.loadKg === null ? '' : String(exercise.loadKg).replace('.', ','),
    rir: exercise.targetRir === null ? '' : String(exercise.targetRir),
    durationS: exercise.durationS === null ? '' : String(exercise.durationS),
  };
}

export type SetFormField = keyof SetForm;
export type SetFormError = 'required' | 'integer' | 'range' | 'number';

export interface ParsedSet {
  readonly reps: number | null;
  readonly loadKg: number | null;
  readonly rir: number | null;
  readonly durationS: number | null;
}

function integerIn(text: string, min: number, max: number): number | SetFormError {
  const trimmed = text.trim();
  if (trimmed === '') return 'required';
  if (!/^\d+$/.test(trimmed)) return 'integer';
  const value = Number(trimmed);
  return value < min || value > max ? 'range' : value;
}

/**
 * Checks the form against what the exercise records (the same limits as
 * the contract): reps or seconds; kg for a load (0 allowed for no added
 * load); RIR for a loaded set. The stage rules are the server's: a set it
 * refuses comes back as an issue of the queue.
 */
export function parseSetForm(
  form: SetForm,
  spec: { readonly loadKind: GymLoadKind; readonly measure: GymMeasure },
): { readonly set: ParsedSet } | { readonly errors: Partial<Record<SetFormField, SetFormError>> } {
  const errors: Partial<Record<SetFormField, SetFormError>> = {};
  let reps: number | null = null;
  let durationS: number | null = null;
  let loadKg: number | null = null;
  let rir: number | null = null;
  if (spec.measure === 'reps') {
    const value = integerIn(form.reps, 1, GYM_PLAN_LIMITS.reps);
    if (typeof value === 'number') reps = value;
    else errors.reps = value;
  } else {
    const value = integerIn(form.durationS, 1, GYM_PLAN_LIMITS.durationS);
    if (typeof value === 'number') durationS = value;
    else errors.durationS = value;
  }
  if (spec.loadKind !== 'bodyweight') {
    const text = form.loadKg.trim();
    const value = text === '' ? null : parseNumber(text);
    const min = spec.loadKind === 'external' ? Number.MIN_VALUE : 0;
    if (text === '') errors.loadKg = 'required';
    else if (value === null) errors.loadKg = 'number';
    else if (value < min || value > GYM_PLAN_LIMITS.loadKg) errors.loadKg = 'range';
    else loadKg = value;
  }
  const rirText = form.rir.trim();
  if (rirText !== '' || (spec.loadKind !== 'bodyweight' && spec.measure === 'reps')) {
    const value = integerIn(rirText, 0, GYM_PLAN_LIMITS.rir);
    if (typeof value === 'number') rir = value;
    else errors.rir = value;
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { set: { reps, loadKg, rir, durationS } };
}

/** RIR 0 is a set to failure: the screen says so before it is queued. */
export function isToFailure(set: ParsedSet): boolean {
  return set.rir === 0;
}

/** The `gym_set.log` input of one set of the session (the player's own, dated by the server). */
export function logSetInput(options: {
  readonly clientUuid: string;
  readonly program: GymProgram | null;
  readonly dayKey: string | null;
  readonly exerciseCode: string;
  readonly setNumber: number;
  readonly set: ParsedSet;
}): SyncOperationRequest<'gym_set.log'> {
  const { set } = options;
  return {
    body: {
      ...(options.program !== null && { gymProgramId: options.program.id }),
      ...(options.program !== null && options.dayKey !== null && { dayKey: options.dayKey }),
      sets: [
        {
          clientUuid: options.clientUuid,
          exerciseCode: options.exerciseCode,
          setNumber: options.setNumber,
          ...(set.reps !== null && { reps: set.reps }),
          ...(set.loadKg !== null && { loadKg: set.loadKg }),
          ...(set.rir !== null && { rir: set.rir }),
          ...(set.durationS !== null && { durationS: set.durationS }),
        },
      ],
    },
  };
}

/** Name of an exercise: the library's text, else the program's name, else the code. */
export function exerciseName(
  exerciseCode: string,
  name: string | null,
  { t }: Pick<Translator, 't'>,
): string {
  const key = `gym.exercise.${exerciseCode}`;
  if (isMessageKey(key)) return t(key as 'gym.exercise.push_up');
  return name ?? exerciseCode;
}
