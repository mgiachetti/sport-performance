import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../migrate.js';
import { hasDatabase } from './database.js';
import {
  ADMIN_SHUTDOWN_CODE,
  TEMPLATE_PREFIX,
  createTemporaryDatabase,
  ensureMigratedTemplate,
  isAdminShutdown,
  migratedTemplateName,
  trackPool,
} from './temporary-database.js';

const serverUrl = process.env.DATABASE_URL ?? '';

async function onServer<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function databaseExists(name: string): Promise<boolean> {
  const { rowCount } = await onServer((c) =>
    c.query('select 1 from pg_database where datname = $1', [name]),
  );
  return rowCount === 1;
}

async function roleExists(name: string): Promise<boolean> {
  const { rowCount } = await onServer((c) =>
    c.query('select 1 from pg_roles where rolname = $1', [name]),
  );
  return rowCount === 1;
}

/** Opens `count` connections at once and returns them to the pool, idle. */
async function warm(pool: pg.Pool, count: number): Promise<void> {
  const clients = await Promise.all(Array.from({ length: count }, () => pool.connect()));
  await Promise.all(clients.map((c) => c.query('select 1')));
  for (const c of clients) c.release();
}

describe('isAdminShutdown', () => {
  it('matches the 57P01 of a terminated backend only', () => {
    expect(ADMIN_SHUTDOWN_CODE).toBe('57P01');
    expect(isAdminShutdown(Object.assign(new Error('terminating'), { code: '57P01' }))).toBe(true);
    expect(isAdminShutdown(Object.assign(new Error('other'), { code: '57P05' }))).toBe(false);
    expect(isAdminShutdown(new Error('no code'))).toBe(false);
    expect(isAdminShutdown(null)).toBe(false);
    expect(isAdminShutdown('57P01')).toBe(false);
  });
});

