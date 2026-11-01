import { DomainValidationError, describeValue } from '../errors.js';

/** Throws unless `value` is a finite number greater than zero. */
export function assertPositiveFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new DomainValidationError(
      'invalid_argument',
      `${name} must be a finite number greater than 0, got ${describeValue(value)}.`,
      value,
    );
  }
}

/** Throws unless `value` is a finite number. */
export function assertFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DomainValidationError(
      'invalid_argument',
      `${name} must be a finite number, got ${describeValue(value)}.`,
      value,
    );
  }
}

/** Throws unless `value` is a finite number greater than or equal to zero. */
export function assertNonNegativeFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new DomainValidationError(
      'invalid_argument',
      `${name} must be a finite number greater than or equal to 0, got ${describeValue(value)}.`,
      value,
    );
  }
}
