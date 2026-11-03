import { SUPPORT_CLUB_HEADER, type HeaderMap } from '@sport-performance/contracts';
import type { ClubId } from '@sport-performance/domain';
import { normalizeSupportReason, supportReasonHeader } from '../api/club-selection';
import { Store, readJson, writeJson, type KeyValueStorage } from '../lib/store';

const CONSOLE_REASON_KEY = 'sp.web.console';

/**
 * The reason the superadmin stated for this console session (ADR 0029,
 * ADR 0066). Every request of the console carries it in `X-Support-Reason`
 * and the API records it. Like a support selection it lives only in
 * `sessionStorage`: it ends with the tab, and a new tab asks again.
 */
export class ConsoleReasonStore extends Store<string | null> {
  readonly #session: KeyValueStorage | null;

  constructor(session: KeyValueStorage | null) {
    const stored = readJson(session, CONSOLE_REASON_KEY);
    super(typeof stored === 'string' ? normalizeSupportReason(stored) : null);
    this.#session = session;
  }

  /** Sets the reason (normalized); `false` if it is empty or too long. */
  start(reason: string): boolean {
    const normalized = normalizeSupportReason(reason);
    if (normalized === null) return false;
    writeJson(this.#session, CONSOLE_REASON_KEY, normalized);
    this.set(normalized);
    return true;
  }

  clear(): void {
    writeJson(this.#session, CONSOLE_REASON_KEY, null);
    this.set(null);
  }
}

/** Headers of a request on the registry of clubs (no club in the context). */
export function registryHeaders(reason: string): HeaderMap {
  return supportReasonHeader(reason);
}

/** Headers of a request inside one club, as the superadmin supporting it. */
export function clubSupportHeaders(clubId: ClubId, reason: string): HeaderMap {
  return { [SUPPORT_CLUB_HEADER]: clubId, ...supportReasonHeader(reason) };
}
