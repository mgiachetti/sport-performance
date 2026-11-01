import { memberGuard } from '../enum.js';
import { DomainValidationError, describeValue } from '../errors.js';
import { SEXES, type Sex } from '../sex.js';
import { KHAMIS_ROCHE_1994_TABLE } from './khamis-roche-1994.js';
import type { CoefficientProvenance } from './provenance.js';
import { assertFinite, assertPositiveFinite } from './validation.js';

/**
 * Predicted adult height and percentage of it already reached (metric
 * `adult_height_pct`) with the Khamis-Roche method: a regression on the
 * child's height, weight and midparent height whose coefficients change with
 * age and sex. The coefficients are a table (data, seeded in the database by
 * B-306); {@link predictAdultHeight} works with any table that satisfies
 * {@link KhamisRocheTable}.
 */

/** One age row. Units are the paper's: inches and pounds. */
export interface KhamisRocheRow {
  /** Decimal age of the row (years). */
  readonly ageYears: number;
  /** β0, in inches. */
  readonly interceptIn: number;
  /** β1: inches of adult height per inch of current height. */
  readonly heightInCoef: number;
  /** β2: inches of adult height per pound of current weight. */
  readonly weightLbCoef: number;
  /** β3: inches of adult height per inch of midparent height. */
  readonly midparentHeightInCoef: number;
}

export interface KhamisRocheTable {
  /** Stable identifier stored with each computed value (`khamis_roche_1994`). */
  readonly code: string;
  readonly provenance: CoefficientProvenance;
  /** Rows per sex, ages strictly increasing. */
  readonly rows: Readonly<Record<Sex, readonly KhamisRocheRow[]>>;
}

/**
 * How to get coefficients for an age between two rows.
 * - `linear`: interpolate linearly between the two rows (no jumps when the
 *   player crosses a half year, so `adult_height_pct` series are smooth).
 * - `nearest_row`: use the closest row (ties go to the older row), as when the
 *   table is read by hand.
 */
export const KHAMIS_ROCHE_AGE_MODES = ['linear', 'nearest_row'] as const;
export type KhamisRocheAgeMode = (typeof KHAMIS_ROCHE_AGE_MODES)[number];
export const isKhamisRocheAgeMode = memberGuard(KHAMIS_ROCHE_AGE_MODES);

export interface KhamisRocheParams {
  readonly table: KhamisRocheTable;
  readonly ageMode: KhamisRocheAgeMode;
}

/**
 * Defaults. The paper tabulates half years; interpolating between rows is a
 * product decision (smooth series), not part of the published method.
 */
export const DEFAULT_KHAMIS_ROCHE_PARAMS: KhamisRocheParams = {
  table: KHAMIS_ROCHE_1994_TABLE,
  ageMode: 'linear',
};

export const CM_PER_INCH = 2.54;
export const KG_PER_POUND = 0.45359237;

export interface AdultHeightInput {
  readonly sex: Sex;
  /** Decimal age on the measurement day (days / 365.25). */
  readonly ageYears: number;
  readonly heightCm: number;
  readonly weightKg: number;
  readonly motherHeightCm: number;
  readonly fatherHeightCm: number;
}

export interface AdultHeightResult {
  /** Code of the coefficient table used. */
  readonly tableCode: string;
  readonly predictedAdultHeightCm: number;
  /** `heightCm / predictedAdultHeightCm × 100`. Above 100 if the prediction is below current height. */
  readonly adultHeightPct: number;
  /** `predictedAdultHeightCm − heightCm`; negative if the prediction is below current height. */
  readonly remainingGrowthCm: number;
  /** Mean of the parents' heights, without sex adjustment (the model includes it). */
  readonly midparentHeightCm: number;
  /**
   * The regression predicted less than the height already reached (possible
   * near the end of the table). Values are not clamped: the consumer decides.
   */
  readonly predictionBelowCurrentHeight: boolean;
}

/** Inclusive age range a table covers for a sex. */
export function khamisRocheAgeRangeYears(
  sex: Sex,
  table: KhamisRocheTable = KHAMIS_ROCHE_1994_TABLE,
): { readonly minYears: number; readonly maxYears: number } {
  const rows = validRows(table, sex);
  return { minYears: firstRow(rows).ageYears, maxYears: lastRow(rows).ageYears };
}

/** Whether a table covers an age; the prediction is never extrapolated. */
export function khamisRocheSupportsAge(
  sex: Sex,
  ageYears: number,
  table: KhamisRocheTable = KHAMIS_ROCHE_1994_TABLE,
): boolean {
  const { minYears, maxYears } = khamisRocheAgeRangeYears(sex, table);
  return Number.isFinite(ageYears) && ageYears >= minYears && ageYears <= maxYears;
}

