import { DomainValidationError, describeValue } from '../errors.js';
import { memberGuard, memberParser } from '../enum.js';
import type { Sex } from '../sex.js';
import {
  addDays,
  compareLocalDates,
  daysBetween,
  decimalAgeYears,
  localDate,
  localDateParts,
  type LocalDate,
} from '../time.js';
import type { CoefficientProvenance } from './provenance.js';

/**
 * Menarche (B-805, ADR 0087): an optional record of a girl's first menstrual
 * period. It is health data: it lives in the `medical` schema, only the
 * player, the guardian of a minor and the assigned medical staff write or
 * read it, all of them with a current health consent, and the rest of the
 * staff never sees it, nor anything derived from it. The product does not
 * diagnose (principle 7): the record is what the player or her family says.
 *
 * Its use here is to validate the somatic maturity offset of a girl
 * (Mirwald 2002, Moore 2015), whose error grows away from the average
 * maturer: menarche is the classic maturity indicator of girls and follows
 * peak height velocity by a fairly stable interval, so it bounds the offset.
 */

/** Only girls have the record (the API and a database trigger refuse the rest). */
export function menarcheApplies(sex: Sex): boolean {
  return sex === 'female';
}

/**
 * - `not_yet`: no menarche on the day of the report (the report day is the
 *   "as of" date: later on it may have happened).
 * - `occurred`: menarche happened, on `occurredOn` with a `precision`.
 *
 * `packages/db` builds `medical.menarche_status` from this constant.
 */
export const MENARCHE_STATUSES = ['not_yet', 'occurred'] as const;
export type MenarcheStatus = (typeof MENARCHE_STATUSES)[number];
export const isMenarcheStatus = memberGuard(MENARCHE_STATUSES);
export const parseMenarcheStatus = memberParser(
  MENARCHE_STATUSES,
  'invalid_argument',
  'menarche status',
);

/**
 * How precisely the date is known. Most girls remember the month, some only
 * the year (retrospective recall). `occurredOn` is stored truncated to the
 * precision (first day of the month or of the year) and the calculations use
 * the middle of the period, with half of it as uncertainty.
 */
export const MENARCHE_DATE_PRECISIONS = ['day', 'month', 'year'] as const;
export type MenarcheDatePrecision = (typeof MENARCHE_DATE_PRECISIONS)[number];
export const isMenarcheDatePrecision = memberGuard(MENARCHE_DATE_PRECISIONS);
export const parseMenarcheDatePrecision = memberParser(
  MENARCHE_DATE_PRECISIONS,
  'invalid_argument',
  'menarche date precision',
);

/** Who told it: the player herself, her guardian or the medical staff. */
export const MENARCHE_REPORTERS = ['player', 'parent', 'medical'] as const;
export type MenarcheReporter = (typeof MENARCHE_REPORTERS)[number];
export const isMenarcheReporter = memberGuard(MENARCHE_REPORTERS);

/** The first day of the period `date` falls in, at `precision`. */
export function truncateMenarcheDate(date: LocalDate, precision: MenarcheDatePrecision): LocalDate {
  const { year, month } = localDateParts(date);
  if (precision === 'year') return localDate(year, 1, 1);
  if (precision === 'month') return localDate(year, month, 1);
  return date;
}

/** Whether `date` is the first day of its period at `precision` (how it is stored). */
export function isTruncatedMenarcheDate(
  date: LocalDate,
  precision: MenarcheDatePrecision,
): boolean {
  return truncateMenarcheDate(date, precision) === date;
}

/** The period a stored date stands for: `[start, end]`, both inclusive. */
export function menarchePeriod(
  occurredOn: LocalDate,
  precision: MenarcheDatePrecision,
): { readonly start: LocalDate; readonly end: LocalDate } {
  const start = truncateMenarcheDate(occurredOn, precision);
  const { year, month } = localDateParts(start);
  if (precision === 'day') return { start, end: start };
  if (precision === 'year') return { start, end: localDate(year, 12, 31) };
  const nextMonth = month === 12 ? localDate(year + 1, 1, 1) : localDate(year, month + 1, 1);
  return { start, end: addDays(nextMonth, -1) };
}

/**
 * Decimal age at menarche (years, as `decimalAgeYears`: days / 365.25) at
 * the middle of the period, and the half-width of the period in years (the
 * uncertainty the precision adds).
 */
