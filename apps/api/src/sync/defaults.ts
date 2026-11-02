import type { SyncFieldColumn, SyncFieldTable } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import type { TenantDatabase } from '../db/database.js';

/**
 * Fields an insert fills with a default instead of a value someone entered
 * (ADR 0050): the change log gives them no clock, so any real edit wins over
 * them, online or offline. Fields left `NULL` never get one either; this is
 * for defaults with a value, like the planned minutes of a participation the
 * player's RPE creates.
 */
export type DefaultedField = {
  readonly [T in SyncFieldTable]: `${T}.${SyncFieldColumn<T>}`;
}[SyncFieldTable];

/**
 * Runs `insert` with `fields` declared as defaulted (`app.sync_defaulted_fields`,
 * SET LOCAL). Cleared after it; if the insert fails, the transaction or the
 * savepoint it ran in rolls the setting back with it (no `finally`: a query
 * in an aborted transaction would hide the error of the insert).
 */
export async function withDefaultedFields<T>(
  db: TenantDatabase,
  fields: readonly DefaultedField[],
  insert: () => Promise<T>,
): Promise<T> {
  if (fields.length === 0) return insert();
  await db.execute(sql`select set_config('app.sync_defaulted_fields', ${fields.join(',')}, true)`);
  const result = await insert();
  await db.execute(sql`select set_config('app.sync_defaulted_fields', '', true)`);
  return result;
}
