import { createDatabase, type Database } from '@sport-performance/db';
import { isUuid, type ClubId } from '@sport-performance/domain';
import type pg from 'pg';

/**
 * Every transaction of the worker acts for one club (ADR 0011, ADR 0026): it
 * sets `app.club_id` with `set_config(..., true)` (`SET LOCAL`) before
 * anything else and clears the other settings, so a value left on a pooled
 * connection never leaks in. The worker's role sees and writes that club
 * only; there is no transaction without a club.
 */
export const SET_WORKER_CONTEXT_SQL =
  "select set_config('app.club_id', $1, true), set_config('app.user_id', '', true), set_config('app.role', '', true), set_config('app.request_id', $2, true), set_config('app.change_reason', '', true)";

/** Same rule as the database's `change_history_request_id` check. */
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export interface ClubTransaction {
  readonly client: pg.PoolClient;
  readonly db: Database;
}

export interface ClubTransactionOptions {
  /**
   * Id recorded with the changes of the transaction (`app.request_id`, ADR
   * 0030): the job id, so a derived change can be traced to its job.
   */
  readonly requestId?: string | undefined;
}

export async function inClubTransaction<T>(
  pool: pg.Pool,
  clubId: ClubId,
  work: (tx: ClubTransaction) => Promise<T>,
  options: ClubTransactionOptions = {},
): Promise<T> {
  if (!isUuid(clubId)) throw new Error('inClubTransaction: clubId must be a uuid.');
  const requestId = options.requestId ?? '';
  if (requestId !== '' && !REQUEST_ID.test(requestId)) {
    throw new Error('inClubTransaction: invalid request id.');
  }
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('begin');
    try {
      await client.query(SET_WORKER_CONTEXT_SQL, [clubId, requestId]);
      const result = await work({ client, db: createDatabase(client) });
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => {
        broken = true;
      });
      throw error;
    }
  } finally {
    client.release(broken);
  }
}
