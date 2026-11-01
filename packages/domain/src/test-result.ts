import { memberGuard, memberParser } from './enum.js';

/**
 * Status of a player's result in a test (B-301, B-320). A test that was not
 * done is recorded too, with its reason, so the battery shows why a value is
 * missing instead of a silent gap.
 */
export const TEST_RESULT_STATUSES = ['done', 'not_done'] as const;
export type TestResultStatus = (typeof TEST_RESULT_STATUSES)[number];

export const isTestResultStatus = memberGuard(TEST_RESULT_STATUSES);
export const parseTestResultStatus = memberParser(
  TEST_RESULT_STATUSES,
  'invalid_argument',
  'test result status',
);

/**
 * Why a test was not done (B-320). `injured` never carries the diagnosis:
 * that lives in the `medical` schema (ADR 0008). `not_applicable_to_stage`
 * covers tests the player's stage does not do (principle 3, for example
 * maximal loads in M13/M14). `other` requires a free-text note.
 */
export const TEST_NOT_DONE_REASONS = [
  'absent',
  'injured',
  'not_applicable_to_stage',
  'other',
] as const;
export type TestNotDoneReason = (typeof TEST_NOT_DONE_REASONS)[number];

export const isTestNotDoneReason = memberGuard(TEST_NOT_DONE_REASONS);
export const parseTestNotDoneReason = memberParser(
  TEST_NOT_DONE_REASONS,
  'invalid_argument',
  'test not-done reason',
);
