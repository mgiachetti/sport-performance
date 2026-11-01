import { DomainValidationError, describeValue, type DomainErrorCode } from './errors.js';

/** Builds a type guard for a closed set of string literals. */
export function memberGuard<const T extends string>(
  values: readonly T[],
): (value: unknown) => value is T {
  const set: ReadonlySet<string> = new Set(values);
  return (value: unknown): value is T => typeof value === 'string' && set.has(value);
}

/** Builds a parser that throws a {@link DomainValidationError} for non-members. */
export function memberParser<const T extends string>(
  values: readonly T[],
  code: DomainErrorCode,
  label: string,
): (value: unknown) => T {
  const isMember = memberGuard(values);
  return (value: unknown): T => {
    if (isMember(value)) return value;
    throw new DomainValidationError(
      code,
      `Invalid ${label}: ${describeValue(value)}. Expected one of: ${values.join(', ')}.`,
      value,
    );
  };
}
