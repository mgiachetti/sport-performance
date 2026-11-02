import { memberGuard } from './enum.js';
import type { MembershipRole } from './roles.js';
import { compareLocalDates, type LocalDate } from './time.js';

/**
 * Staff assignments (B-314): which categories, or which whole sport, a
 * staff member sees. They are what the permission matrix scopes `coach`,
 * `sc` and `medical` by (`assigned`, ADR 0025).
 *
 * Validity is a range of club days `[validFrom, validTo)`: `validTo` is
 * exclusive and `null` means open-ended. Ending an assignment sets `validTo`
 * to the club's day (it stops counting that same day); one that had not
 * started yet ends with an empty range (`validTo = validFrom`): cancelled,
 * never in force, and its row stays as the record (ADR 0034).
 */

/** Membership roles that hold staff assignments. */
export const STAFF_ASSIGNMENT_ROLES = [
  'coach',
  'sc',
  'medical',
] as const satisfies readonly MembershipRole[];
export type StaffAssignmentRole = (typeof STAFF_ASSIGNMENT_ROLES)[number];
export const isStaffAssignmentRole = memberGuard(STAFF_ASSIGNMENT_ROLES);

/**
 * Where an assignment stands on a day: `upcoming` (starts later), `current`
 * (in force) or `ended` (its range is over, or was cancelled before it started).
 */
export const STAFF_ASSIGNMENT_STATUSES = ['upcoming', 'current', 'ended'] as const;
export type StaffAssignmentStatus = (typeof STAFF_ASSIGNMENT_STATUSES)[number];

export interface AssignmentValidity {
  readonly validFrom: LocalDate;
  readonly validTo: LocalDate | null;
}

/** Whether the range is empty (`validTo = validFrom`): cancelled before it started. */
export function isEmptyValidity(window: AssignmentValidity): boolean {
  return window.validTo !== null && compareLocalDates(window.validTo, window.validFrom) <= 0;
}

/** Status of an assignment on the club's day `today`. */
export function staffAssignmentStatus(
  window: AssignmentValidity,
  today: LocalDate,
): StaffAssignmentStatus {
  if (isEmptyValidity(window)) return 'ended';
  if (window.validTo !== null && compareLocalDates(window.validTo, today) <= 0) return 'ended';
  if (compareLocalDates(window.validFrom, today) > 0) return 'upcoming';
  return 'current';
}

/**
 * `validTo` of an assignment ended on `today`: today, or its start if it had
 * not started (an empty range). `null` when it is already over by then: it
 * stays as it is (ending is idempotent).
 */
export function endedValidTo(window: AssignmentValidity, today: LocalDate): LocalDate | null {
  const end = compareLocalDates(window.validFrom, today) > 0 ? window.validFrom : today;
  if (window.validTo !== null && compareLocalDates(window.validTo, end) <= 0) return null;
  return end;
}

/** Whether two ranges share at least one day. Empty ranges overlap nothing. */
export function validitiesOverlap(a: AssignmentValidity, b: AssignmentValidity): boolean {
  if (isEmptyValidity(a) || isEmptyValidity(b)) return false;
  const aEndsAfterBStarts = a.validTo === null || compareLocalDates(a.validTo, b.validFrom) > 0;
  const bEndsAfterAStarts = b.validTo === null || compareLocalDates(b.validTo, a.validFrom) > 0;
  return aEndsAfterBStarts && bEndsAfterAStarts;
}
