/**
 * The few things the local database needs from SQLite (ADR 0069): one
 * connection that runs a script and runs one statement with positional
 * parameters, answering rows as arrays of column values (what Drizzle's
 * `sqlite-proxy` driver maps). `expo-sqlite` implements it on the phone
 * (`src/platform/sqlite.ts`) and `node:sqlite` in the tests
 * (`src/test/node-sqlite.ts`), so the same queries, migrations and sync
 * engine run in both.
 */
export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqlResult {
  /** Rows as arrays of column values, in the order of the select list. */
  readonly rows: readonly (readonly SqlValue[])[];
  /** Rows changed by an `INSERT`, `UPDATE` or `DELETE`. */
  readonly changes: number;
}

export interface SqlDriver {
  /** A script of statements without parameters (pragmas, migrations). */
  exec(source: string): Promise<void>;
  /** One statement with positional (`?`) parameters. */
  query(sql: string, params: readonly SqlValue[]): Promise<SqlResult>;
  close(): Promise<void>;
}
