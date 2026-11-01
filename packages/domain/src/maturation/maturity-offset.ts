import { memberGuard, memberParser } from '../enum.js';
import { DomainValidationError } from '../errors.js';
import type { Sex } from '../sex.js';
import type { CoefficientProvenance } from './provenance.js';
import { assertPositiveFinite } from './validation.js';

/**
 * Maturity offset: years from peak height velocity (PHV), metric
 * `phv_offset_years`. Negative before PHV, positive after it. Age at PHV is
 * `ageYears − maturityOffsetYears`.
 *
 * Every published equation is a linear model over a few products of age and
 * body dimensions. The coefficients are data ({@link MATURITY_OFFSET_MODELS}),
 * one model per equation and sex, and {@link predictMaturityOffset} evaluates
 * any model, so a corrected or new equation is a data change.
 */

/**
 * - `mirwald_2002`: Mirwald et al. 2002, both sexes.
 * - `moore_2015`: Moore et al. 2015, age × sitting height (boys) and age × height (girls).
 * - `moore_2015_height`: Moore et al. 2015 alternative for boys without sitting
 *   height (age × height). There is no female variant: girls' `moore_2015`
 *   already uses height only.
 */
export const MATURITY_OFFSET_EQUATIONS = [
  'mirwald_2002',
  'moore_2015',
  'moore_2015_height',
] as const;
export type MaturityOffsetEquation = (typeof MATURITY_OFFSET_EQUATIONS)[number];

export const isMaturityOffsetEquation = memberGuard(MATURITY_OFFSET_EQUATIONS);
export const parseMaturityOffsetEquation = memberParser(
  MATURITY_OFFSET_EQUATIONS,
  'invalid_argument',
  'maturity offset equation',
);

/**
 * Default equation (club setting, B-322). Moore 2015 re-fitted Mirwald's data
 * after showing overfitting, calibrates as well in external samples with a
 * single predictor, and needs fewer measurements (girls do not need sitting
 * height).
 */
export const DEFAULT_MATURITY_OFFSET_EQUATION: MaturityOffsetEquation = 'moore_2015';

/**
 * Predictors used by the published equations. Units: age in decimal years,
 * lengths in cm, weight in kg. Leg length is `heightCm − sittingHeightCm`.
 */
export const MATURITY_OFFSET_TERMS = [
  /** Leg length (cm) × sitting height (cm). */
  'leg_length_x_sitting_height',
  /** Age (years) × leg length (cm). */
  'age_x_leg_length',
  /** Age (years) × sitting height (cm). */
  'age_x_sitting_height',
  /** Age (years) × weight (kg). */
  'age_x_weight',
  /** Age (years) × height (cm). */
  'age_x_height',
  /** Weight (kg) / height (cm) × 100. */
  'weight_by_height_ratio',
] as const;
export type MaturityOffsetTerm = (typeof MATURITY_OFFSET_TERMS)[number];

export interface MaturityOffsetModel {
  readonly equation: MaturityOffsetEquation;
  readonly sex: Sex;
  /** Constant term, in years. */
  readonly interceptYears: number;
  /** Coefficient of each predictor; predictors not listed are not used. */
  readonly coefficients: Readonly<Partial<Record<MaturityOffsetTerm, number>>>;
  /** Standard error of the estimate reported by the authors (years), or `null`. */
  readonly seeYears: number | null;
  /**
   * Age range (decimal years, inclusive) of the sample the equation was
   * developed on. Outside it the prediction is an extrapolation: it is still
   * returned, with a warning.
   */
  readonly developmentAgeRangeYears: { readonly minYears: number; readonly maxYears: number };
  readonly provenance: CoefficientProvenance;
}

const MIRWALD_2002: Omit<CoefficientProvenance, 'verificationNotes'> = {
  citation:
    'Mirwald RL, Baxter-Jones ADG, Bailey DA, Beunen GP. An assessment of maturity from anthropometric measurements. Med Sci Sports Exerc. 2002;34(4):689-694.',
  doi: '10.1097/00005768-200204000-00020',
  errata: [],
  verification: 'cross_checked_secondary_sources',
};

const MOORE_2015: Omit<CoefficientProvenance, 'verificationNotes'> = {
  citation:
    'Moore SA, McKay HA, Macdonald H, Nettlefold L, Baxter-Jones ADG, Cameron N, Brasher PMA. Enhancing a somatic maturity prediction model. Med Sci Sports Exerc. 2015;47(8):1755-1764.',
  doi: '10.1249/MSS.0000000000000588',
  errata: [],
  verification: 'cross_checked_secondary_sources',
};

/** Development sample of Mirwald 2002: 8-16 yr (PubMed abstract, PMID 11932580). */
const MIRWALD_AGE_RANGE = { minYears: 8, maxYears: 16 } as const;
/** Development sample of Moore 2015 (PBMAS): 7.5-17.5 yr (PubMed abstract, PMID 25423445). */
const MOORE_AGE_RANGE = { minYears: 7.5, maxYears: 17.5 } as const;

