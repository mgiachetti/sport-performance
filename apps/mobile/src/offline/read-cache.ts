import { and, eq } from 'drizzle-orm';
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
  get<T>(membershipId: string, key: string): Promise<CachedValue<T> | null>;
  put(scope: SyncScopeRef, key: string, value: unknown, fetchedAt: number): Promise<void>;
}

export function createReadCache(database: LocalDatabase): ReadCache {
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
        // An answer that arrives after signing out (or after another user signed in) is
        // dropped: the device holds the data of its owner only.
        const [holder] = await db
          .select({ value: deviceMeta.value })
          .from(deviceMeta)
          .where(eq(deviceMeta.key, OWNER_KEY));
        if (holder?.value !== scope.userId) return;
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