export function ageAtMenarcheYears(
  birthDate: LocalDate,
  occurredOn: LocalDate,
  precision: MenarcheDatePrecision,
): { readonly ageYears: number; readonly uncertaintyYears: number } {
  const { start, end } = menarchePeriod(occurredOn, precision);
  const startAge = decimalAgeYears(birthDate, start);
  const endAge = decimalAgeYears(birthDate, end);
  return { ageYears: (startAge + endAge) / 2, uncertaintyYears: (endAge - startAge) / 2 };
}

/**
 * Reference of menarche against peak height velocity, and the plausible ages
 * at menarche. Data, configurable per club (`club.settings.derived.maturation.menarche`),
 * with the defaults below ({@link DEFAULT_MENARCHE_REFERENCE}).
 */
export interface MenarcheReference {
  /** Mean interval from PHV to menarche, in years. */
  readonly phvToMenarcheMeanYears: number;
  /**
   * Shortest and longest plausible interval from PHV to menarche, in years.
   * The offset implied by a menarche is bounded by them: a girl past
   * menarche is at least `min` years past PHV at menarche, a girl without
   * it at most `max`.
   */
  readonly phvToMenarcheMinYears: number;
  readonly phvToMenarcheMaxYears: number;
  /**
   * Margin on top of the bounds before the offset is called inconsistent,
   * in years: it absorbs the error of the equations (SEE ≈ 0.5 years).
   */
  readonly marginYears: number;
  /** Ages at menarche accepted as input (years); outside them the report is refused as a likely typo. */
  readonly plausibleAgeMinYears: number;
  readonly plausibleAgeMaxYears: number;
}

/**
 * Defaults. **Verify against the sources before production** (same rule as
 * the maturation coefficients, CLAUDE.md):
 *
 * - Mean interval PHV → menarche ≈ 1.3 years, and menarche after PHV in
 *   practically every girl: Malina, Bouchard & Bar-Or 2004 (chapter on
 *   maturity indicators; "menarche occurs, on average, 1.2 to 1.5 years
 *   after PHV") and the longitudinal data of Marshall & Tanner 1969.
 * - Bounds 0 and 3 years: wide on purpose (the reported spread of the
 *   interval is about ±1 year around the mean), so the check only flags
 *   offsets that are clearly incompatible with the menarche.
 * - Plausible ages 8–18: menarche before 8 is precocious puberty and after
 *   15–16 primary amenorrhoea, both clinical matters; the range only
 *   catches typos (a wrong year), so it is wider than either.
 */
export const DEFAULT_MENARCHE_REFERENCE: MenarcheReference = Object.freeze({
  phvToMenarcheMeanYears: 1.3,
  phvToMenarcheMinYears: 0,
  phvToMenarcheMaxYears: 3,
  marginYears: 0.5,
  plausibleAgeMinYears: 8,
  plausibleAgeMaxYears: 18,
});

/** Where {@link DEFAULT_MENARCHE_REFERENCE} comes from and how it was checked. */
export const MENARCHE_REFERENCE_PROVENANCE: CoefficientProvenance = Object.freeze({
  citation:
    'Malina RM, Bouchard C, Bar-Or O. Growth, Maturation, and Physical Activity. 2nd ed. Champaign, IL: Human Kinetics; 2004. ' +
    'Marshall WA, Tanner JM. Variations in pattern of pubertal changes in girls. Arch Dis Child. 1969;44(235):291-303.',
  doi: '10.1136/adc.44.235.291',
  errata: [],
  verification: 'unverified',
  verificationNotes:
    'Mean interval PHV → menarche (≈ 1.3 years, 1.2–1.5 in the textbook) as quoted by secondary sources on youth maturity assessment. ' +
    'Pending: check the mean and the spread of the interval in both sources; the bounds 0 and 3 years and the plausible ages 8–18 are deliberately wide product choices.',
});

