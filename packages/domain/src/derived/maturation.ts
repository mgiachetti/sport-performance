import { DomainValidationError } from '../errors.js';
import {
  MATURITY_OFFSET_MODELS,
  khamisRocheSupportsAge,
  latestGrowthVelocity,
  maturityOffsetRequiredInputs,
  predictAdultHeight,
  predictMaturityOffset,
  type HeightMeasurement,
  type KhamisRocheTable,
  type MaturityOffsetEquation,
} from '../maturation/index.js';
import type { Sex } from '../sex.js';
import { compareLocalDates, daysBetween, decimalAgeYears, type LocalDate } from '../time.js';
import { DEFAULT_MATURATION_PARAMS, type MaturationParams } from './parameters.js';

/** One anthropometry row (`anthro_measurement`); every value may be missing. */
export interface AnthropometryInput {
  readonly id: string;
  readonly date: LocalDate;
  readonly heightCm: number | null;
  readonly sittingHeightCm: number | null;
  readonly weightKg: number | null;
}

export interface MaturationInput {
  readonly sex: Sex;
  readonly birthDate: LocalDate;
  /**
   * The player's measurements, in any order. Two on the same day: the later
   * one in the array wins for growth velocity (pass them by creation time).
   */
  readonly measurements: readonly AnthropometryInput[];
  readonly motherHeightCm: number | null;
  readonly fatherHeightCm: number | null;
  /** The club's seeded table; `null` when the club has none (no % of adult height). */
  readonly khamisRocheTable: KhamisRocheTable | null;
  readonly params?: MaturationParams;
}

/** What the worker writes back on each measurement. `null`: not enough data, never a guess. */
export interface MaturationResult {
  readonly id: string;
  readonly phvOffsetYears: number | null;
  readonly maturityOffsetEquation: MaturityOffsetEquation | null;
  readonly predictedAdultHeightCm: number | null;
  readonly adultHeightPct: number | null;
  /** Code of the Khamis-Roche table used, when `adultHeightPct` is set. */
  readonly khamisRocheTableCode: string | null;
  readonly growthVelocityCmYear: number | null;
}

/**
 * Equations tried, in order, for a sex: the club's choice, then the published
 * alternatives that need fewer measurements (Moore 2015, and for boys its
 * height-only variant). Each row stores the equation it was computed with, so
 * values from different equations are never mixed silently (principle 4).
 */
export function maturityOffsetEquationChain(
  preferred: MaturityOffsetEquation,
  sex: Sex,
): MaturityOffsetEquation[] {
  const fallbacks: readonly MaturityOffsetEquation[] =
    sex === 'male' ? ['moore_2015', 'moore_2015_height'] : ['moore_2015'];
  const chain = [preferred, ...fallbacks.filter((e) => e !== preferred)];
  return chain.filter((equation) =>
    MATURITY_OFFSET_MODELS.some((m) => m.equation === equation && m.sex === sex),
  );
}

function positive(value: number | null): number | undefined {
  return value !== null && Number.isFinite(value) && value > 0 ? value : undefined;
}

function offsetFor(
  sex: Sex,
  ageYears: number,
  m: AnthropometryInput,
  chain: readonly MaturityOffsetEquation[],
): { readonly years: number; readonly equation: MaturityOffsetEquation } | null {
  const heightCm = positive(m.heightCm);
  if (heightCm === undefined) return null;
  const sittingHeightCm = positive(m.sittingHeightCm);
  const weightKg = positive(m.weightKg);
  for (const equation of chain) {
    const model = MATURITY_OFFSET_MODELS.find((x) => x.equation === equation && x.sex === sex);
    if (model === undefined) continue;
    const required = maturityOffsetRequiredInputs(model);
    if (required.includes('sittingHeightCm') && sittingHeightCm === undefined) continue;
    if (required.includes('weightKg') && weightKg === undefined) continue;
    if (sittingHeightCm !== undefined && required.includes('sittingHeightCm')) {
      if (sittingHeightCm >= heightCm) continue;
    }
    const result = predictMaturityOffset(model, { ageYears, heightCm, sittingHeightCm, weightKg });
    return { years: result.maturityOffsetYears, equation };
  }
  return null;
}