/**
 * Published maturity offset models. See the package README for the
 * verification checklist of every coefficient.
 *
 * SEEs come from the PubMed abstracts (Mirwald: boys 0.49, girls 0.50; Moore:
 * boys 0.51, girls 0.52). The SEE of Moore's age × height alternative for boys
 * is not in the abstract and is left `null` until checked in the article.
 */
export const MATURITY_OFFSET_MODELS: readonly MaturityOffsetModel[] = [
  {
    equation: 'mirwald_2002',
    sex: 'male',
    interceptYears: -9.236,
    coefficients: {
      leg_length_x_sitting_height: 0.0002708,
      age_x_leg_length: -0.001663,
      age_x_sitting_height: 0.007216,
      weight_by_height_ratio: 0.02292,
    },
    seeYears: 0.49,
    developmentAgeRangeYears: MIRWALD_AGE_RANGE,
    provenance: {
      ...MIRWALD_2002,
      verificationNotes:
        'Coefficients agree across J Sports Sci Med 2022;21:640 Table 2, the sportkid explainer and CLAUDE.md. ' +
        'CRAN matuR prints 0.0002728 for the first term; the other sources give 0.0002708. ' +
        'Pending: compare with the original article.',
    },
  },
  {
    equation: 'mirwald_2002',
    sex: 'female',
    interceptYears: -9.376,
    coefficients: {
      leg_length_x_sitting_height: 0.0001882,
      age_x_leg_length: 0.0022,
      age_x_sitting_height: 0.005841,
      age_x_weight: -0.002658,
      weight_by_height_ratio: 0.07693,
    },
    seeYears: 0.5,
    developmentAgeRangeYears: MIRWALD_AGE_RANGE,
    provenance: {
      ...MIRWALD_2002,
      verificationNotes:
        'Coefficients agree across CRAN matuR (maturation_cm.R), the sportkid explainer and CLAUDE.md. ' +
        'Pending: compare with the original article.',
    },
  },
  {
    equation: 'moore_2015',
    sex: 'male',
    interceptYears: -8.128741,
    coefficients: { age_x_sitting_height: 0.0070346 },
    seeYears: 0.51,
    developmentAgeRangeYears: MOORE_AGE_RANGE,
    provenance: {
      ...MOORE_2015,
      verificationNotes:
        'Intercept -8.128741 and slope 0.0070346 agree across the AthleteMonitoring docs and the sportkid explainer. ' +
        'J Sports Sci Med 2022;21:640 Table 2 prints -8.125741 (typo); CLAUDE.md quoted it rounded to -8.1. ' +
        'Pending: compare with the original article.',
    },
  },
  {
    equation: 'moore_2015',
    sex: 'female',
    interceptYears: -7.709133,
    coefficients: { age_x_height: 0.0042232 },
    seeYears: 0.52,
    developmentAgeRangeYears: MOORE_AGE_RANGE,
    provenance: {
      ...MOORE_2015,
      verificationNotes:
        'Coefficients agree across the AthleteMonitoring docs, the sportkid explainer and CLAUDE.md. ' +
        'Pending: compare with the original article.',
    },
  },
  {
    equation: 'moore_2015_height',
    sex: 'male',
    interceptYears: -7.999994,
    coefficients: { age_x_height: 0.0036124 },
    seeYears: null,
    developmentAgeRangeYears: MOORE_AGE_RANGE,
    provenance: {
      ...MOORE_2015,
      verificationNotes:
        'Coefficients from J Sports Sci Med 2022;21:640 Table 2 ("Moore-2"); the abstract confirms the alternative exists. ' +
        'Pending: second source and comparison with the original article (and its SEE).',
    },
  },
];

/**
 * The model for an equation and sex. Throws for combinations that do not exist
 * (`moore_2015_height` is boys only).
 */
export function maturityOffsetModel(
  equation: MaturityOffsetEquation,
  sex: Sex,
  models: readonly MaturityOffsetModel[] = MATURITY_OFFSET_MODELS,
): MaturityOffsetModel {
  const model = models.find((m) => m.equation === equation && m.sex === sex);
  if (model === undefined) {
    throw new DomainValidationError(
      'invalid_argument',
      `There is no ${equation} maturity offset model for sex ${sex}.`,
      { equation, sex },
    );
  }
  return model;
}

/** Measurements taken on the same day. */
export interface MaturityOffsetInput {
  /** Decimal age on the measurement day (days / 365.25, see `decimalAgeYears`). */
  readonly ageYears: number;
  /** Standing height. */
  readonly heightCm: number;
  /** Sitting height (seat to vertex, bench height already subtracted). */
  readonly sittingHeightCm?: number | undefined;
  /** Body mass. */
  readonly weightKg?: number | undefined;
}

