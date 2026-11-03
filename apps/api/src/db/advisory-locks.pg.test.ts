/**
 * The bounded wait for an advisory lock (issue #175, ADR 0052) against a real
 * Postgres 16: a contended lock answers a retryable 503 before the statement
 * timeout, and the `lock_timeout` of the transaction goes back to its value
 * once the lock is granted.
 */
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@sport-performance/db';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { HttpError } from '../http/errors.js';
import { describeWithPostgres } from '../testing/support.js';
import { ADVISORY_LOCK_MAX_WAIT_MS, waitForAdvisoryLock } from './advisory-locks.js';

const OPTIONS = { busyMessage: 'Busy', retryAfterS: 5 };

describeWithPostgres('waitForAdvisoryLock (Postgres)', (url) => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url, max: 3 });
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Runs `work` in a transaction of its own connection, rolled back at the end. */
  async function inTransaction<T>(
    statementTimeout: string,
    work: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`set local statement_timeout = '${statementTimeout}'`);
      return await work(client);
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  }

  const lockTimeout = async (client: pg.PoolClient) =>
    (await client.query<{ value: string }>(`select current_setting('lock_timeout') as value`))
      .rows[0]?.value;

  it('takes a free lock and restores the lock_timeout of the transaction', async () => {
    await inTransaction('15s', async (client) => {
      await client.query(`set local lock_timeout = '123ms'`);
      const waitMs = await waitForAdvisoryLock(createDatabase(client), randomUUID(), OPTIONS);
      expect(waitMs).toBe(7500);
      expect(await lockTimeout(client)).toBe('123ms');
    });
  });

  it('caps the wait without a statement timeout', async () => {
    await inTransaction('0', async (client) => {
      const waitMs = await waitForAdvisoryLock(createDatabase(client), randomUUID(), OPTIONS);
      expect(waitMs).toBe(ADVISORY_LOCK_MAX_WAIT_MS);
      expect(await lockTimeout(client)).toBe('0');
    });
  });

  it('answers a retryable 503 before the statement timeout when the lock is held', async () => {
    const key = randomUUID();
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      const started = performance.now();
      const error = await inTransaction('2s', (client) =>
        waitForAdvisoryLock(createDatabase(client), key, OPTIONS).then(
          () => undefined,
          (e: unknown) => e,
        ),
      );
      const waitedMs = performance.now() - started;
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({
        code: 'service_unavailable',
        headers: { 'retry-after': '5' },
      });
      // It waited the lock_timeout (half the statement timeout, 1 s); the statement timeout
      // itself would have been a 57014, not an HttpError.
      expect(waitedMs).toBeGreaterThanOrEqual(900);
    } finally {
      await holder.query('rollback');
      holder.release();
    }
  });
});
