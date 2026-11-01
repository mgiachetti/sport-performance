import { sql, type SQL } from 'drizzle-orm';
import { check, type AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Reusable `CHECK` constraints. They encode hard invariants only (a value
 * that can never be right); soft warnings such as plausible ranges stay in
 * the domain (`plausibility/`), because an implausible value is still a
 * result the staff may confirm.
 */

/**
 * Metric, test and other codes: English `snake_case`, at most 64 characters,
 * never containing "playerload" (same rule as `isWellFormedCode` in the domain).
 */
export function codeCheck(name: string, column: AnyPgColumn) {
  return check(
    name,
    sql`${column} ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' and char_length(${column}) <= 64 and strpos(replace(${column}, '_', ''), 'playerload') = 0`,
  );
}

/** A `double precision` value that is a real number (no `NaN` or infinities). */
export function finite(column: AnyPgColumn): SQL {
  return sql`${column} not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)`;
}

/** A half-open validity range `[valid_from, valid_to)`; `NULL` `valid_to` is open ended. */
export function validityCheck(name: string, validFrom: AnyPgColumn, validTo: AnyPgColumn) {
  return check(name, sql`${validTo} is null or ${validTo} > ${validFrom}`);
}

/** A nullable integer score within `[min, max]`. */
export function rangeCheck(name: string, column: AnyPgColumn, min: number, max: number) {
  return check(
    name,
    sql`${column} is null or ${column} between ${sql.raw(String(min))} and ${sql.raw(String(max))}`,
  );
}
