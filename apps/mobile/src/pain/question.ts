import type { PainReportForm } from '@sport-performance/contracts';
import type { PainReportUnavailableReason } from '@sport-performance/domain';

/**
 * Whether the app asks "¿te duele algo?" (B-609, ADR 0078). The server says
 * so twice: `GET /v1/pain-reports/today` (with the reason when not, and the
 * last answer of the day) and `permissions.reportPain` of the player's own
 * profile (`GET /v1/me/player`), which the player app already keeps on the
 * phone for offline (ADR 0074). Without signal, the kept profile decides; the
 * answers themselves are never kept (only the queue holds one until it is
 * sent). The server checks again when the mutation arrives: a consent
 * revoked in the meantime rejects it.
 */

/** What the screen shows before the player answers. */
export type PainQuestionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ask' }
  | { readonly kind: 'unavailable'; readonly reason: PainReportUnavailableReason }
  | { readonly kind: 'needs_connection' };

export function painQuestionState(input: {
  /** The answer of `GET /v1/pain-reports/today`, when there is one. */
  readonly form: PainReportForm | undefined;
  /** That read failed (no signal, or an error). */
  readonly failed: boolean;
  /** `permissions.reportPain` of the kept profile; `undefined` while it is not known. */
  readonly profileAsks: boolean | undefined;
}): PainQuestionState {
  if (input.form !== undefined) {
    return input.form.enabled
      ? { kind: 'ask' }
      : { kind: 'unavailable', reason: input.form.unavailableReason ?? 'module_off' };
  }
  if (input.profileAsks === true) return { kind: 'ask' };
  if (!input.failed) return { kind: 'loading' };
  // Without signal and without a profile that says yes, the reason is not known: ask for signal.
  return { kind: 'needs_connection' };
}
