import { sql } from 'drizzle-orm';
import type { TenantDatabase } from '../db/database.js';

/**
 * Advisory locks of the offline sync (ADR 0050), shared with the online
 * handlers that create the same rows: a participation that does not exist
 * yet is serialized by session and player, online and offline alike, so
 * neither insert hits the unique key of the other.
 */

/** Serializes on keys of rows that may not exist yet (advisory, until the transaction ends). */
export async function lockKeys(db: TenantDatabase, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  // Keys are ids and `:` only: a plain array literal, one parameter.
  await db.execute(sql`select app.sync_lock_keys(${`{${keys.join(',')}}`}::text[])`);
}

/** The key of the participation of a player in a session, existing or not. */
export const participationKey = (trainingSessionId: string, playerId: string): string =>
  `participation:${trainingSessionId}:${playerId}`;
