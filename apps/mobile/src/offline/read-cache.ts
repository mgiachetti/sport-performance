import { and, eq, ne, sql } from 'drizzle-orm';
import type { LocalDatabase } from './db/database.ts';
import { cachedRead, deviceMeta, syncScope } from './db/schema.ts';
import { OWNER_KEY, type SyncScopeRef } from './engine.ts';

/** The last answer of an API read, as the device keeps it. */
export interface CachedValue<T> {
  readonly value: T;
  /** When the device got it (epoch ms). */
  readonly fetchedAt: number;
}

/**
 * Answers of the API reads that the sync does not move (ADR 0071), kept in
 * the encrypted local database by membership: the screen shows the last one
 * without signal, and signing out (or another user) deletes them with the
 * membership, like every synced row.
 */
export interface ReadCache {
  /**
   * `key` names the read and its parameters: `me.player`, or
   * `me.trainingSessions|<parameters>`. Keeping one answer of a read with
   * parameters drops the kept answers of the same read with other ones (the
   * RPE list of yesterday's range is of no use today).
   */
  get<T>(membershipId: string, key: string): Promise<CachedValue<T> | null>;
  put(scope: SyncScopeRef, key: string, value: unknown, fetchedAt: number): Promise<void>;
}

/** Between the name of a read and its parameters in a cache key. */
export const READ_PARAMS_SEPARATOR = '|';

/** The cache key of a read with its parameters. */
export function readCacheKey(read: string, params: readonly unknown[] = []): string {
  return params.length === 0 ? read : `${read}${READ_PARAMS_SEPARATOR}${JSON.stringify(params)}`;
}

export interface ReadCacheOptions {
  /**
   * The membership the app acts in right now (the session's, `null` signed
   * out). An answer is kept only for it: one that arrives after signing out,
   * or after another person signed in, is dropped.
   */
  readonly activeScope: () => SyncScopeRef | null;
}

export function createReadCache(database: LocalDatabase, options: ReadCacheOptions): ReadCache {
  return {
    async get(membershipId, key) {
      const [row] = await database.read((db) =>
        db
          .select()
          .from(cachedRead)
          .where(and(eq(cachedRead.membershipId, membershipId), eq(cachedRead.key, key))),
      );
      if (row === undefined) return null;
      // The caller names the DTO its key holds.
      return { value: JSON.parse(row.data) as never, fetchedAt: row.fetchedAt };
    },
    async put(scope, key, value, fetchedAt) {
      await database.write(async (db) => {
        // Checked inside the write, serialized with the sign-out wipe: an answer that
        // arrives after signing out (or after another user signed in) is dropped.
        const active = options.activeScope();
        if (active?.membershipId !== scope.membershipId || active.userId !== scope.userId) return;
        const [holder] = await db
          .select({ value: deviceMeta.value })
          .from(deviceMeta)
          .where(eq(deviceMeta.key, OWNER_KEY));
        if (holder?.value !== scope.userId) {
          // The first answer after signing in can beat the sync engine to claiming the
          // device (`SyncEngine.setScope`): claim it the same way, so it is kept and
          // nothing of a previous person stays.
          await db.delete(syncScope).where(ne(syncScope.userId, scope.userId));
          await db
            .insert(deviceMeta)
            .values({ key: OWNER_KEY, value: scope.userId })
            .onConflictDoUpdate({ target: deviceMeta.key, set: { value: scope.userId } });
        }
        const [owner] = await db
          .select({ userId: syncScope.userId })
          .from(syncScope)
          .where(eq(syncScope.membershipId, scope.membershipId));
        if (owner !== undefined && owner.userId !== scope.userId) return;
        if (owner === undefined) {
          await db
            .insert(syncScope)
            .values({
              membershipId: scope.membershipId,
              userId: scope.userId,
              createdAt: fetchedAt,
            })
            .onConflictDoNothing();
        }
        const separator = key.indexOf(READ_PARAMS_SEPARATOR);
        if (separator > 0) {
          const read = key.slice(0, separator + 1);
          await db
            .delete(cachedRead)
            .where(
              and(
                eq(cachedRead.membershipId, scope.membershipId),
                sql`substr(${cachedRead.key}, 1, ${read.length}) = ${read}`,
                ne(cachedRead.key, key),
              ),
            );
        }
        await db
          .insert(cachedRead)
          .values({ membershipId: scope.membershipId, key, data: JSON.stringify(value), fetchedAt })
          .onConflictDoUpdate({
            target: [cachedRead.membershipId, cachedRead.key],
            set: { data: JSON.stringify(value), fetchedAt },
          });
      });
    },
  };
}
