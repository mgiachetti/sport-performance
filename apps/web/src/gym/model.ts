import type { GymPlanInput, GymProgram, ValidationIssue } from '@sport-performance/contracts';
import {
  GYM_LIBRARY_EXERCISE_CODES,
  can,
  gymLibraryExercise,
  isGymExerciseCode,
  type GymLoadKind,
  type GymMeasure,
  type Stage,
} from '@sport-performance/domain';
import { isMessageKey, parseNumber, type MessageKey } from '@sport-performance/i18n';
import type { ActiveClub } from '../club/active-club';
import { categoryFacts } from '../permissions/permissions';

/**
 * The gym screens of the staff web (B-607, ADR 0075): the program form as
 * the user types it (strings), how it becomes the plan of the contract, and
 * where the API's issues land in it. The rules of the stage are the API's
 * (`gymPlanIssues` of the domain); the form only shapes and parses.
 */

/** Value of the exercise select for a club's own exercise. */
export const CUSTOM_EXERCISE = '__custom__';

export interface ExerciseForm {
  readonly key: string;
  /** A library code, or {@link CUSTOM_EXERCISE}. */
  readonly choice: string;
  readonly customCode: string;
  readonly customName: string;
  readonly loadKind: GymLoadKind;
  readonly measure: GymMeasure;
  readonly sets: string;
  readonly repsMin: string;
  readonly repsMax: string;
  readonly durationS: string;
  readonly targetRir: string;
  readonly loadKg: string;
  readonly restS: string;
  readonly notes: string;
}

export interface DayForm {
  readonly key: string;
  readonly name: string;
  readonly exercises: readonly ExerciseForm[];
}

export interface ProgramForm {
  readonly name: string;
  readonly categoryId: string;
  readonly stage: Stage | '';
  readonly validFrom: string;
  readonly validTo: string;
  readonly notes: string;
  readonly days: readonly DayForm[];
}

const newKey = () => crypto.randomUUID();

export function emptyExercise(choice = 'goblet_squat'): ExerciseForm {
  const spec = gymLibraryExercise(choice);
  return {
    key: newKey(),
    choice,
    customCode: '',
    customName: '',
    loadKind: spec?.loadKind ?? 'bodyweight',
    measure: spec?.measure ?? 'reps',
    sets: '3',
    repsMin: spec?.measure === 'duration' ? '' : '8',
    repsMax: spec?.measure === 'duration' ? '' : '10',
    durationS: spec?.measure === 'duration' ? '30' : '',
    targetRir: spec?.loadKind === 'bodyweight' ? '' : '2',
    loadKg: '',
    restS: '90',
    notes: '',
  };
}

/** The key of the `index`-th day: `a`, `b`… (stable: sets point at it). */
export function dayKeyAt(index: number): string {
  return String.fromCharCode(97 + index);
}

export function emptyDay(index: number): DayForm {
  return { key: dayKeyAt(index), name: '', exercises: [emptyExercise()] };
}

export function emptyProgramForm(categoryId: string, today: string): ProgramForm {
  return {
    name: '',
    categoryId,
    stage: '',
    validFrom: today,
    validTo: '',
    notes: '',
    days: [emptyDay(0)],
  };
}

/** Picking an exercise of the library takes its load kind and measure. */
export function withChoice(exercise: ExerciseForm, choice: string): ExerciseForm {
  const spec = gymLibraryExercise(choice);
  if (spec === undefined) return { ...exercise, choice };
  return {
    ...exercise,
    choice,
    loadKind: spec.loadKind,
    measure: spec.measure,
    ...(spec.loadKind === 'bodyweight' ? { loadKg: '', targetRir: '' } : {}),
    ...(spec.measure === 'duration'
      ? { repsMin: '', repsMax: '', durationS: exercise.durationS || '30' }
      : { durationS: '' }),
  };
}

const text = (value: number | null) => (value === null ? '' : String(value).replace('.', ','));

/** The form of a stored program (editing). */
export function programForm(program: GymProgram): ProgramForm {
  return {
    name: program.name,
    categoryId: program.categoryId ?? '',
    stage: program.stage ?? '',
    validFrom: program.validFrom,
    validTo: program.validTo ?? '',
    notes: program.notes ?? '',
    days: program.plan.days.map((day) => ({
      key: day.key,
      name: day.name,
      exercises: day.exercises.map((exercise) => {
        const library = gymLibraryExercise(exercise.exerciseCode) !== undefined;
        return {
          key: newKey(),
          choice: library ? exercise.exerciseCode : CUSTOM_EXERCISE,
          customCode: library ? '' : exercise.exerciseCode,
          customName: exercise.name ?? '',
          loadKind: exercise.loadKind,
          measure: exercise.measure,
          sets: String(exercise.sets),
          repsMin: text(exercise.repsMin),
          repsMax: text(exercise.repsMax),
          durationS: text(exercise.durationS),
          targetRir: text(exercise.targetRir),
          loadKg: text(exercise.loadKg),
          restS: text(exercise.restS),
          notes: exercise.notes ?? '',
        };
      }),
    })),
  };
}

