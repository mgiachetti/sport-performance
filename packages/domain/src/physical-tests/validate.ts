import { DomainValidationError, describeValue } from '../errors.js';

/** Throws the module's single error shape: `invalid_argument`. */
export function invalidArgument(message: string, value: unknown): never {
  throw new DomainValidationError('invalid_argument', message, value);
}

function fail(name: string, expectation: string, value: unknown): never {
  invalidArgument(`${name} must be ${expectation}; got ${describeValue(value)}.`, value);
}

/** Finite number. */
export function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) fail(name, 'a finite number', value);
}

/** Finite number strictly greater than 0. */
export function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) fail(name, 'a finite number > 0', value);
}

/** Finite number greater than or equal to 0. */
export function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) fail(name, 'a finite number >= 0', value);
}

/** Safe integer greater than or equal to `min`. */
export function assertIntegerAtLeast(name: string, value: number, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    fail(name, `an integer >= ${String(min)}`, value);
  }
}
