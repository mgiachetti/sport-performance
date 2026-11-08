import { memberGuard } from './enum.js';
import type { FileKind } from './files.js';

/**
 * Erasure of a player's position data when the `location` consent is revoked
 * (B-913, ADR 0106). Stronger than the revocation of ADR 0043 (which only
 * stops future collection): the worker deletes the player's position traces
 * and `pod_raw` files, and keeps only a summary: which player, how many rows
 * per table, and why. The traces and the `pod_raw` rows are never tracked by
 * the change history (ADR 0030), which would keep the deleted values; the
 * summary row (`location_erasure`) is, so the history shows that it happened.
 *
 * Aggregated metrics that are not a position (total distance, HSR,
 * accelerations) follow the `data` consent and are not deleted here.
 */

/** `pending` from the revocation until the worker deleted everything; then `completed`. */
export const LOCATION_ERASURE_STATUSES = ['pending', 'completed'] as const;
export type LocationErasureStatus = (typeof LOCATION_ERASURE_STATUSES)[number];
export const isLocationErasureStatus = memberGuard(LOCATION_ERASURE_STATUSES);

/** Why the position data was erased. `packages/db` builds its enum from here. */
export const LOCATION_ERASURE_REASONS = ['consent_revoked'] as const;
export type LocationErasureReason = (typeof LOCATION_ERASURE_REASONS)[number];

/**
 * The reason the worker records in the change history (`app.change_reason`)
 * when it completes an erasure: no data, only the cause.
 */
export const LOCATION_ERASURE_CHANGE_REASON =
  'location consent revoked: position traces and pod_raw files deleted (ADR 0106)';

/**
 * The tables whose rows the erasure deletes, as `schema.table`, in the order
 * the summary reports them: the position traces of the pod (B-916). Each
 * table has the worker's `DELETE` grant and no history trigger.
 */
export const LOCATION_ERASURE_TABLES = [
  'public.pod_trace_segment',
] as const satisfies readonly string[];

/**
 * The file kinds of the player the erasure marks `deleted` (the retention job
 * then removes their objects, as `app.erase_player` does, ADR 0044): the
 * trimmed `pod_raw` files of the player. A pending `pod_raw` belongs to no
 * player yet: when it is trimmed, a revoked `location` keeps every instant
 * of that player out (`consentCoverage`). Reported as `file:<kind>`.
 */
export const LOCATION_ERASURE_FILE_KINDS = ['pod_raw'] as const satisfies readonly FileKind[];

/** Rows deleted per table (`schema.table` → count), the summary of an erasure. */
export type LocationErasedRows = Readonly<Record<string, number>>;

/** Total rows deleted by an erasure. */
export function locationErasedTotal(rows: LocationErasedRows): number {
  return Object.values(rows).reduce((sum, n) => sum + n, 0);
}
