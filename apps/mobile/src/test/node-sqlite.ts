import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlDriver, SqlValue } from '../offline/db/driver.ts';

export interface NodeSqliteDriver extends SqlDriver {
  /** Makes the next statements whose SQL matches fail, as if the app were killed there. */
  failWhen(match: (sql: string) => boolean): void;
  readonly statements: string[];
}

/**
 * The local database driver over `node:sqlite` (ADR 0069), for tests: real
 * SQLite with the same migrations and queries as `expo-sqlite` on the phone.
 */
export function nodeSqliteDriver(path = ':memory:'): NodeSqliteDriver {
  const db = new DatabaseSync(path);
  let fail: ((sql: string) => boolean) | null = null;
  const statements: string[] = [];

  function check(sql: string): void {
    statements.push(sql);
    if (fail?.(sql) === true) throw new Error(`Injected failure: ${sql.slice(0, 40)}`);
  }

  return {
    statements,
    failWhen(match) {
      fail = match;
    },
    exec(source) {
      check(source);
      db.exec(source);
      return Promise.resolve();
    },
    query(sql, params) {
      try {
        check(sql);
        const statement = db.prepare(sql);
        statement.setReturnArrays(true);
        const values = params as SQLInputValue[];
        if (statement.columns().length > 0) {
          const rows = statement.all(...values) as unknown as SqlValue[][];
          return Promise.resolve({ rows, changes: 0 });
        }
        const result = statement.run(...values);
        return Promise.resolve({ rows: [], changes: Number(result.changes) });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    close() {
      db.close();
      return Promise.resolve();
    },
  };
}

/** A database file in a fresh temporary directory, to reopen it as after an app kill. */
export function temporaryDatabaseFile(): { path: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'sp-mobile-db-'));
  return {
    path: join(dir, 'local.db'),
    remove: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
