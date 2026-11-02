import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MIGRATIONS_FOLDER,
  MigrationOrderError,
  migrationsConnectionString,
  runMigrations,
} from './migrate.js';
import {
  createEmptyDatabase,
  createMigratedDatabase,
  hasDatabase,
  must,
  type TestDatabase,
} from './testing/database.js';
import { FULL_MIGRATION_TIMEOUT_MS } from './testing/temporary-database.js';

interface Journal {
  entries: { idx: number; when: number; tag: string }[];
}

async function readJournal(folder: string): Promise<Journal> {
  return JSON.parse(await readFile(join(folder, 'meta', '_journal.json'), 'utf8')) as Journal;
}

describe('migration journal', () => {
  it('orders migrations by index with strictly increasing timestamps', async () => {
    // Drizzle applies a migration only if its `when` is newer than the latest applied one.
    const { entries } = await readJournal(MIGRATIONS_FOLDER);
    entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      if (i > 0) expect(entry.when).toBeGreaterThan(must(entries[i - 1]).when);
    });
  });
});

describe('migrationsConnectionString', () => {
  it('prefers the owner role and falls back to DATABASE_URL', () => {
    expect(
      migrationsConnectionString({
        MIGRATIONS_DATABASE_URL: 'postgres://owner',
        DATABASE_URL: 'x',
      }),
    ).toBe('postgres://owner');
    expect(migrationsConnectionString({ DATABASE_URL: 'postgres://app' })).toBe('postgres://app');
    expect(() => migrationsConnectionString({})).toThrow(/MIGRATIONS_DATABASE_URL/);
    expect(() => migrationsConnectionString({ DATABASE_URL: ' ' })).toThrow();
  });

  it('treats a blank MIGRATIONS_DATABASE_URL as missing (as in .env.example)', () => {
    for (const blank of ['', '  ']) {
      expect(
        migrationsConnectionString({
          MIGRATIONS_DATABASE_URL: blank,
          DATABASE_URL: 'postgres://app',
        }),
      ).toBe('postgres://app');
      expect(() => migrationsConnectionString({ MIGRATIONS_DATABASE_URL: blank })).toThrow(
        /MIGRATIONS_DATABASE_URL/,
      );
    }
  });
});

describe.skipIf(!hasDatabase)('runMigrations safety (Postgres 16)', () => {
  let database: TestDatabase;
  let folder: string;

  beforeEach(async () => {
    database = await createEmptyDatabase();
    folder = await mkdtemp(join(tmpdir(), 'sp-db-migrations-'));
    await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
  });

  afterEach(async () => {
    await database.drop();
    await rm(folder, { recursive: true, force: true });
  });

  /**
   * Switches to a copy of the migrated template: the state a full run of
   * `folder` (a copy of the migrations) leaves, same hashes and timestamps,
   * without paying for a full run under load (issue #147).
   */
  async function startMigrated(): Promise<void> {
    await database.drop();
    database = await createMigratedDatabase();
  }

  it('refuses to run after an applied migration was edited', async () => {
    await startMigrated();
    const { entries } = await readJournal(folder);
    await appendFile(
      join(folder, `${must(entries[0]).tag}.sql`),
      '\n-- edited after being applied\n',
    );
    await expect(
      runMigrations({ connectionString: database.connectionString, migrationsFolder: folder }),
    ).rejects.toBeInstanceOf(MigrationOrderError);
  });

  // A full run of every migration: minutes on a loaded runner (issue #147).
  it(
    'refuses to skip a migration merged out of order',
    { timeout: FULL_MIGRATION_TIMEOUT_MS },
    async () => {
      const journal = await readJournal(folder);
      const last = must(journal.entries.at(-1));
      // Apply everything except the last migration, then add one dated before it.
      const withoutLast = { ...journal, entries: journal.entries.slice(0, -1) };
      await writeFile(join(folder, 'meta', '_journal.json'), JSON.stringify(withoutLast));
      await writeFile(join(folder, '9999_newer.sql'), 'select 1;');
      const newer = {
        idx: last.idx,
        when: last.when + 1000,
        tag: '9999_newer',
        version: '7',
        breakpoints: true,
      };
      await writeFile(
        join(folder, 'meta', '_journal.json'),
        JSON.stringify({ ...journal, entries: [...withoutLast.entries, newer] }),
      );
      await runMigrations({
        connectionString: database.connectionString,
        migrationsFolder: folder,
      });

      // The "other branch" migration is older than the applied 9999_newer.
      await writeFile(
        join(folder, 'meta', '_journal.json'),
        JSON.stringify({
          ...journal,
          entries: [...withoutLast.entries, last, { ...newer, idx: last.idx + 1 }],
        }),
      );
      const error: unknown = await runMigrations({
        connectionString: database.connectionString,
        migrationsFolder: folder,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MigrationOrderError);
      expect((error as MigrationOrderError).migrations).toEqual([last.when]);
    },
  );

  it('reports applied migrations the code does not know', async () => {
    await startMigrated();
    const journal = await readJournal(folder);
    await writeFile(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }),
    );
    const report = await runMigrations({
      connectionString: database.connectionString,
      migrationsFolder: folder,
    });
    expect(report).toEqual({ applied: 0, total: journal.entries.length, unknown: 1 });
  });

  it('reports the original error when the connection drops mid-run', async () => {
    // The migration kills its own backend: the unlock in `finally` then fails
    // too, and must not replace the error of the migration itself.
    await startMigrated();
    const journal = await readJournal(folder);
    const last = must(journal.entries.at(-1));
    await writeFile(
      join(folder, '9999_drop_connection.sql'),
      'select pg_terminate_backend(pg_backend_pid());',
    );
    await writeFile(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        ...journal,
        entries: [
          ...journal.entries,
          {
            idx: last.idx + 1,
            when: last.when + 1000,
            tag: '9999_drop_connection',
            version: '7',
            breakpoints: true,
          },
        ],
      }),
    );
    const error: unknown = await runMigrations({
      connectionString: database.connectionString,
      migrationsFolder: folder,
    }).catch((e: unknown) => e);
    // Drizzle reports the failed migration transaction; without the guard the
    // runner threw the unlock's "not queryable" error instead.
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Failed query/);
    expect((error as Error).message).not.toMatch(/pg_advisory_unlock|not queryable/);
  });
});
