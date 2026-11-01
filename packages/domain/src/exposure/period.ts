import { DomainValidationError, describeValue } from '../errors.js';
import { isLocalDate, type LocalDate } from '../time.js';

/** Inclusive range of club days. Either end may be omitted (open range). */
export interface DatePeriod {
  readonly from?: LocalDate | undefined;
  readonly to?: LocalDate | undefined;
}

export function invalid(message: string, value: unknown): DomainValidationError {
  return new DomainValidationError('invalid_argument', message, value);
}

export function assertLocalDate(value: unknown, label: string): asserts value is LocalDate {
  if (!isLocalDate(value)) {
    throw invalid(`${label} must be a LocalDate (YYYY-MM-DD), got ${describeValue(value)}.`, value);
  }
}

/** Validates the period and returns a predicate for days inside it. */
export function periodFilter(period: DatePeriod | undefined): (date: LocalDate) => boolean {
  const from = period?.from;
  const to = period?.to;
  if (from !== undefined) assertLocalDate(from, 'period.from');
  if (to !== undefined) assertLocalDate(to, 'period.to');
  if (from !== undefined && to !== undefined && to < from) {
    throw invalid(`period.to (${to}) is before period.from (${from}).`, period);
  }
  // LocalDate is ISO 8601, so string comparison is chronological.
  return (date) => (from === undefined || date >= from) && (to === undefined || date <= to);
}
