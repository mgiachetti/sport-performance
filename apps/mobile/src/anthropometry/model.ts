import {
  ANTHRO_FIELDS,
  ANTHRO_HEIGHT_MAX_CM,
  ANTHRO_SITTING_HEIGHT_MAX_CM,
  ANTHRO_SKINFOLDS_SUM_MAX_MM,
  ANTHRO_WEIGHT_MAX_KG,
  type AnthroMeasurement,
  type SyncOperationRequest,
} from '@sport-performance/contracts';
import {
  createPlausibilityChecker,
  daysBetween,
  decimalAgeYears,
  parseMetricCode,
  type LocalDate,
  type Sex,
  type Stage,
} from '@sport-performance/domain';
import { parseNumber } from '@sport-performance/i18n';

/**
 * Pure model of the field anthropometry sheet (B-508, ADR 0083): what the
 * staff types per player (es-AR text), checked on the phone with the rules
 * of the online batch (ADR 0064) and the plausibility ranges of the domain,
 * the inputs of the offline queue and the measurements of the day as the
 * local database and the queue have them.
 */

export type AnthroField = (typeof ANTHRO_FIELDS)[number];
export { ANTHRO_FIELDS };

/** Hard bounds of the contract: beyond them it is a typo, never queued. */
export const FIELD_MAX: Readonly<Record<AnthroField, number>> = {
  heightCm: ANTHRO_HEIGHT_MAX_CM,
  sittingHeightCm: ANTHRO_SITTING_HEIGHT_MAX_CM,
  weightKg: ANTHRO_WEIGHT_MAX_KG,
  skinfoldsSumMm: ANTHRO_SKINFOLDS_SUM_MAX_MM,
};

/** A player of the sheet, with what the server said of them when the squad was downloaded. */
export interface SquadPlayer {
  readonly id: string;
  readonly name: string;
  readonly sex: Sex;
  readonly birthDate: LocalDate;
  /** Their stage on the day the squad was read (`null`: unknown, read it again online). */
  readonly stage: Stage | null;
  /** Without a current data consent: nothing of theirs is recorded (the server refuses it). */
  readonly blocked: boolean;
  /** Khamis-Roche needs both parents' heights: the % of adult height will not come. */
  readonly parentHeightsMissing: boolean;
}

/**
 * The fields of a player's row: the ISAK skinfolds only in the performance
 * stage (M17/M19, CLAUDE.md principle 3). An unknown stage leaves them out:
 * the server would refuse them outside that stage.
 */
export function fieldsFor(player: Pick<SquadPlayer, 'stage'>): readonly AnthroField[] {
  return player.stage === 'performance'
    ? ANTHRO_FIELDS
    : ANTHRO_FIELDS.filter((field) => field !== 'skinfoldsSumMm');
}

export type FieldProblem = 'number' | 'range' | 'sittingAboveHeight';

export type DraftTexts = Readonly<Partial<Record<AnthroField, string>>>;
export type MeasurementValues = Readonly<Partial<Record<AnthroField, number>>>;

export interface ParsedDraft {
  readonly values: MeasurementValues;
  readonly problems: Readonly<Partial<Record<AnthroField, FieldProblem>>>;
  /** Anything typed at all (valid or not). */
  readonly touched: boolean;
}

/** One typed value: empty, a number within the hard bounds, or why it is not. */
export function parseField(
  text: string | undefined,
  field: AnthroField,
): { value?: number; problem?: FieldProblem } {
  if (text === undefined || text.trim() === '') return {};
  // Short measures: no thousands separators (`1.650` is a typo, not 1650).
  const value = parseNumber(text, { allowGrouping: false });
  if (value === null) return { problem: 'number' };
  if (value <= 0 || value > FIELD_MAX[field]) return { problem: 'range' };
  return { value };
}