/** Coefficients for an exact age. Throws outside the table's age range. */
export function khamisRocheCoefficients(
  sex: Sex,
  ageYears: number,
  params: Partial<KhamisRocheParams> = {},
): KhamisRocheRow {
  const { table, ageMode } = { ...DEFAULT_KHAMIS_ROCHE_PARAMS, ...params };
  assertFinite(ageYears, 'ageYears');
  const rows = validRows(table, sex);
  const first = firstRow(rows);
  const last = lastRow(rows);
  if (ageYears < first.ageYears || ageYears > last.ageYears) {
    throw new DomainValidationError(
      'invalid_argument',
      `Age ${String(ageYears)} is outside the ${table.code} table for ${sex} (${String(first.ageYears)}-${String(last.ageYears)} years).`,
      { sex, ageYears, tableCode: table.code },
    );
  }

  const upperIndex = rows.findIndex((row) => row.ageYears >= ageYears);
  const upper = rows[upperIndex] ?? last;
  if (upper.ageYears === ageYears || upperIndex === 0) return upper;
  const lower = rows[upperIndex - 1] ?? first;

  const fraction = (ageYears - lower.ageYears) / (upper.ageYears - lower.ageYears);
  if (ageMode === 'nearest_row') return fraction >= 0.5 ? upper : lower;
  const lerp = (a: number, b: number): number => a + (b - a) * fraction;
  return {
    ageYears,
    interceptIn: lerp(lower.interceptIn, upper.interceptIn),
    heightInCoef: lerp(lower.heightInCoef, upper.heightInCoef),
    weightLbCoef: lerp(lower.weightLbCoef, upper.weightLbCoef),
    midparentHeightInCoef: lerp(lower.midparentHeightInCoef, upper.midparentHeightInCoef),
  };
}

/** Khamis-Roche predicted adult height and percentage reached. */
export function predictAdultHeight(
  input: AdultHeightInput,
  params: Partial<KhamisRocheParams> = {},
): AdultHeightResult {
  const { sex, ageYears, heightCm, weightKg, motherHeightCm, fatherHeightCm } = input;
  assertPositiveFinite(heightCm, 'heightCm');
  assertPositiveFinite(weightKg, 'weightKg');
  assertPositiveFinite(motherHeightCm, 'motherHeightCm');
  assertPositiveFinite(fatherHeightCm, 'fatherHeightCm');
  const merged = { ...DEFAULT_KHAMIS_ROCHE_PARAMS, ...params };
  const row = khamisRocheCoefficients(sex, ageYears, merged);

  const midparentHeightCm = (motherHeightCm + fatherHeightCm) / 2;
  const predictedIn =
    row.interceptIn +
    row.heightInCoef * (heightCm / CM_PER_INCH) +
    row.weightLbCoef * (weightKg / KG_PER_POUND) +
    row.midparentHeightInCoef * (midparentHeightCm / CM_PER_INCH);
  const predictedAdultHeightCm = predictedIn * CM_PER_INCH;
  if (!(predictedAdultHeightCm > 0)) {
    throw new DomainValidationError(
      'invalid_argument',
      `Khamis-Roche produced a non-positive adult height (${String(predictedAdultHeightCm)} cm); check the inputs.`,
      input,
    );
  }

  return {
    tableCode: merged.table.code,
    predictedAdultHeightCm,
    adultHeightPct: (heightCm / predictedAdultHeightCm) * 100,
    remainingGrowthCm: predictedAdultHeightCm - heightCm,
    midparentHeightCm,
    predictionBelowCurrentHeight: predictedAdultHeightCm < heightCm,
  };
}

const validatedTables = new WeakSet<KhamisRocheTable>();

/**
 * Throws unless the table has, for every sex, at least one row, strictly
 * increasing ages and finite coefficients. Use it when loading a table from the
 * database; the prediction functions call it too (once per table object).
 */
export function assertValidKhamisRocheTable(table: KhamisRocheTable): void {
  if (validatedTables.has(table)) return;
  for (const sex of SEXES) {
    const rows = (table.rows as Partial<Record<Sex, readonly KhamisRocheRow[]>>)[sex];
    if (rows === undefined || rows.length === 0) {
      throw invalidTable(table, `has no rows for ${sex}`);
    }
    let previousAge = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      const values = [
        row.ageYears,
        row.interceptIn,
        row.heightInCoef,
        row.weightLbCoef,
        row.midparentHeightInCoef,
      ];
      if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        throw invalidTable(
          table,
          `has a non-finite value at ${sex} age ${describeValue(row.ageYears)}`,
        );
      }
      if (row.ageYears <= previousAge) {
        throw invalidTable(
          table,
          `ages for ${sex} are not strictly increasing at ${String(row.ageYears)}`,
        );
      }
      previousAge = row.ageYears;
    }
  }
  validatedTables.add(table);
}

function invalidTable(table: KhamisRocheTable, detail: string): DomainValidationError {
  return new DomainValidationError(
    'invalid_argument',
    `Khamis-Roche table ${describeValue(table.code)} ${detail}.`,
    table.code,
  );
}

function validRows(table: KhamisRocheTable, sex: Sex): readonly KhamisRocheRow[] {
  assertValidKhamisRocheTable(table);
  return table.rows[sex];
}

function firstRow(rows: readonly KhamisRocheRow[]): KhamisRocheRow {
  const row = rows[0];
  if (row === undefined) throw new Error('unreachable: validated table has rows');
  return row;
}

function lastRow(rows: readonly KhamisRocheRow[]): KhamisRocheRow {
  const row = rows[rows.length - 1];
  if (row === undefined) throw new Error('unreachable: validated table has rows');
  return row;
}
