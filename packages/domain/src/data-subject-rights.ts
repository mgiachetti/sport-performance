import { memberGuard, memberParser } from './enum.js';
import type { UserId } from './ids.js';
import { addDays, isoWeekday, type LocalDate } from './time.js';

/**
 * Rights of the data subject (Ley 25.326, arts. 14 to 16; B-329): access to
 * every datum of a player (export) and its erasure, plus the deletion of a
 * user account (Apple App Store Review Guideline 5.1.1(v)). The club is the
 * controller of the database: the holder (the player once of age, the
 * guardian of a minor) asks, and the club's administration erases.
 */

/**
 * Kinds of a request of the data subject. `access`: an export, recorded as
 * completed when it is delivered. `erasure`: the erasure of a player, which
 * the administration executes or rejects. `packages/db` builds the
 * `data_subject_request_kind` enum from this constant.
 */
export const DATA_SUBJECT_REQUEST_KINDS = ['access', 'erasure'] as const;
export type DataSubjectRequestKind = (typeof DATA_SUBJECT_REQUEST_KINDS)[number];

export const isDataSubjectRequestKind = memberGuard(DATA_SUBJECT_REQUEST_KINDS);
export const parseDataSubjectRequestKind = memberParser(
  DATA_SUBJECT_REQUEST_KINDS,
  'invalid_argument',
  'data subject request kind',
);

/**
 * Status of a request: `pending` (an erasure waiting for the administration),
 * `completed` (export delivered, player erased), `rejected` (with a reason,
 * e.g. a legal obligation to keep the data) or `cancelled` (by whoever asked,
 * or the administration).
 */
export const DATA_SUBJECT_REQUEST_STATUSES = [
  'pending',
  'completed',
  'rejected',
  'cancelled',
] as const;
export type DataSubjectRequestStatus = (typeof DATA_SUBJECT_REQUEST_STATUSES)[number];

export const isDataSubjectRequestStatus = memberGuard(DATA_SUBJECT_REQUEST_STATUSES);
export const parseDataSubjectRequestStatus = memberParser(
  DATA_SUBJECT_REQUEST_STATUSES,
  'invalid_argument',
  'data subject request status',
);

/** Longest note of a request, and reason of a rejection or a cancellation. */
export const DATA_SUBJECT_REQUEST_NOTE_MAX_LENGTH = 1000;

/**
 * Business days the controller has to erase (Ley 25.326, art. 16.2: five
 * business days from the request).
 */
export const ERASURE_RESPONSE_BUSINESS_DAYS = 5;

/**
 * The day `businessDays` business days after `from`, counting Monday to
 * Friday only. National holidays are not known to the domain: the due day is
 * a lower bound the administration may see a day or two early.
 */
export function addBusinessDays(from: LocalDate, businessDays: number): LocalDate {
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new RangeError(
      `businessDays must be a non-negative integer, got ${String(businessDays)}`,
    );
  }
  let day = from;
  let left = businessDays;
  while (left > 0) {
    day = addDays(day, 1);
    if (isoWeekday(day) <= 5) left -= 1;
  }
  return day;
}

/** Due day of an erasure requested on the club's day `requestedOn`. */
export function erasureDueOn(requestedOn: LocalDate): LocalDate {
  return addBusinessDays(requestedOn, ERASURE_RESPONSE_BUSINESS_DAYS);
}

/**
 * Domain of the accounts that were deleted but had to stay as a row, because
 * other rows keep them as legal evidence (a signed consent, a medical
 * clearance): the row keeps only its id, with this reserved `.invalid`
 * address (RFC 2606), so no email can be delivered and no sign-in code is
 * ever sent (`isUndeliverableEmail`).
 */
export const DELETED_ACCOUNT_DOMAIN = 'deleted.invalid';

/** The address of an anonymized (deleted) account. */
export function deletedAccountAddress(userId: UserId): string {
  return `deleted.${userId}@${DELETED_ACCOUNT_DOMAIN}`;
}

/**
 * How old a session may be to delete its account: the user signed in again
 * (a new sign-in code) a moment ago, so a forgotten unlocked phone is not
 * enough to delete an account.
 */
export const ACCOUNT_DELETION_FRESH_SESSION_S = 10 * 60;

/** Outcome of an account deletion: the row is gone, or it stays anonymized as evidence. */
export const ACCOUNT_DELETION_OUTCOMES = ['deleted', 'anonymized'] as const;
export type AccountDeletionOutcome = (typeof ACCOUNT_DELETION_OUTCOMES)[number];

/** Version of the export format: bumped when a reader would have to change. */
export const PLAYER_DATA_EXPORT_FORMAT = 'sport-performance.player-data' as const;
export const PLAYER_DATA_EXPORT_FORMAT_VERSION = 1 as const;