/** The draft of a player's row, with only the fields their stage measures. */
export function parseDraft(texts: DraftTexts, player: Pick<SquadPlayer, 'stage'>): ParsedDraft {
  const values: Partial<Record<AnthroField, number>> = {};
  const problems: Partial<Record<AnthroField, FieldProblem>> = {};
  let touched = false;
  for (const field of fieldsFor(player)) {
    const text = texts[field];
    if (text !== undefined && text.trim() !== '') touched = true;
    const parsed = parseField(text, field);
    if (parsed.value !== undefined) values[field] = parsed.value;
    if (parsed.problem !== undefined) problems[field] = parsed.problem;
  }
  if (
    values.heightCm !== undefined &&
    values.sittingHeightCm !== undefined &&
    values.sittingHeightCm >= values.heightCm
  ) {
    problems.sittingHeightCm = 'sittingAboveHeight';
    delete values.sittingHeightCm;
  }
  return { values, problems, touched };
}

export const hasProblems = (draft: ParsedDraft) => Object.keys(draft.problems).length > 0;
export const hasValues = (draft: ParsedDraft) => Object.keys(draft.values).length > 0;

/** What a row can save: values, no problems and a player whose data the club may keep. */
export function canSave(draft: ParsedDraft, player: Pick<SquadPlayer, 'blocked'>): boolean {
  return !player.blocked && hasValues(draft) && !hasProblems(draft);
}

// ─── Plausibility, on the phone ─────────────────────────────────────────────────────

const plausibility = createPlausibilityChecker();

/** The metric of the plausibility ranges of each field (the same the API checks). */
const PLAUSIBILITY_METRICS = {
  heightCm: 'height_cm',
  sittingHeightCm: 'sitting_height_cm',
  weightKg: 'weight_kg',
  skinfoldsSumMm: 'skinfolds_sum_mm',
} as const satisfies Record<AnthroField, string>;

export interface PlausibilityWarning {
  readonly field: AnthroField;
  readonly status: 'below' | 'above';
  readonly minValue: number;
  readonly maxValue: number;
  /** The same number with the decimal point moved, within the range ("¿quisiste decir…?"). */
  readonly suggestedValues: readonly number[];
}

/**
 * Values outside the plausible range for the player's age and sex, with the
 * domain's ranges (the same checker the API preview runs): it works without
 * signal and never blocks the save.
 */
export function plausibilityOf(
  player: Pick<SquadPlayer, 'sex' | 'birthDate'>,
  values: MeasurementValues,
  measuredOn: LocalDate,
): PlausibilityWarning[] {
  const ageYears =
    daysBetween(player.birthDate, measuredOn) > 0
      ? decimalAgeYears(player.birthDate, measuredOn)
      : null;
  const warnings: PlausibilityWarning[] = [];
  for (const field of ANTHRO_FIELDS) {
    const value = values[field];
    if (value === undefined) continue;
    const check = plausibility({
      metricCode: parseMetricCode(PLAUSIBILITY_METRICS[field]),
      value,
      sex: player.sex,
      ageYears,
    });
    if (check.status === 'below' || check.status === 'above') {
      warnings.push({
        field,
        status: check.status,
        minValue: check.bounds.minValue,
        maxValue: check.bounds.maxValue,
        suggestedValues: [...check.suggestedValues],
      });
    }
  }
  return warnings;
}

// ─── Inputs of the queue ────────────────────────────────────────────────────────────

/**
 * One measurement per mutation: the online batch is all or nothing, so a
 * player without consent (or any other problem of a row) only rejects their
 * own measurement, never the rest of the squad loaded offline.
 */
export function recordInput(
  clientUuid: string,
  playerId: string,
  measuredOn: LocalDate,
  values: MeasurementValues,
): SyncOperationRequest<'anthro.record'> {
  return { body: { measurements: [{ clientUuid, playerId, measuredOn, ...values }] } };
}

export type MeasurementTarget = { readonly id: string } | { readonly clientUuid: string };

/**
 * A correction: only the fields that changed (an emptied one is `null`), with
 * the reason the history keeps (ADR 0030). `null` when nothing changed.
 */
