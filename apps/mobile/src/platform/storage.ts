import type { KeyValueStore } from '../version/index.ts';

/**
 * Encrypted storage of the device (Keychain on iOS, Keystore-backed on
 * Android): the session token, the installation id and the chosen
 * membership. Implemented by `expo-secure-store` (`secure-storage.native.ts`)
 * and by an in-memory map in tests.
 */
export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

/**
 * Plain storage for what is not secret and may be larger than a Keychain
 * entry: preferences, the cached club theme, the last version policy. Never
 * personal or health data.
 */
export interface PreferenceStorage extends KeyValueStore {
  remove(key: string): Promise<void>;
}

/** In-memory implementations, for tests and as a fallback. */
export function memorySecureStorage(initial: Record<string, string> = {}): SecureStorage & {
  readonly entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem: (key) => Promise.resolve(entries.get(key) ?? null),
    setItem: (key, value) => {
      entries.set(key, value);
      return Promise.resolve();
    },
    deleteItem: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
  };
}

export function memoryPreferenceStorage(initial: Record<string, string> = {}): PreferenceStorage & {
  readonly entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    set: (key, value) => {
      entries.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
  };
}
