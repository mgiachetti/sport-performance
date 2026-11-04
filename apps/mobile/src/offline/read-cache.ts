import { and, eq, like } from 'drizzle-orm';
import type { LocalDatabase } from './db/database.ts';
import { cachedRead, syncScope } from './db/schema.ts';

/** The membership a cached read belongs to (the same pair the sync scope keeps). */
export interface ReadCacheScope {
  readonly membershipId: string;
  readonly userId: string;
}

export interface CachedRead<T> {
  readonly data: T;
  /** When it was read from the server (epoch ms). */
  readonly fetchedAt: number;
}

/** The contract a cached document is checked with (a zod schema of `@sport-performance/contracts`). */
export interface ReadSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/**
 * Reads kept on the phone for offline use (ADR 0073): what a screen needs
 * that is not a sync collection, such as the sheet of a test day. Each
 * document is stored whole under its membership (deleted with it when the
 * user signs out) and validated with its contract on the way out: a
 * document an older build wrote that no longer parses is a miss, never a
 * crash.
 */
export interface ReadCache {
  get<T>(membershipId: string, key: string, schema: ReadSchema<T>): Promise<CachedRead<T> | null>;
  /** Every document whose key starts with `prefix`, by key. */
  list<T>(
    membershipId: string,
    prefix: string,
    schema: ReadSchema<T>,
  ): Promise<Map<string, CachedRead<T>>>;
  /**
   * Keeps `data` under `scope`, only while it is still the scope the device
   * syncs: a download that ends after sign-out (or a change of club) writes
   * nothing back after the wipe.
   */
  put(scope: ReadCacheScope, key: string, data: unknown): Promise<void>;
  remove(membershipId: string, key: string): Promise<void>;
}

export interface ReadCacheOptions {
  /** The scope the sync engine holds now (`null`: signed out or wiping). */
  readonly currentScope: () => ReadCacheScope | null;
  readonly now?: () => number;
}

export function createReadCache(database: LocalDatabase, options: ReadCacheOptions): ReadCache {
  const { currentScope, now = Date.now } = options;
  function parse<T>(
    row: { data: string; fetchedAt: number },
    schema: ReadSchema<T>,
  ): CachedRead<T> | null {
    let value: unknown;
    try {
      value = JSON.parse(row.data);
    } catch {
      return null;
    }
    const parsed = schema.safeParse(value);
    return parsed.success ? { data: parsed.data, fetchedAt: row.fetchedAt } : null;
  }

  return {
    get(membershipId, key, schema) {
      return database.read(async (db) => {
        const [row] = await db
          .select({ data: cachedRead.data, fetchedAt: cachedRead.fetchedAt })
          .from(cachedRead)
          .where(and(eq(cachedRead.membershipId, membershipId), eq(cachedRead.key, key)))
          .limit(1);
        return row === undefined ? null : parse(row, schema);
      });
    },
    list<T>(membershipId: string, prefix: string, schema: ReadSchema<T>) {
      return database.read(async (db) => {
        const rows = await db
          .select()
          .from(cachedRead)
          .where(
            and(eq(cachedRead.membershipId, membershipId), like(cachedRead.key, `${prefix}%`)),
          );
        const result = new Map<string, CachedRead<T>>();
        for (const row of rows) {
          // `_` and `%` in a key are wildcards of `LIKE`: the prefix is checked again.
          if (!row.key.startsWith(prefix)) continue;
          const parsed = parse(row, schema);
          if (parsed !== null) result.set(row.key, parsed);
        }
        return result;
      });
    },
    put(scope, key, data) {
      const json = JSON.stringify(data);
      const at = now();
      return database.write(async (db) => {
        // Checked inside the write: the writes are serialized, so a wipe either
        // ran before (and the scope is gone) or runs after and deletes this.
        const current = currentScope();
        if (current?.membershipId !== scope.membershipId || current.userId !== scope.userId) {
          return;
        }
        await db
          .insert(syncScope)
          .values({ membershipId: scope.membershipId, userId: scope.userId, createdAt: at })
          .onConflictDoNothing();
        await db
          .insert(cachedRead)
          .values({ membershipId: scope.membershipId, key, data: json, fetchedAt: at })
          .onConflictDoUpdate({
            target: [cachedRead.membershipId, cachedRead.key],
            set: { data: json, fetchedAt: at },
          });
      });
    },
    remove(membershipId, key) {
      return database.write(async (db) => {
        await db
          .delete(cachedRead)
          .where(and(eq(cachedRead.membershipId, membershipId), eq(cachedRead.key, key)));
      });
    },
  };
}
