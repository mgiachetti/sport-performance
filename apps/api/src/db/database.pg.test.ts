/**
 * Integration tests of the tenant transaction against a real Postgres 16
 * (ADR 0006): the context lives only inside its transaction and never
 * leaks to another request through a pooled connection.
 */
import { randomUUID } from 'node:crypto';
import { ROLES, parseClubId, parseUserId } from '@sport-performance/domain';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeWithPostgres } from '../testing/support.js';
import {
  TransactionAbortedError,
  createPgDatabase,
  databaseFromPool,
  type Database,
  type TransactionClient,
} from './database.js';
import { ANONYMOUS_CONTEXT, TenantContextError, type TenantContext } from './tenant-context.js';

interface Settings {
  clubId: string | null;
  userId: string | null;
  role: string | null;
}

const READ_SETTINGS = `select current_setting('app.club_id', true) as "clubId",
  current_setting('app.user_id', true) as "userId",
  current_setting('app.role', true) as "role"`;

async function readSettings(client: pg.ClientBase | pg.Pool): Promise<Settings> {
  const { rows } = await client.query<Settings>(READ_SETTINGS);
  const row = rows[0];
  if (row === undefined) throw new Error('no row');
  return row;
}

async function backendPid(client: TransactionClient): Promise<number> {
  const { rows } = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
  return rows[0]?.pid ?? -1;
}

/** "No value": `''` once the setting exists in the session, `NULL` before. */
function isUnset(value: string | null): boolean {
  return value === null || value === '';
}

function expectNoContext(settings: Settings): void {
  expect(isUnset(settings.clubId), `club_id = ${String(settings.clubId)}`).toBe(true);
  expect(isUnset(settings.userId), `user_id = ${String(settings.userId)}`).toBe(true);
  expect(isUnset(settings.role), `role = ${String(settings.role)}`).toBe(true);
}

function clubContext(role: (typeof ROLES)[number] = 'coach'): TenantContext {
  return { clubId: parseClubId(randomUUID()), userId: parseUserId(randomUUID()), role };
}