export const MATURITY_OFFSET_WARNINGS = ['age_outside_development_sample'] as const;
export type MaturityOffsetWarning = (typeof MATURITY_OFFSET_WARNINGS)[number];

export interface MaturityOffsetResult {
  readonly equation: MaturityOffsetEquation;
  readonly sex: Sex;
  /** Years from PHV (negative: before PHV). */
  readonly maturityOffsetYears: number;
  /** Predicted age at PHV: `ageYears − maturityOffsetYears`. */
  readonly ageAtPhvYears: number;
  readonly seeYears: number | null;
  readonly warnings: readonly MaturityOffsetWarning[];
}

const TERM_INPUTS: Readonly<
  Record<MaturityOffsetTerm, readonly ('sittingHeightCm' | 'weightKg')[]>
> = {
  leg_length_x_sitting_height: ['sittingHeightCm'],
  age_x_leg_length: ['sittingHeightCm'],
  age_x_sitting_height: ['sittingHeightCm'],
  age_x_weight: ['weightKg'],
  age_x_height: [],
  weight_by_height_ratio: ['weightKg'],
};

/** Optional measurements a model needs besides age and height. */
export function maturityOffsetRequiredInputs(
  model: MaturityOffsetModel,
): readonly ('sittingHeightCm' | 'weightKg')[] {
  const required = new Set<'sittingHeightCm' | 'weightKg'>();
  for (const term of usedTerms(model)) {
    for (const input of TERM_INPUTS[term]) required.add(input);
  }
  return [...required];
}

/** Evaluates a maturity offset model on one day's measurements. */
export function predictMaturityOffset(
  model: MaturityOffsetModel,
  input: MaturityOffsetInput,
): MaturityOffsetResult {
  const { ageYears, heightCm } = input;
  assertPositiveFinite(ageYears, 'ageYears');
  assertPositiveFinite(heightCm, 'heightCm');
  const required = maturityOffsetRequiredInputs(model);
  for (const name of required) assertPositiveFinite(input[name], name);

  const sittingHeightCm = input.sittingHeightCm;
  if (required.includes('sittingHeightCm') && sittingHeightCm !== undefined) {
    if (sittingHeightCm >= heightCm) {
      throw new DomainValidationError(
        'invalid_argument',
        `sittingHeightCm (${String(sittingHeightCm)}) must be less than heightCm (${String(heightCm)}).`,
        { sittingHeightCm, heightCm },
      );
    }
  }

  const terms = termValues(input);
  let maturityOffsetYears = model.interceptYears;
  for (const term of usedTerms(model)) {
    maturityOffsetYears += (model.coefficients[term] ?? 0) * terms[term]();
  }

  const { minYears, maxYears } = model.developmentAgeRangeYears;
  const warnings: MaturityOffsetWarning[] = [];
  if (ageYears < minYears || ageYears > maxYears) warnings.push('age_outside_development_sample');

  return {
    equation: model.equation,
    sex: model.sex,
    maturityOffsetYears,
    ageAtPhvYears: ageYears - maturityOffsetYears,
    seeYears: model.seeYears,
    warnings,
  };
}

/**
 * Maturity offset with a published equation (default
 * {@link DEFAULT_MATURITY_OFFSET_EQUATION}). Sex has no default.
 */
export function maturityOffset(
  input: MaturityOffsetInput & {
    readonly sex: Sex;
    readonly equation?: MaturityOffsetEquation | undefined;
  },
): MaturityOffsetResult {
  const equation = input.equation ?? DEFAULT_MATURITY_OFFSET_EQUATION;
  return predictMaturityOffset(maturityOffsetModel(equation, input.sex), input);
}

function usedTerms(model: MaturityOffsetModel): MaturityOffsetTerm[] {
  return MATURITY_OFFSET_TERMS.filter((term) => model.coefficients[term] !== undefined);
}

/** Lazily computed predictors (inputs a model does not use may be missing). */
function termValues(input: MaturityOffsetInput): Record<MaturityOffsetTerm, () => number> {
  const { ageYears, heightCm } = input;
  const sittingHeightCm = (): number => input.sittingHeightCm ?? Number.NaN;
  const weightKg = (): number => input.weightKg ?? Number.NaN;
  const legLengthCm = (): number => heightCm - sittingHeightCm();
  return {
    leg_length_x_sitting_height: () => legLengthCm() * sittingHeightCm(),
    age_x_leg_length: () => ageYears * legLengthCm(),
    age_x_sitting_height: () => ageYears * sittingHeightCm(),
    age_x_weight: () => ageYears * weightKg(),
    age_x_height: () => ageYears * heightCm,
    weight_by_height_ratio: () => (weightKg() / heightCm) * 100,
  };
}