export function correctionInput(
  target: MeasurementTarget,
  before: Readonly<Record<AnthroField, number | null>>,
  after: MeasurementValues,
  fields: readonly AnthroField[],
  changeReason: string,
): SyncOperationRequest<'anthro.update'> | null {
  const body: Partial<Record<AnthroField, number | null>> = {};
  for (const field of fields) {
    const next = after[field] ?? null;
    if (next !== before[field]) body[field] = next;
  }
  if (Object.keys(body).length === 0) return null;
  return { target: { ...target }, body: { changeReason: changeReason.trim(), ...body } };
}

// ─── Measurements of the day ────────────────────────────────────────────────────────

/**
 * A measurement of the day as the sheet shows it: from the server (with
 * the edits of the queue laid over) or still only in the queue.
 */
export interface DayMeasurement {
  /** How an edit names it: its id, or the `clientUuid` of a create not served yet. */
  readonly target: MeasurementTarget;
  readonly playerId: string;
  readonly values: Readonly<Record<AnthroField, number | null>>;
  /**
   * `queued`: only in the phone's queue. `pending`: on the server, with an
   * edit of the queue on top. `synced`: as the server served it.
   */
  readonly sync: 'queued' | 'pending' | 'synced';
  /** The maturation the worker derived; `null` until the server has the measurement. */
  readonly maturation: AnthroMeasurement['maturation'] | null;
}

export function valuesOf(
  source: Readonly<Partial<Record<AnthroField, number | null | undefined>>>,
): Record<AnthroField, number | null> {
  return {
    heightCm: source.heightCm ?? null,
    sittingHeightCm: source.sittingHeightCm ?? null,
    weightKg: source.weightKg ?? null,
    skinfoldsSumMm: source.skinfoldsSumMm ?? null,
  };
}

/** A served row of the local database (the DTO with the queue's edits on top). */
export interface ServedMeasurement {
  readonly data: AnthroMeasurement;
  readonly clientUuid: string | null;
  readonly pending: boolean;
}

/** A create of the queue not served yet, with the queued corrections that name it applied. */
export interface QueuedMeasurement {
  readonly clientUuid: string;
  readonly playerId: string;
  readonly measuredOn: LocalDate;
  readonly values: Readonly<Record<AnthroField, number | null>>;
}

/**
 * The latest measurement of each player on `measuredOn`: the served rows in
 * the order they were created, then the creates still in the queue (a
 * create the pull already brought is the served row). A second measurement
 * of the same day replaces the first on the sheet, as the worker takes the
 * later one of a day.
 */
export function dayMeasurements(
  served: readonly ServedMeasurement[],
  queued: readonly QueuedMeasurement[],
  measuredOn: LocalDate,
): Map<string, DayMeasurement> {
  const byPlayer = new Map<string, DayMeasurement>();
  const servedUuids = new Set<string>();
  const ofDay = served
    .filter((row) => row.data.measuredOn === measuredOn)
    .sort((a, b) => (a.data.createdAt < b.data.createdAt ? -1 : 1));
  for (const row of served) if (row.clientUuid !== null) servedUuids.add(row.clientUuid);
  for (const row of ofDay) {
    byPlayer.set(row.data.playerId, {
      target: { id: row.data.id },
      playerId: row.data.playerId,
      values: valuesOf(row.data),
      sync: row.pending ? 'pending' : 'synced',
      maturation: row.data.maturation,
    });
  }
  for (const create of queued) {
    if (create.measuredOn !== measuredOn || servedUuids.has(create.clientUuid)) continue;
    byPlayer.set(create.playerId, {
      target: { clientUuid: create.clientUuid },
      playerId: create.playerId,
      values: create.values,
      sync: 'queued',
      maturation: null,
    });
  }
  return byPlayer;
}

/** The texts of a saved measurement, for correcting it in the same fields it was typed in. */
export function draftOf(
  values: Readonly<Record<AnthroField, number | null>>,
  format: (value: number) => string,
): Partial<Record<AnthroField, string>> {
  const texts: Partial<Record<AnthroField, string>> = {};
  for (const field of ANTHRO_FIELDS) {
    const value = values[field];
    if (value !== null) texts[field] = format(value);
  }
  return texts;
}
