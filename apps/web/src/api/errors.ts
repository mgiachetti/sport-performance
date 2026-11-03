import {
  ApiContractError,
  ApiError,
  ApiNetworkError,
  ERROR_CODES,
  type ErrorCode,
} from '@sport-performance/contracts';
import type { MessageKey } from '@sport-performance/i18n';

/** Message shown for each error code of the API (`ERROR_STATUS` of the contracts). */
export const ERROR_MESSAGE_KEYS = {
  bad_request: 'error.code.bad_request',
  validation_failed: 'error.code.validation_failed',
  unauthenticated: 'error.sessionExpired',
  forbidden: 'error.forbidden',
  consent_required: 'error.code.consent_required',
  reauthentication_required: 'error.code.reauthentication_required',
  not_found: 'error.notFound',
  conflict: 'error.code.conflict',
  payload_too_large: 'error.code.payload_too_large',
  // The web does not send client versions; a 426 means this tab is stale.
  app_update_required: 'error.contract',
  rate_limited: 'error.code.rate_limited',
  internal_error: 'error.generic',
  service_unavailable: 'error.code.service_unavailable',
} as const satisfies Record<ErrorCode, MessageKey>;

function isKnownCode(code: string): code is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code);
}

/** How the UI shows an error: one message, plus the request id for support when there is one. */
export interface ErrorDescription {
  readonly kind: 'api' | 'network' | 'contract' | 'unknown';
  readonly messageKey: MessageKey;
  readonly requestId?: string;
  readonly code?: string;
  readonly status?: number;
}

/**
 * The single translation of the error envelope (ADR 0020) to UI text. Unknown
 * codes of a newer API fall back by status class; `message` of the envelope
 * is for developers and never shown.
 */
export function describeError(error: unknown): ErrorDescription {
  if (error instanceof ApiError) {
    const messageKey: MessageKey = isKnownCode(error.code)
      ? ERROR_MESSAGE_KEYS[error.code]
      : error.status >= 500
        ? 'error.generic'
        : 'error.code.bad_request';
    return {
      kind: 'api',
      messageKey,
      code: error.code,
      status: error.status,
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
    };
  }
  if (error instanceof ApiNetworkError) return { kind: 'network', messageKey: 'error.network' };
  if (error instanceof ApiContractError) return { kind: 'contract', messageKey: 'error.contract' };
  return { kind: 'unknown', messageKey: 'error.generic' };
}

/** Operations whose `401` is an answer to the user (wrong code), not an expired session. */
const SIGN_IN_OPERATIONS = new Set(['sendSignInCode', 'verifySignInCode']);

/** The session is gone (expired, revoked from another device): back to the sign-in. */
export function isSessionExpired(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 401 && !SIGN_IN_OPERATIONS.has(error.operationId)
  );
}

/**
 * Worth retrying by itself: no response, the API or a proxy failing (`5xx`
 * but `500`, which is a bug and fails the same way again), or a `429` that
 * says when (`Retry-After`). Never other `4xx`: they fail the same way again.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof ApiNetworkError) return !error.aborted;
  if (error instanceof ApiError) {
    if (error.status === 429) return error.retryAfterS !== undefined;
    return error.status >= 502 && error.status <= 504;
  }
  return false;
}

/** Delay before retry `attempt` (0-based): `Retry-After` when given, else exponential, capped. */
export function retryDelayMs(attempt: number, error: unknown): number {
  if (error instanceof ApiError && error.retryAfterS !== undefined) {
    return error.retryAfterS * 1000;
  }
  return Math.min(1000 * 2 ** attempt, 30_000);
}
