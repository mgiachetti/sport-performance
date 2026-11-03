import {
  MEMBERSHIP_HEADER,
  SUPPORT_CLUB_HEADER,
  SUPPORT_REASON_HEADER,
  type HeaderMap,
} from '@sport-performance/contracts';
import { isUuid, type ClubId, type Uuid } from '@sport-performance/domain';
import { Store, readJson, writeJson, type KeyValueStorage } from '../lib/store';

/** Longest support reason the API accepts (ADR 0032: 1 to 500 characters). */
export const SUPPORT_REASON_MAX_LENGTH = 500;

/**
 * The club the user acts in (ADR 0007, ADR 0028, ADR 0032):
 *
 * - `membership`: one of the user's memberships, sent as `X-Membership-Id`.
 * - `support`: a superadmin supporting a club, sent as `X-Support-Club-Id`
 *   plus `X-Support-Reason` (registered by the API on every request).
 */
export type ClubSelection =
  | { readonly kind: 'membership'; readonly membershipId: Uuid }
  | { readonly kind: 'support'; readonly clubId: ClubId; readonly reason: string };

const MEMBERSHIP_KEY = 'sp.web.membership';
const SUPPORT_KEY = 'sp.web.support';

/** Normalizes a support reason; `null` when it is empty or too long for the API. */
export function normalizeSupportReason(reason: string): string | null {
  const trimmed = reason.trim();
  return trimmed.length >= 1 && trimmed.length <= SUPPORT_REASON_MAX_LENGTH ? trimmed : null;
}

/** `X-Support-Reason` travels percent-encoded (UTF-8), as the API expects. */
export function supportReasonHeader(reason: string): HeaderMap {
  return { [SUPPORT_REASON_HEADER]: encodeURIComponent(reason) };
}

function parseMembership(value: unknown): ClubSelection | null {
  if (typeof value !== 'object' || value === null) return null;
  const { membershipId } = value as Record<string, unknown>;
  return isUuid(membershipId) ? { kind: 'membership', membershipId } : null;
}

function parseSupport(value: unknown): ClubSelection | null {
  if (typeof value !== 'object' || value === null) return null;
  const { clubId, reason } = value as Record<string, unknown>;
  if (!isUuid(clubId) || typeof reason !== 'string') return null;
  const normalized = normalizeSupportReason(reason);
  return normalized === null
    ? null
    : { kind: 'support', clubId: clubId as ClubId, reason: normalized };
}

/**
 * Holds the club selection and turns it into request headers.
 *
 * The membership is remembered in `localStorage` (it is not a secret: the API
 * checks it against the session on every request). A support selection lives
 * only in `sessionStorage`, so it ends with the tab and the superadmin states
 * a reason again in a new one.
 */
export class ClubSelectionStore extends Store<ClubSelection | null> {
  readonly #local: KeyValueStorage | null;
  readonly #session: KeyValueStorage | null;

  constructor(storage: { local: KeyValueStorage | null; session: KeyValueStorage | null }) {
    super(
      parseSupport(readJson(storage.session, SUPPORT_KEY)) ??
        parseMembership(readJson(storage.local, MEMBERSHIP_KEY)),
    );
    this.#local = storage.local;
    this.#session = storage.session;
  }

  select(selection: ClubSelection | null): void {
    if (selection === null) {
      writeJson(this.#session, SUPPORT_KEY, null);
      writeJson(this.#local, MEMBERSHIP_KEY, null);
    } else if (selection.kind === 'membership') {
      writeJson(this.#session, SUPPORT_KEY, null);
      writeJson(this.#local, MEMBERSHIP_KEY, { membershipId: selection.membershipId });
    } else {
      writeJson(this.#session, SUPPORT_KEY, { clubId: selection.clubId, reason: selection.reason });
    }
    this.set(selection);
  }

  /** Ends support mode, keeping the remembered membership (if any) for next time. */
  clearSupport(): void {
    writeJson(this.#session, SUPPORT_KEY, null);
    this.set(parseMembership(readJson(this.#local, MEMBERSHIP_KEY)));
  }

  /** Headers that put a request in the selected club. */
  headers(): HeaderMap {
    const selection = this.get();
    if (selection === null) return {};
    if (selection.kind === 'membership') return { [MEMBERSHIP_HEADER]: selection.membershipId };
    return { [SUPPORT_CLUB_HEADER]: selection.clubId, ...supportReasonHeader(selection.reason) };
  }
}

/**
 * Stable part of the query keys of everything that depends on the club
 * (ADR 0057): data of one club never answers a query of another.
 */
export function selectionKey(selection: ClubSelection | null): string {
  if (selection === null) return 'none';
  return selection.kind === 'membership'
    ? `membership:${selection.membershipId}`
    : `support:${selection.clubId}`;
}
