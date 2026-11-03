import { sql } from 'drizzle-orm';
import { databaseErrorOf, HttpError } from '../http/errors.js';
import type { TenantDatabase } from './database.js';

/** Longest wait for a contended advisory lock, whatever the statement timeout. */
export const ADVISORY_LOCK_MAX_WAIT_MS = 10_000;

/** SQLSTATE of a lock that was not granted within `lock_timeout`. */
export const LOCK_NOT_AVAILABLE = '55P03';

export interface AdvisoryLockOptions {
  /** Cap of the wait in ms (default {@link ADVISORY_LOCK_MAX_WAIT_MS}). */
  readonly maxWaitMs?: number;
  /** Message of the `503` when the lock is not granted in time (for developers). */
  readonly busyMessage: string;
  /** `Retry-After` of that `503`, in seconds. */
  readonly retryAfterS: number;
}

/**
 * Takes a transaction-level advisory lock on `key` (`pg_advisory_xact_lock`,
 * held until the transaction ends) waiting a bounded time: a lock held by a
 * long request (an import of 1000 rows) must not count against the
 * `statement_timeout` and end in a `57014` and a `500`. The wait is the
 * `lock_timeout` of the transaction, set to half the `statement_timeout`
 * (so it always fires first) and at most `maxWaitMs`; once the lock is
 * granted the previous `lock_timeout` is restored, so the rest of the request
 * runs with the setting of the session. When the lock is not granted in time
 * the transaction is aborted and the request answers a retryable `503
 * service_unavailable` with `Retry-After` (ADR 0052).
 *
 * Returns the wait applied, in ms.
 */
export async function waitForAdvisoryLock(
  db: TenantDatabase,
  key: string,
  options: AdvisoryLockOptions,
): Promise<number> {
  const maxWaitMs = Math.max(1, Math.trunc(options.maxWaitMs ?? ADVISORY_LOCK_MAX_WAIT_MS));
  const { rows: previous } = await db.execute<{ value: string }>(
    sql`select current_setting('lock_timeout') as value`,
  );
  // `pg_settings.setting` of statement_timeout is in ms; 0 is no timeout. `lock_timeout`
  // without a unit is in ms too. Local to the transaction (`set_config(..., true)`).
  const { rows: applied } = await db.execute<{ waitMs: string }>(sql`
    select wait."waitMs", set_config('lock_timeout', wait."waitMs"::text, true)
      from (select case when setting::bigint = 0 then ${maxWaitMs}::bigint
                        else least(${maxWaitMs}::bigint, greatest(setting::bigint / 2, 1))
                   end as "waitMs"
              from pg_settings
             where name = 'statement_timeout') as wait
  `);
  try {
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  } catch (error) {
    if (databaseErrorOf(error)?.code === LOCK_NOT_AVAILABLE) {
      throw new HttpError('service_unavailable', options.busyMessage, {
        headers: { 'retry-after': String(options.retryAfterS) },
        cause: error,
      });
    }
    throw error;
  }
  await db.execute(sql`select set_config('lock_timeout', ${previous[0]?.value ?? '0'}, true)`);
  return Number(applied[0]?.waitMs ?? maxWaitMs);
}
