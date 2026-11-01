import { DomainValidationError, describeValue } from '../errors.js';

/** Throws `invalid_argument` unless `value` is a finite number in `[min, max]`. */
export function assertFiniteInRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new DomainValidationError(
      'invalid_argument',
      `${name} must be a finite number in [${String(min)}, ${String(max)}], got ${describeValue(value)}.`,
      value,
    );
  }
}

/** Throws `invalid_argument` unless `value` is an integer in `[min, max]`. */
export function assertIntegerInRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new DomainValidationError(
      'invalid_argument',
      `${name} must be an integer in [${String(min)}, ${String(max)}], got ${describeValue(value)}.`,
      value,
    );
  }
}

/** Throws `invalid_argument` unless `value` is a finite, non-negative load. */
export function assertLoadAu(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new DomainValidationError(
      'invalid_argument',
      `${name} must be a finite load >= 0 AU, got ${describeValue(value)}.`,
      value,
    );
  }
}
