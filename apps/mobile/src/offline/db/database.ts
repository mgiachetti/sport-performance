import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import type { SqlDriver, SqlValue } from './driver.ts';
import { LOCAL_MIGRATIONS } from './migrations.ts';
import { localSchema } from './schema.ts';

export type LocalDb = SqliteRemoteDatabase<typeof localSchema>;

/**
 * The local database (ADR 0065): one SQLite connection behind a lock. Every
 * access takes the lock, so a transaction never interleaves with another
 * caller's statements on the same connection. A task gets the Drizzle
 * handle and must use only it: calling `read` or `write` again from inside a
 * task waits for itself.
 */
export interface LocalDatabase {
  /** Reads (no transaction: one statement sees a consistent snapshot). */
  read<T>(task: (db: LocalDb) => Promise<T>): Promise<T>;
  /** One transaction (`BEGIN IMMEDIATE`): all of the task or nothing. */
  write<T>(task: (db: LocalDb) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The file was written by a newer build (an update rolled back): it cannot be read safely. */
export class LocalDatabaseVersionError extends Error {
  readonly found: number;
  readonly supported: number;

  constructor(found: number, supported: number) {
    super(`Local database version ${String(found)} is newer than ${String(supported)}`);
    this.name = 'LocalDatabaseVersionError';
    this.found = found;
    this.supported = supported;
  }
}

function createLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}

async function userVersion(driver: SqlDriver): Promise<number> {
  const { rows } = await driver.query('PRAGMA user_version', []);
  return Number(rows[0]?.[0] ?? 0);
}

/** Runs the migrations the file does not have yet, each in its own transaction. */
async function migrate(driver: SqlDriver): Promise<void> {
  const current = await userVersion(driver);
  if (current > LOCAL_MIGRATIONS.length) {
    throw new LocalDatabaseVersionError(current, LOCAL_MIGRATIONS.length);
  }
  for (let index = current; index < LOCAL_MIGRATIONS.length; index += 1) {
    await driver.exec('BEGIN IMMEDIATE');
    try {
      await driver.exec(LOCAL_MIGRATIONS[index] ?? '');
      await driver.exec(`PRAGMA user_version = ${String(index + 1)}`);
      await driver.exec('COMMIT');
    } catch (error) {
      await driver.exec('ROLLBACK');
      throw error;
    }
  }
}

/**
 * A database that is still opening (the app wires its services
 * synchronously at launch): every access waits for it. If opening fails,
 * every access fails with that error, and the engine reports it.
 */
export function deferredLocalDatabase(opening: Promise<LocalDatabase>): LocalDatabase {
  return {
    read: async (task) => (await opening).read(task),
    write: async (task) => (await opening).write(task),
    close: async () => {
      await (await opening).close();
    },
  };
}

/**
 * Opens the database over a driver: write-ahead log, foreign keys (a scope
 * deletes its rows), deleted rows overwritten on disk (`secure_delete`:
 * data of minors does not linger in free pages after signing out), then
 * the pending migrations.
 */
export async function openLocalDatabase(driver: SqlDriver): Promise<LocalDatabase> {
  await driver.exec('PRAGMA journal_mode = WAL');
  await driver.exec('PRAGMA foreign_keys = ON');
  await driver.exec('PRAGMA secure_delete = ON');
  await migrate(driver);

  const db: LocalDb = drizzle(
    async (sql, params, method) => {
      const result = await driver.query(sql, params as SqlValue[]);
      if (method === 'run') return { rows: [] };
      if (method === 'get') return { rows: (result.rows[0] ?? undefined) as unknown as unknown[] };
      return { rows: result.rows as unknown[] };
    },
    { schema: localSchema },
  );
  const lock = createLock();
  let closed = false;

  function guard(): void {
    if (closed) throw new Error('The local database is closed');
  }

  return {
    read(task) {
      return lock(() => {
        guard();
        return task(db);
      });
    },
    write(task) {
      return lock(async () => {
        guard();
        await driver.exec('BEGIN IMMEDIATE');
        try {
          const result = await task(db);
          await driver.exec('COMMIT');
          return result;
        } catch (error) {
          await driver.exec('ROLLBACK');
          throw error;
        }
      });
    },
    close() {
      return lock(async () => {
        if (closed) return;
        closed = true;
        await driver.close();
      });
    },
  };
}
