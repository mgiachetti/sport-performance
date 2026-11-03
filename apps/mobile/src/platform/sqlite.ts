import { getRandomBytesAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { openLocalDatabase, type LocalDatabase } from '../offline/db/database.ts';
import type { SqlDriver, SqlValue } from '../offline/db/driver.ts';

/** The one database file of the installation (ADR 0065). */
export const LOCAL_DATABASE_NAME = 'sport-performance.db';
/** Keychain / Keystore item with the SQLCipher key of the file. */
const DATABASE_KEY_ITEM = 'localDatabaseKey';

/** Same protection as the session token: readable in the background, never in a backup (ADR 0058). */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The 256-bit key of the file, created on first use; it never leaves the secure storage. */
async function databaseKey(): Promise<string> {
  const stored = await SecureStore.getItemAsync(DATABASE_KEY_ITEM, SECURE_OPTIONS);
  if (stored !== null && /^[0-9a-f]{64}$/.test(stored)) return stored;
  const fresh = toHex(await getRandomBytesAsync(32));
  await SecureStore.setItemAsync(DATABASE_KEY_ITEM, fresh, SECURE_OPTIONS);
  return fresh;
}

function expoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    exec: (source) => db.execAsync(source),
    async query(sql, params) {
      const statement = await db.prepareAsync(sql);
      try {
        const result = await statement.executeForRawResultAsync(params as SQLite.SQLiteBindValue[]);
        const rows = (await result.getAllAsync()) as unknown as SqlValue[][];
        return { rows, changes: result.changes };
      } finally {
        await statement.finalizeAsync();
      }
    },
    close: () => db.closeAsync(),
  };
}

async function open(key: string): Promise<LocalDatabase> {
  const db = await SQLite.openDatabaseAsync(LOCAL_DATABASE_NAME);
  try {
    // SQLCipher (`useSQLCipher` in the config plugin): the key comes before anything else.
    await db.execAsync(`PRAGMA key = "x'${key}'"`);
    return await openLocalDatabase(expoDriver(db));
  } catch (error) {
    await db.closeAsync().catch(() => undefined);
    throw error;
  }
}

/**
 * Opens the encrypted local database. A file that cannot be opened (its key
 * did not survive a restore to another phone, or a newer build wrote it and
 * an update rolled back) is deleted and created again: the server has
 * everything but what was queued, and the alternative is an app that never
 * opens. The error is reported (never with data) so it shows in Sentry.
 */
export async function openNativeLocalDatabase(
  reportError: (error: unknown) => void,
): Promise<LocalDatabase> {
  const key = await databaseKey();
  try {
    return await open(key);
  } catch (error) {
    reportError(error);
    await SQLite.deleteDatabaseAsync(LOCAL_DATABASE_NAME);
    return open(key);
  }
}