/**
 * Maturation of every measurement of a player: maturity offset (years from
 * PHV), Khamis-Roche predicted adult height and % reached, and growth
 * velocity up to that day. Only measurements of the same day are combined
 * (weight and sitting height are not carried over from other days).
 */
export function deriveMaturation(input: MaturationInput): MaturationResult[] {
  const params = input.params ?? DEFAULT_MATURATION_PARAMS;
  const chain = maturityOffsetEquationChain(params.maturityOffsetEquation, input.sex);
  const mother = positive(input.motherHeightCm);
  const father = positive(input.fatherHeightCm);
  const table = input.khamisRocheTable;

  // Height per day for growth velocity: the last measurement of each day wins.
  const heightByDay = new Map<LocalDate, number>();
  for (const m of input.measurements) {
    const heightCm = positive(m.heightCm);
    if (heightCm !== undefined) heightByDay.set(m.date, heightCm);
  }
  const heights: HeightMeasurement[] = [...heightByDay]
    .map(([date, heightCm]) => ({ date, heightCm }))
    .sort((a, b) => compareLocalDates(a.date, b.date));

  return input.measurements.map((m) => {
    const empty: MaturationResult = {
      id: m.id,
      phvOffsetYears: null,
      maturityOffsetEquation: null,
      predictedAdultHeightCm: null,
      adultHeightPct: null,
      khamisRocheTableCode: null,
      growthVelocityCmYear: null,
    };
    if (daysBetween(input.birthDate, m.date) <= 0) return empty;
    const ageYears = decimalAgeYears(input.birthDate, m.date);
    const heightCm = positive(m.heightCm);
    const weightKg = positive(m.weightKg);

    const offset = offsetFor(input.sex, ageYears, m, chain);

    let predictedAdultHeightCm: number | null = null;
    let adultHeightPct: number | null = null;
    let khamisRocheTableCode: string | null = null;
    if (
      table !== null &&
      heightCm !== undefined &&
      weightKg !== undefined &&
      mother !== undefined &&
      father !== undefined &&
      khamisRocheSupportsAge(input.sex, ageYears, table)
    ) {
      try {
        const prediction = predictAdultHeight(
          {
            sex: input.sex,
            ageYears,
            heightCm,
            weightKg,
            motherHeightCm: mother,
            fatherHeightCm: father,
          },
          { table, ageMode: params.khamisRocheAgeMode },
        );
        predictedAdultHeightCm = prediction.predictedAdultHeightCm;
        adultHeightPct = prediction.adultHeightPct;
        khamisRocheTableCode = prediction.tableCode;
      } catch (error) {
        // A non-positive prediction from implausible inputs: no value, never a guess.
        if (!(error instanceof DomainValidationError)) throw error;
      }
    }

    let growthVelocityCmYear: number | null = null;
    if (heightCm !== undefined) {
      const upTo = heights.filter((h) => compareLocalDates(h.date, m.date) < 0);
      upTo.push({ date: m.date, heightCm });
      growthVelocityCmYear =
        latestGrowthVelocity(upTo, params.growthVelocity)?.growthVelocityCmYear ?? null;
    }

    return {
      id: m.id,
      phvOffsetYears: offset?.years ?? null,
      maturityOffsetEquation: offset?.equation ?? null,
      predictedAdultHeightCm,
      adultHeightPct,
      khamisRocheTableCode,
      growthVelocityCmYear,
    };
  });
}

/**
 * Why a maturation value of a measurement is missing (B-412): what the staff
 * can fix on the day of measurements (a height, a weight, the parents'
 * heights) or why it cannot be computed (age outside the reference table,
 * the club has no table). Never a guess: the UI shows the reason instead.
 */