describeWithPostgres('Database.transaction (Postgres)', (url) => {
  // One connection: every transaction reuses the same backend, the worst case for leaks.
  let single: pg.Pool;
  let singleDb: Database;
  let wide: pg.Pool;
  let wideDb: Database;

  beforeAll(() => {
    single = new pg.Pool({ connectionString: url, max: 1 });
    singleDb = databaseFromPool(single);
    wide = new pg.Pool({ connectionString: url, max: 4 });
    wideDb = databaseFromPool(wide);
  });

  afterAll(async () => {
    await Promise.all([singleDb.close(), wideDb.close()]);
  });

  it('sets the three settings before the work runs', async () => {
    const context = clubContext('medical');
    const seen = await singleDb.transaction(context, (client) => readSettings(client));
    expect(seen).toEqual({ clubId: context.clubId, userId: context.userId, role: 'medical' });
  });

  it('scopes the settings to the transaction: the pooled connection keeps nothing', async () => {
    const context = clubContext();
    const pid = await singleDb.transaction(context, backendPid);

    // Same backend, outside any transaction of the helper.
    const client = await single.connect();
    try {
      expect(await backendPid(client)).toBe(pid);
      expectNoContext(await readSettings(client));
    } finally {
      client.release();
    }

    // The next request on that connection, anonymous, sees no context either.
    const next = await singleDb.transaction(ANONYMOUS_CONTEXT, async (tx) => ({
      pid: await backendPid(tx),
      settings: await readSettings(tx),
    }));
    expect(next.pid).toBe(pid);
    expectNoContext(next.settings);
  });

  it('a user without a club only carries the user id', async () => {
    const userId = parseUserId(randomUUID());
    const seen = await singleDb.transaction({ clubId: null, userId, role: null }, readSettings);
    expect(seen).toEqual({ clubId: '', userId, role: '' });
  });

  it('rolls back on error and the context does not survive the rollback', async () => {
    const context = clubContext('admin');
    const failure = new Error('handler failed');
    await expect(
      singleDb.transaction(context, async (tx) => {
        await readSettings(tx);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expectNoContext(await singleDb.transaction(ANONYMOUS_CONTEXT, readSettings));
  });

  it('commits on success and discards writes on error', async () => {
    const table = `api_tx_${randomUUID().replaceAll('-', '')}`;
    await single.query(`create table ${table} (value int not null)`);
    try {
      await singleDb.transaction(ANONYMOUS_CONTEXT, (tx) =>
        tx.query(`insert into ${table} values (1)`),
      );
      await expect(
        singleDb.transaction(ANONYMOUS_CONTEXT, async (tx) => {
          await tx.query(`insert into ${table} values (2)`);
          throw new Error('nope');
        }),
      ).rejects.toThrow('nope');
      const { rows } = await single.query<{ value: number }>(`select value from ${table}`);
      expect(rows).toEqual([{ value: 1 }]);
    } finally {
      await single.query(`drop table ${table}`);
    }
  });

  it('refuses to report a commit when the work swallowed an SQL error', async () => {
    const table = `api_tx_${randomUUID().replaceAll('-', '')}`;
    await single.query(`create table ${table} (value int not null)`);
    try {
      await expect(
        singleDb.transaction(ANONYMOUS_CONTEXT, async (tx) => {
          await tx.query(`insert into ${table} values (1)`);
          await tx.query('select 1 / 0').catch(() => undefined);
          return 'looks fine';
        }),
      ).rejects.toBeInstanceOf(TransactionAbortedError);
      const { rows } = await single.query(`select value from ${table}`);
      expect(rows).toEqual([]);
    } finally {
      await single.query(`drop table ${table}`);
    }
  });

  it('overrides a setting left at session level by mistake', async () => {
    const leaked = clubContext('admin');
    // Buggy code writes session-level settings (is_local = false) on a pooled connection.
    await singleDb.transaction(ANONYMOUS_CONTEXT, async (tx) => {
      await tx.query(
        "select set_config('app.club_id', $1, false), set_config('app.user_id', $2, false), set_config('app.role', $3, false)",
        [leaked.clubId, leaked.userId, leaked.role],
      );
    });
    try {
      expectNoContext(await singleDb.transaction(ANONYMOUS_CONTEXT, readSettings));
      const other = clubContext('player');
      expect(await singleDb.transaction(other, readSettings)).toEqual({
        clubId: other.clubId,
        userId: other.userId,
        role: 'player',
      });
    } finally {
      await single.query('reset all');
    }
  });

  it('isolates concurrent transactions sharing a small pool', async () => {
    const contexts: TenantContext[] = Array.from({ length: 40 }, (_, index) =>
      index % 5 === 0 ? ANONYMOUS_CONTEXT : clubContext(ROLES[index % ROLES.length]),
    );
    const results = await Promise.all(
      contexts.map((context, index) =>
        wideDb.transaction(context, async (tx) => {
          const before = await readSettings(tx);
          // Interleave: other transactions run on the other connections meanwhile.
          await tx.query('select pg_sleep($1)', [(index % 4) * 0.01]);
          const after = await readSettings(tx);
          return { before, after, pid: await backendPid(tx) };
        }),
      ),
    );
    results.forEach(({ before, after }, index) => {
      const context = contexts[index];
      const expected = {
        clubId: context?.clubId ?? '',
        userId: context?.userId ?? '',
        role: context?.role ?? '',
      };
      if (context === ANONYMOUS_CONTEXT) {
        expectNoContext(before);
        expectNoContext(after);
      } else {
        expect(before).toEqual(expected);
        expect(after).toEqual(expected);
      }
    });
    // Forty transactions on at most four connections: connections were reused.
    expect(new Set(results.map((result) => result.pid)).size).toBeLessThanOrEqual(4);
  });

  it('validates the context before checking out a connection', async () => {
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    const db = databaseFromPool(pool);
    try {
      await expect(
        db.transaction(
          {
            clubId: "'; drop table x; --",
            userId: randomUUID(),
            role: 'admin',
          } as unknown as TenantContext,
          readSettings,
        ),
      ).rejects.toBeInstanceOf(TenantContextError);
      expect(pool.totalCount).toBe(0);
    } finally {
      await db.close();
    }
  });

  it('destroys a connection whose rollback failed instead of returning it to the pool', async () => {
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    pool.on('error', () => undefined);
    const db = databaseFromPool(pool);
    try {
      const firstPid = await db.transaction(clubContext(), backendPid);
      await expect(
        db.transaction(clubContext(), (tx) =>
          tx.query('select pg_terminate_backend(pg_backend_pid())'),
        ),
      ).rejects.toThrow();
      const next = await db.transaction(ANONYMOUS_CONTEXT, async (tx) => ({
        pid: await backendPid(tx),
        settings: await readSettings(tx),
      }));
      expect(next.pid).not.toBe(firstPid);
      expectNoContext(next.settings);
    } finally {
      await db.close();
    }
  });

  it('pings the database', async () => {
    await expect(singleDb.ping(2000)).resolves.toBeUndefined();
  });
});

describeWithPostgres('createPgDatabase (Postgres)', (url) => {
  it('applies the statement timeout and the application name', async () => {
    const db = createPgDatabase({
      url,
      poolMax: 1,
      connectTimeoutMs: 2000,
      statementTimeoutMs: 200,
      applicationName: 'api-test',
    });
    try {
      const name = await db.transaction(ANONYMOUS_CONTEXT, async (tx) => {
        const { rows } = await tx.query<{ name: string }>(
          "select current_setting('application_name') as name",
        );
        return rows[0]?.name;
      });
      expect(name).toBe('api-test');
      await expect(
        db.transaction(ANONYMOUS_CONTEXT, (tx) => tx.query('select pg_sleep(2)')),
      ).rejects.toMatchObject({ code: '57014' });
    } finally {
      await db.close();
    }
  });
});
