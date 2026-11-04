import { memberGuard, memberParser } from './enum.js';
import { DomainValidationError } from './errors.js';

/**
 * Change history of results, sessions and measurements (B-305, ADR 0030).
 *
 * Every update or delete of a tracked row is recorded by the database (a
 * trigger, not the API) with the previous and the new value of each changed
 * column, the author, the time, the reason and the request id. The `medical`
 * schema keeps its own audit log (ADR 0008, #35) and is not tracked here.
 */

/**
 * Tables whose changes are recorded. Non-medical player data and the
 * sessions it hangs from. Configuration and catalogs are not tracked.
 */
export const CHANGE_TRACKED_TABLES = [
  'test_session',
  'test_result',
  'test_result_value',
  'anthro_measurement',
  'training_session',
  'participation',
  'wellness',
  'external_metric',
  'gym_set',
  'external_load',
] as const;
export type ChangeTrackedTable = (typeof CHANGE_TRACKED_TABLES)[number];

export const isChangeTrackedTable = memberGuard(CHANGE_TRACKED_TABLES);
export const parseChangeTrackedTable = memberParser(
  CHANGE_TRACKED_TABLES,
  'invalid_argument',
  'change-tracked table',
);

/**
 * What happened to the row. Inserts are not recorded: the row itself keeps
 * its author and time (`created_*`), and a correction of an append-only
 * value (`test_result_value`) is a void (an `update`) plus a new row.
 */
export const CHANGE_OPERATIONS = ['update', 'delete'] as const;
export type ChangeOperation = (typeof CHANGE_OPERATIONS)[number];

export const isChangeOperation = memberGuard(CHANGE_OPERATIONS);
export const parseChangeOperation = memberParser(
  CHANGE_OPERATIONS,
  'invalid_argument',
  'change operation',
);

/**
 * Who made the change, by database connection role (ADR 0026): the API on
 * behalf of a user (`app`), the worker (`worker`, derived values and
 * imports) or an operator or a referential action as the owner (`system`).
 */
export const CHANGE_SOURCES = ['app', 'worker', 'system'] as const;
export type ChangeSource = (typeof CHANGE_SOURCES)[number];

export const isChangeSource = memberGuard(CHANGE_SOURCES);
export const parseChangeSource = memberParser(CHANGE_SOURCES, 'invalid_argument', 'change source');

/** Longest reason accepted, in characters after trimming. */
export const CHANGE_REASON_MAX_LENGTH = 500;

/** Characters as Postgres' `char_length` counts them (code points, not UTF-16 units). */
function codePointCount(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // A high surrogate followed by a low one is a single code point.
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}

/**
 * Normalizes the reason of a correction: trimmed, 1 to
 * {@link CHANGE_REASON_MAX_LENGTH} characters. Throws a
 * {@link DomainValidationError} otherwise. The database applies the same rule.
 */
export function parseChangeReason(value: unknown): string {
  if (typeof value === 'string') {
    const reason = value.trim();
    if (reason.length >= 1 && codePointCount(reason) <= CHANGE_REASON_MAX_LENGTH) return reason;
  }
  throw new DomainValidationError(
    'invalid_argument',
    `Invalid change reason: expected 1 to ${String(CHANGE_REASON_MAX_LENGTH)} characters after trimming.`,
    value,
  );
}