export const MATURATION_GAPS = [
  /** The measurement is not after the birth date. */
  'invalid_age',
  'height_missing',
  /** No equation of the chain can do without the sitting height (none is height-only). */
  'sitting_height_missing',
  'weight_missing',
  /** Khamis-Roche needs the height of both biological parents. */
  'parent_heights_missing',
  /** The age is outside the rows of the club's Khamis-Roche table for the sex. */
  'age_outside_reference',
  /** The club has no seeded Khamis-Roche table with the configured code. */
  'no_reference_table',
  /** Every input was there but the prediction was rejected (implausible inputs). */
  'prediction_rejected',
] as const;
export type MaturationGap = (typeof MATURATION_GAPS)[number];

export interface MaturationGaps {
  /** Why `phvOffsetYears` is `null` (empty when it is set). */
  readonly phvOffset: readonly MaturationGap[];
  /** Why `adultHeightPct` is `null` (empty when it is set). */
  readonly adultHeight: readonly MaturationGap[];
}

/**
 * The reasons behind the `null`s of `result`, the {@link deriveMaturation}
 * of `measurement` with the same player inputs. Every missing input is
 * listed (not only the first), so the staff fixes them in one pass.
 * `chain` defaults to the one of `input.params` (see
 * {@link maturityOffsetEquationChain}).
 */
export function maturationGaps(
  input: Omit<MaturationInput, 'measurements'>,
  measurement: AnthropometryInput,
  result: Pick<MaturationResult, 'phvOffsetYears' | 'adultHeightPct'>,
  chain: readonly MaturityOffsetEquation[] = maturityOffsetEquationChain(
    (input.params ?? DEFAULT_MATURATION_PARAMS).maturityOffsetEquation,
    input.sex,
  ),
): MaturationGaps {
  const validAge = daysBetween(input.birthDate, measurement.date) > 0;
  const height = positive(measurement.heightCm) !== undefined;

  const phvOffset: MaturationGap[] = [];
  if (result.phvOffsetYears === null) {
    if (!validAge) phvOffset.push('invalid_age');
    if (!height) phvOffset.push('height_missing');
    if (validAge && height) {
      // Height is there: the inputs that every equation of the chain needs and the day lacks.
      const required = chain.flatMap((equation) => {
        const model = MATURITY_OFFSET_MODELS.find(
          (m) => m.equation === equation && m.sex === input.sex,
        );
        return model === undefined ? [] : [maturityOffsetRequiredInputs(model)];
      });
      const everyNeeds = (field: 'sittingHeightCm' | 'weightKg') =>
        required.length > 0 && required.every((inputs) => inputs.includes(field));
      if (everyNeeds('sittingHeightCm') && positive(measurement.sittingHeightCm) === undefined) {
        phvOffset.push('sitting_height_missing');
      }
      if (everyNeeds('weightKg') && positive(measurement.weightKg) === undefined) {
        phvOffset.push('weight_missing');
      }
      // Every input was there (a sitting height not below the height, for instance).
      if (phvOffset.length === 0) phvOffset.push('prediction_rejected');
    }
  }

  const adultHeight: MaturationGap[] = [];
  if (result.adultHeightPct === null) {
    if (!validAge) adultHeight.push('invalid_age');
    if (!height) adultHeight.push('height_missing');
    if (positive(measurement.weightKg) === undefined) adultHeight.push('weight_missing');
    if (
      positive(input.motherHeightCm) === undefined ||
      positive(input.fatherHeightCm) === undefined
    ) {
      adultHeight.push('parent_heights_missing');
    }
    const table = input.khamisRocheTable;
    if (table === null) {
      adultHeight.push('no_reference_table');
    } else if (
      validAge &&
      !khamisRocheSupportsAge(input.sex, decimalAgeYears(input.birthDate, measurement.date), table)
    ) {
      adultHeight.push('age_outside_reference');
    }
    if (adultHeight.length === 0) adultHeight.push('prediction_rejected');
  }
  return { phvOffset, adultHeight };
}