// Issue #147: idle pool connections terminated by `DROP DATABASE ... WITH (FORCE)`
// surfaced as unhandled 57P01 errors and failed runs whose tests all passed. Vitest
// fails this file on any unhandled error, so passing tests also prove none escaped.
describe.skipIf(!hasDatabase)('temporary databases (Postgres 16)', () => {
  it('drops a migrated database with idle pools and their logins, without stray errors', async () => {
    const database = await createTemporaryDatabase({ serverUrl, prefix: 'sp_tmp_test' });
    const owner = database.pool({ max: 4 });
    const app = await database.login('app');
    const appPool = database.pool({ connectionString: app.connectionString, max: 4 });
    await Promise.all([warm(owner, 4), warm(appPool, 4)]);
    const { rows } = await appPool.query<{ current_user: string }>('select current_user');
    expect(rows[0]?.current_user).toBe(app.login);
    expect(owner.idleCount).toBe(4);

    await database.drop();
    expect(await databaseExists(database.name)).toBe(false);
    expect(await roleExists(app.login)).toBe(false);
    expect(owner.totalCount).toBe(0);
    // Idempotent.
    await database.drop();
  });

  it('waits for the sockets of a pool the test already ended (pool.end() resolves too early)', async () => {
    const database = await createTemporaryDatabase({ serverUrl, migrate: false });
    for (let round = 0; round < 5; round += 1) {
      const pool = database.pool({ max: 4 });
      await warm(pool, 4);
      // Not awaited on purpose, as a caller that ends its pool right before the drop.
      void pool.end();
    }
    await database.drop();
    expect(await databaseExists(database.name)).toBe(false);
  });

  it('absorbs the 57P01 of an idle connection the server terminates', async () => {
    const database = await createTemporaryDatabase({ serverUrl, migrate: false });
    const pool = database.pool({ max: 2 });
    await warm(pool, 2);
    // Both idle connections are terminated: wait until the pool removed both.
    let removed = 0;
    const terminated = new Promise<void>((resolve) => {
      pool.on('remove', () => {
        removed += 1;
        if (removed === 2) resolve();
      });
    });
    await onServer((c) =>
      c.query(
        'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
        [database.name],
      ),
    );
    await terminated;
    // The pool replaces the connection and the drop reports nothing.
    expect((await pool.query<{ one: number }>('select 1 as one')).rows[0]?.one).toBe(1);
    await expect(database.closePool(pool)).resolves.toBeUndefined();
    await database.drop();
  });

  it('reports any other error of an idle connection, after dropping', async () => {
    const database = await createTemporaryDatabase({ serverUrl, migrate: false });
    const pool = database.pool({ max: 1 });
    const timedOut = new Promise<void>((resolve) =>
      pool.once('remove', () => {
        resolve();
      }),
    );
    // Set on the open session, so the timer only starts once the client is idle in the pool.
    const client = await pool.connect();
    await client.query(`set idle_session_timeout = '200ms'`);
    client.release();
    await timedOut;

    const error: unknown = await database.drop().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    const [first] = (error as AggregateError).errors as { code?: string }[];
    expect(first?.code).toBe('57P05'); // idle_session_timeout
    expect(await databaseExists(database.name)).toBe(false);
  });

  it('reports a client that was never released, and still drops the database', async () => {
    const database = await createTemporaryDatabase({
      serverUrl,
      migrate: false,
      poolCloseTimeoutMs: 500,
    });
    const pool = database.pool({ max: 1 });
    const leaked = await pool.connect();

    const error: unknown = await database.drop().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect(String((error as AggregateError).errors[0])).toMatch(
      /1 connection\(s\) still open after 500 ms \(1 checked out/,
    );
    expect(await databaseExists(database.name)).toBe(false);
    // The forced drop terminated it; its error was expected, so nothing escapes.
    await expect(leaked.query('select 1')).rejects.toThrow();
    leaked.release();
  });

  it('refuses new pools once the drop started', async () => {
    const database = await createTemporaryDatabase({ serverUrl, migrate: false });
    const dropping = database.drop();
    expect(() => database.pool()).toThrow(/being dropped/);
    await dropping;
  });
});

describe('migratedTemplateName', () => {
  it('is stable and changes with any migration file', async () => {
    const name = await migratedTemplateName();
    expect(name).toMatch(new RegExp(`^${TEMPLATE_PREFIX}[0-9a-f]{16}$`));
    expect(await migratedTemplateName()).toBe(name);

    const folder = await mkdtemp(join(tmpdir(), 'sp-template-'));
    try {
      await writeFile(join(folder, '0000_a.sql'), 'select 1;');
      const before = await migratedTemplateName(folder);
      await writeFile(join(folder, '0000_a.sql'), 'select 2;');
      expect(await migratedTemplateName(folder)).not.toBe(before);
      expect(await migratedTemplateName(folder)).not.toBe(name);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasDatabase)('migrated template (Postgres 16)', () => {
  it('copies a template with every migration applied, which accepts no connections', async () => {
    const template = await ensureMigratedTemplate(serverUrl);
    expect(template).toBe(await migratedTemplateName());
    const { rows } = await onServer((c) =>
      c.query<{ datistemplate: boolean; datallowconn: boolean }>(
        'select datistemplate, datallowconn from pg_database where datname = $1',
        [template],
      ),
    );
    expect(rows).toEqual([{ datistemplate: true, datallowconn: false }]);

    const [a, b] = await Promise.all([
      createTemporaryDatabase({ serverUrl }),
      createTemporaryDatabase({ serverUrl }),
    ]);
    try {
      const applied = await a
        .pool({ max: 1 })
        .query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
      expect(applied.rows[0]?.n).toBe(
        readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).length,
      );
      // Copies are independent databases.
      await a
        .pool({ max: 1 })
        .query(`insert into club (slug, name, short_name) values ('tpl', 'T', 'T')`);
      const other = await b.pool({ max: 1 }).query('select count(*)::int as n from club');
      expect(other.rows[0]).toEqual({ n: 0 });
    } finally {
      await Promise.all([a.drop(), b.drop()]);
    }
  });
});

describe.skipIf(!hasDatabase)('trackPool', () => {
  it('closes a pool and waits for every socket', async () => {
    const pool = new pg.Pool({ connectionString: serverUrl, max: 3 });
    const tracked = trackPool(pool);
    await warm(pool, 3);
    await tracked.close();
    expect(pool.ended).toBe(true);
    expect(tracked.takeUnexpectedErrors()).toEqual([]);
  });
});