/** Validates a menarche reference (club configuration). Throws `invalid_argument`. */
export function parseMenarcheReference(value: MenarcheReference): MenarcheReference {
  const names = [
    'phvToMenarcheMeanYears',
    'phvToMenarcheMinYears',
    'phvToMenarcheMaxYears',
    'marginYears',
    'plausibleAgeMinYears',
    'plausibleAgeMaxYears',
  ] as const;
  for (const name of names) {
    const v = value[name] as unknown;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      invalid(`menarche.${name} must be a finite number, got ${describeValue(v)}.`, value);
    }
  }
  const r = value;
  if (r.phvToMenarcheMinYears < -2 || r.phvToMenarcheMaxYears > 6) {
    invalid('The PHV → menarche interval must lie within −2 and 6 years.', value);
  }
  if (
    !(r.phvToMenarcheMinYears <= r.phvToMenarcheMeanYears) ||
    !(r.phvToMenarcheMeanYears <= r.phvToMenarcheMaxYears)
  ) {
    invalid('The PHV → menarche interval needs min ≤ mean ≤ max.', value);
  }
  if (r.marginYears < 0 || r.marginYears > 3) {
    invalid(`menarche.marginYears must be from 0 to 3, got ${String(r.marginYears)}.`, value);
  }
  if (
    r.plausibleAgeMinYears < 5 ||
    r.plausibleAgeMaxYears > 25 ||
    r.plausibleAgeMinYears >= r.plausibleAgeMaxYears
  ) {
    invalid('The plausible ages at menarche need 5 ≤ min < max ≤ 25.', value);
  }
  return Object.freeze({ ...value });
}

function invalid(message: string, value: unknown): never {
  throw new DomainValidationError('invalid_argument', message, value);
}

/** A menarche report as stored. */
export interface MenarcheReportFacts {
  readonly status: MenarcheStatus;
  /** With `occurred` only; truncated to `precision`. */
  readonly occurredOn: LocalDate | null;
  readonly precision: MenarcheDatePrecision | null;
  /** Club day of the report: the "as of" date of `not_yet`. */
  readonly reportedOn: LocalDate;
}

/** What is wrong with a report (the API turns each into a validation detail). */
export const MENARCHE_REPORT_PROBLEMS = [
  /** `occurred` without a date. */
  'date_required',
  /** `occurred` without a precision. */
  'precision_required',
  /** A date or a precision with `not_yet`. */
  'date_without_menarche',
  /** After the day of the report. */
  'date_after_report',
  /** Before the birth date. */
  'date_before_birth',
  /** Age at menarche outside the plausible range of the reference (likely a typo). */
  'age_implausible',
  /** `not_yet` reported by a player older than the plausible maximum age (likely a mistake). */
  'not_yet_implausible',
] as const;
export type MenarcheReportProblem = (typeof MENARCHE_REPORT_PROBLEMS)[number];

export interface MenarcheReportIssue {
  readonly path: readonly string[];
  readonly problem: MenarcheReportProblem;
}

/**
 * Problems of a report about a girl born on `birthDate`, every one (not only
 * the first). `occurredOn` is expected already truncated to the precision.
 */
export function menarcheReportIssues(
  report: MenarcheReportFacts,
  birthDate: LocalDate,
  reference: MenarcheReference = DEFAULT_MENARCHE_REFERENCE,
): MenarcheReportIssue[] {
  const issues: MenarcheReportIssue[] = [];
  if (report.status === 'not_yet') {
    if (report.occurredOn !== null)
      issues.push({ path: ['occurredOn'], problem: 'date_without_menarche' });
    if (report.precision !== null)
      issues.push({ path: ['precision'], problem: 'date_without_menarche' });
    if (
      daysBetween(birthDate, report.reportedOn) > 0 &&
      decimalAgeYears(birthDate, report.reportedOn) > reference.plausibleAgeMaxYears
    ) {
      issues.push({ path: ['status'], problem: 'not_yet_implausible' });
    }
    return issues;
  }
  if (report.occurredOn === null) issues.push({ path: ['occurredOn'], problem: 'date_required' });
  if (report.precision === null)
    issues.push({ path: ['precision'], problem: 'precision_required' });
  if (report.occurredOn === null || report.precision === null) return issues;
  const { start } = menarchePeriod(report.occurredOn, report.precision);
  if (compareLocalDates(start, report.reportedOn) > 0) {
    issues.push({ path: ['occurredOn'], problem: 'date_after_report' });
    return issues;
  }
  if (daysBetween(birthDate, start) <= 0) {
    issues.push({ path: ['occurredOn'], problem: 'date_before_birth' });
    return issues;
  }
  const { ageYears } = ageAtMenarcheYears(birthDate, report.occurredOn, report.precision);
  if (ageYears < reference.plausibleAgeMinYears || ageYears > reference.plausibleAgeMaxYears) {
    issues.push({ path: ['occurredOn'], problem: 'age_implausible' });
  }
  return issues;
}

