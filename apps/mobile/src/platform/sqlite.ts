import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRandomBytesAsync } from 'expo-crypto';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { openLocalDatabase, type LocalDatabase } from '../offline/db/database.ts';
import { createEncryptedDatabaseOpener } from '../offline/db/database-key.ts';
import type { SqlDriver, SqlValue } from '../offline/db/driver.ts';

/** The one database file of the installation (ADR 0069). */
export const LOCAL_DATABASE_NAME = 'sport-performance.db';
/** Keychain / Keystore item with the SQLCipher key of the file. */
const DATABASE_KEY_ITEM = 'localDatabaseKey';
/** Plain preference: how many launches found the file without its key (ADR 0069). */
const KEY_LOSS_PREFERENCE = 'localDatabase.keyLoss';

/** Same protection as the session token: readable in the background, never in a backup (ADR 0058). */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

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

/** The database file, in the directory `expo-sqlite` opens it from. */
function databaseFile(): File {
  const directory = String(SQLite.defaultDatabaseDirectory);
  const uri = directory.startsWith('file:') ? directory : `file://${directory}`;
  return new File(uri, LOCAL_DATABASE_NAME);
}

/**
 * Opens the encrypted local database (ADR 0069). The SQLCipher key lives in
 * the Keychain / Keystore; a file is deleted only when it does not open with
 * its own key, or when its key was confirmed lost (`createEncryptedDatabaseOpener`):
 * a key that could not be read for a moment never costs the queue.
 */
export function nativeLocalDatabaseOpener(
  reportError: (error: unknown) => void,
): () => Promise<LocalDatabase> {
  return createEncryptedDatabaseOpener({
    keys: {
      read: () => SecureStore.getItemAsync(DATABASE_KEY_ITEM, SECURE_OPTIONS),
      write: (key) => SecureStore.setItemAsync(DATABASE_KEY_ITEM, key, SECURE_OPTIONS),
    },
    file: {
      // In the executor: a path the file system refuses is a rejection, never "no file".
      exists: () =>
        new Promise((resolve) => {
          resolve(databaseFile().exists);
        }),
      open,
      remove: () => SQLite.deleteDatabaseAsync(LOCAL_DATABASE_NAME),
    },
    lossLog: {
      get: () => AsyncStorage.getItem(KEY_LOSS_PREFERENCE),
      set: (value) => AsyncStorage.setItem(KEY_LOSS_PREFERENCE, value),
      clear: () => AsyncStorage.removeItem(KEY_LOSS_PREFERENCE),
    },
    randomBytes: () => getRandomBytesAsync(32),
    reportError,
  });
}

let nativeOpener: (() => Promise<LocalDatabase>) | null = null;

/** Opens the encrypted local database; an open that failed can be tried again (one opener per launch). */
export function openNativeLocalDatabase(
  reportError: (error: unknown) => void,
): Promise<LocalDatabase> {
  nativeOpener ??= nativeLocalDatabaseOpener(reportError);
  return nativeOpener();
}
