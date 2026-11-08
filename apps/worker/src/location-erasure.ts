import {
  LOCATION_ERASURE_CHANGE_REASON,
  LOCATION_ERASURE_TABLES,
  locationErasedTotal,
  type ClubId,
  type LocationErasedRows,
  type PlayerId,
} from '@sport-performance/domain';
import type pg from 'pg';
import type { Logger } from 'pino';
import { inClubTransaction, type ClubTransaction } from './database.js';

/**
 * Erasure of a player's position data after the `location` consent was
 * revoked (B-913, ADR 0106). Revoking it queues a `location_erasure` in the
 * same transaction (trigger `consent_location_erasure`); this job deletes the
 * player's position traces and `pod_raw` files and completes the row with
 * only the number of rows deleted per table. The completion is what the change
 * history records (the traces themselves have no history triggers): the
 * player, the counts and {@link LOCATION_ERASURE_CHANGE_REASON}, never the
 * deleted values. The logs carry the same summary and no personal data.
 */

export interface LocationErasureDependencies {
  /** Pool of a `sport_performance_worker` login. */
  readonly pool: pg.Pool;
  readonly logger: Logger;
}

export interface LocationErasureReport {
  /** Erasures completed by this run. */
  readonly completed: number;
  /** Rows deleted, all tables together. */
  readonly deleted: number;
  /** Another erasure of the club is waiting: the caller enqueues the job again. */
  readonly more: boolean;
}

/** Erasures completed per transaction: each one deletes every trace of a player. */
export const LOCATION_ERASURE_BATCH = 20;

/**
 * Deletes the position data of one player inside the erasure's transaction,
 * and returns the rows deleted per table.
 *
 * TODO(B-912, B-916): the position traces and the `pod_raw` file kind do not
 * exist yet (`LOCATION_ERASURE_TABLES` is empty, so this deletes nothing).
 * Each trace table arrives with its migration, the worker's `DELETE` grant and
 * no history trigger, and is listed there (a constant: never input). The
 * `pod_raw` file rows are not deleted but marked `deleted`, so the retention
 * job removes their objects from the bucket, as `app.erase_player` does (ADR
 * 0044): that step is added here with the file kind.
 */
export async function deletePositionData(
  tx: ClubTransaction,
  playerId: PlayerId,
): Promise<LocationErasedRows> {
  const deleted: Record<string, number> = {};
  for (const table of LOCATION_ERASURE_TABLES as readonly string[]) {
    const result = await tx.client.query(`delete from ${table} where player_id = $1`, [playerId]);
    deleted[table] = result.rowCount ?? 0;
  }
  return deleted;
}

/** The clubs with a pending erasure (`app.worker_location_erasure_clubs()`). */
export async function listLocationErasureClubs(pool: pg.Pool): Promise<ClubId[]> {
  const { rows } = await pool.query<{ club_id: ClubId }>(
    'select c as club_id from app.worker_location_erasure_clubs() c',
  );
  return rows.map((r) => r.club_id);
}

/**
 * Completes the pending erasures of one club, oldest first, each one in the
 * same transaction as its deletes (all or nothing). Rows taken by another run
 * are skipped (`SKIP LOCKED`).
 */
export async function runClubLocationErasures(
  deps: LocationErasureDependencies,
  clubId: ClubId,
  options: { readonly jobId?: string } = {},
): Promise<LocationErasureReport> {
  const report = await inClubTransaction(
    deps.pool,
    clubId,
    async (tx) => {
      await tx.client.query("select set_config('app.change_reason', $1, true)", [
        LOCATION_ERASURE_CHANGE_REASON,
      ]);
      const { rows } = await tx.client.query<{ id: string; player_id: PlayerId }>(
        `select id, player_id from location_erasure
          where club_id = $1 and status = 'pending'
          order by created_at, id
          limit $2
          for update skip locked`,
        [clubId, LOCATION_ERASURE_BATCH + 1],
      );
      const batch = rows.slice(0, LOCATION_ERASURE_BATCH);
      let deleted = 0;
      for (const row of batch) {
        const counts = await deletePositionData(tx, row.player_id);
        await tx.client.query(
          `update location_erasure
              set status = 'completed', completed_at = now(), deleted_rows = $3::jsonb
            where club_id = $1 and id = $2`,
          [clubId, row.id, JSON.stringify(counts)],
        );
        const total = locationErasedTotal(counts);
        deleted += total;
        // A summary only: which erasure and how many rows, never a value.
        deps.logger.info(
          { clubId, jobId: options.jobId, erasureId: row.id, deleted: total },
          'position data erased',
        );
      }
      return { completed: batch.length, deleted, more: rows.length > batch.length };
    },
    options.jobId === undefined ? {} : { requestId: `job:${options.jobId}` },
  );
  return report;
}