/** Signed years from `from` to `to` (days / 365.25, as `decimalAgeYears`). */
function signedYears(from: LocalDate, to: LocalDate): number {
  return daysBetween(from, to) / 365.25;
}

/**
 * - `consistent`: the somatic offset is within the bounds the menarche implies.
 * - `offset_below_reference`: the equation says less mature than the
 *   menarche allows (typical of early maturers: the equations pull the
 *   prediction toward the mean age at PHV).
 * - `offset_above_reference`: the equation says more mature than the
 *   menarche allows (typical of late maturers).
 */
export const MENARCHE_OFFSET_VERDICTS = [
  'consistent',
  'offset_below_reference',
  'offset_above_reference',
] as const;
export type MenarcheOffsetVerdict = (typeof MENARCHE_OFFSET_VERDICTS)[number];

export interface MenarcheOffsetCheckInput {
  readonly birthDate: LocalDate;
  readonly report: MenarcheReportFacts;
  /** Day of the anthropometry the offset was computed on. */
  readonly measuredOn: LocalDate;
  /** Somatic maturity offset of that day (years from PHV). */
  readonly phvOffsetYears: number;
}

export interface MenarcheOffsetCheck {
  /** Age at menarche (middle of the period), with `occurred`. */
  readonly ageAtMenarcheYears: number | null;
  /**
   * Offset implied by the menarche on the measurement day, with the mean
   * interval (`occurred` only): `years since menarche + mean interval`.
   */
  readonly impliedPhvOffsetYears: number | null;
  /** Bounds of the offset the menarche implies on the measurement day (`null`: unbounded). */
  readonly impliedMinPhvOffsetYears: number | null;
  readonly impliedMaxPhvOffsetYears: number | null;
  readonly verdict: MenarcheOffsetVerdict;
}

/**
 * The somatic offset of a measurement against the menarche report. With the
 * age at menarche known, the offset on day M is `(age_M − age_menarche) +
 * interval`, so the interval bounds give `[y + min, y + max]` widened by the
 * precision of the date (`y`: signed years from menarche to M; negative when
 * M is before it). Without menarche on the report day R, `age_menarche >
 * age_R`, so the offset on M is below `(M − R) + max`; there is no lower
 * bound. Only the bounds plus {@link MenarcheReference.marginYears} make it
 * inconsistent.
 */
export function checkOffsetAgainstMenarche(
  input: MenarcheOffsetCheckInput,
  reference: MenarcheReference = DEFAULT_MENARCHE_REFERENCE,
): MenarcheOffsetCheck {
  const { birthDate, report, measuredOn, phvOffsetYears } = input;
  if (!Number.isFinite(phvOffsetYears)) {
    invalid(`phvOffsetYears must be finite, got ${describeValue(phvOffsetYears)}.`, phvOffsetYears);
  }
  let ageAtMenarche: number | null = null;
  let implied: number | null = null;
  let min: number | null = null;
  let max: number | null;
  if (report.status === 'occurred') {
    if (report.occurredOn === null || report.precision === null) {
      invalid('An occurred menarche needs its date and precision.', report);
    }
    const { ageYears, uncertaintyYears } = ageAtMenarcheYears(
      birthDate,
      report.occurredOn,
      report.precision,
    );
    ageAtMenarche = ageYears;
    const y = decimalAgeYears(birthDate, measuredOn) - ageYears;
    implied = y + reference.phvToMenarcheMeanYears;
    min = y + reference.phvToMenarcheMinYears - uncertaintyYears;
    max = y + reference.phvToMenarcheMaxYears + uncertaintyYears;
  } else {
    max = signedYears(report.reportedOn, measuredOn) + reference.phvToMenarcheMaxYears;
  }
  let verdict: MenarcheOffsetVerdict = 'consistent';
  if (min !== null && phvOffsetYears < min - reference.marginYears) {
    verdict = 'offset_below_reference';
  } else if (phvOffsetYears > max + reference.marginYears) {
    verdict = 'offset_above_reference';
  }
  return {
    ageAtMenarcheYears: ageAtMenarche,
    impliedPhvOffsetYears: implied,
    impliedMinPhvOffsetYears: min,
    impliedMaxPhvOffsetYears: max,
    verdict,
  };
}
