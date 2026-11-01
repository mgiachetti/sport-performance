/** Stable machine-readable codes for domain validation failures. */
export type DomainErrorCode =
  | 'invalid_sport'
  | 'invalid_sex'
  | 'invalid_role'
  | 'invalid_stage'
  | 'invalid_metric_code'
  | 'invalid_test_code'
  | 'invalid_unit'
  | 'invalid_measurement_method'
  | 'invalid_wellness_item'
  | 'invalid_time_zone'
  | 'invalid_local_date'
  | 'invalid_instant'
  | 'invalid_uuid'
  | 'invalid_argument';

/**
 * Thrown by every `parseX` function of the domain when the input does not
 * satisfy the type. `code` is stable and safe to branch on; `message` is for
 * developers (UI texts live in `packages/i18n`).
 */
export class DomainValidationError extends Error {
  override readonly name = 'DomainValidationError';
  readonly code: DomainErrorCode;
  readonly value: unknown;

  constructor(code: DomainErrorCode, message: string, value: unknown) {
    super(message);
    this.code = code;
    this.value = value;
  }
}

/** Short, safe rendering of an arbitrary input for error messages. */
export function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  if (value instanceof Date) return `Date(${String(value.getTime())})`;
  return typeof value;
}