/** A problem of the form found before sending, at its path in the body. */
export interface FormIssue {
  readonly path: string;
  readonly code: 'required' | 'number' | 'code';
}

function integer(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * The plan of the contract from the form, or the fields that are not numbers
 * or are missing. Ranges and stage rules are answered by the API.
 */
export function planInput(form: ProgramForm): { plan: GymPlanInput } | { issues: FormIssue[] } {
  const issues: FormIssue[] = [];
  const days = form.days.map((day, d) => {
    if (day.name.trim() === '')
      issues.push({ path: `plan.days.${String(d)}.name`, code: 'required' });
    return {
      key: day.key,
      name: day.name.trim(),
      exercises: day.exercises.map((exercise, e) => {
        const at = (field: string) => `plan.days.${String(d)}.exercises.${String(e)}.${field}`;
        const custom = exercise.choice === CUSTOM_EXERCISE;
        const code = custom ? exercise.customCode.trim() : exercise.choice;
        if (!isGymExerciseCode(code)) issues.push({ path: at('exerciseCode'), code: 'code' });
        const optionalInt = (
          field: 'repsMin' | 'repsMax' | 'durationS' | 'targetRir' | 'restS',
          path: string,
        ) => {
          const raw = exercise[field].trim();
          if (raw === '') return null;
          const value = integer(raw);
          if (value === null) issues.push({ path: at(path), code: 'number' });
          return value;
        };
        const sets = integer(exercise.sets);
        if (sets === null) issues.push({ path: at('sets'), code: 'required' });
        const loadText = exercise.loadKg.trim();
        const loadKg = loadText === '' ? null : parseNumber(loadText);
        if (loadText !== '' && loadKg === null) issues.push({ path: at('loadKg'), code: 'number' });
        return {
          exerciseCode: code,
          name: custom ? exercise.customName.trim() || null : null,
          loadKind: exercise.loadKind,
          measure: exercise.measure,
          sets: sets ?? 0,
          repsMin: optionalInt('repsMin', 'repsMin'),
          repsMax: optionalInt('repsMax', 'repsMax'),
          durationS: optionalInt('durationS', 'durationS'),
          targetRir: optionalInt('targetRir', 'targetRir'),
          loadKg,
          restS: optionalInt('restS', 'restS'),
          notes: exercise.notes.trim() === '' ? null : exercise.notes.trim(),
        };
      }),
    };
  });
  if (issues.length > 0) return { issues };
  return { plan: { days } };
}

/** `body.plan.days.0.exercises.1.targetRir` → `plan.days.0.exercises.1.targetRir`. */
export function issuePaths(details: readonly ValidationIssue[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const detail of details ?? []) {
    const path = detail.path.slice(detail.path[0] === 'body' ? 1 : 0).join('.');
    if (!out.has(path)) out.set(path, detail.message);
  }
  return out;
}

/** The library, for the exercise select: code and label key, in the order of the library. */
export function libraryOptions(): { code: string; labelKey: MessageKey }[] {
  return GYM_LIBRARY_EXERCISE_CODES.map((code) => ({
    code,
    labelKey: `gym.exercise.${code}` as MessageKey,
  }));
}

/** Name of an exercise: the library's text, else the program's name, else the code. */
export function exerciseLabel(
  t: (key: MessageKey) => string,
  exerciseCode: string,
  name: string | null,
): string {
  const key = `gym.exercise.${exerciseCode}`;
  if (isMessageKey(key)) return t(key);
  return name ?? exerciseCode;
}

/** Categories where the caller manages programs (`gym_program.manage`). */
export function manageableGymCategories(active: ActiveClub) {
  return active.categories.filter((category) =>
    can(active.subject, 'manage', {
      kind: 'gym_program',
      clubId: active.club.id,
      category: categoryFacts(category),
    }),
  );
}

/** Whether the caller manages a program (its category; a player's program, by the API). */
export function canManageProgram(active: ActiveClub, program: GymProgram): boolean {
  if (program.categoryId === null) return manageableGymCategories(active).length > 0;
  const category = active.categories.find((c) => c.id === program.categoryId);
  return category !== undefined && manageableGymCategories(active).includes(category);
}
