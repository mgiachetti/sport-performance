import { describe, expect, it } from 'vitest';
import type { LocalDatabase } from './database.ts';
import { reopeningLocalDatabase } from './database.ts';
import {
  DATABASE_KEY_LOSS_CONFIRMATIONS,
  DATABASE_KEY_LOSS_MIN_MS,
  LocalDatabaseKeyLostError,
  LocalDatabaseKeyUnavailableError,
  createEncryptedDatabaseOpener,
} from './database-key.ts';

const KEY = 'a'.repeat(64);
const HOUR_MS = 60 * 60_000;

/**
 * The Keychain / Keystore, the file and the plain preference of one phone,
 * across launches: `reads` scripts what each read of the key answers
 * (`'stored'`, `null` for "no item", or an error) before it behaves.
 */
function phone(options: { key?: string | null; fileExists?: boolean } = {}) {
  let storedKey = options.key === undefined ? KEY : options.key;
  let fileKey: string | null = options.fileExists === false ? null : storedKey;
  let lossLog: string | null = null;
  let time = Date.UTC(2026, 10, 3, 12);
  const reads: ('stored' | null | Error)[] = [];
  const events: string[] = [];
  const errors: unknown[] = [];
  const database = { name: 'db' } as unknown as LocalDatabase;

  function launch() {
    return createEncryptedDatabaseOpener({
      keys: {
        read: () => {
          const next = reads.length === 0 ? 'stored' : reads.shift();
          if (next instanceof Error) return Promise.reject(next);
          return Promise.resolve(next === 'stored' ? storedKey : null);
        },
        write: (key) => {
          events.push('write-key');
          storedKey = key;
          return Promise.resolve();
        },
      },
      file: {
        exists: () => Promise.resolve(fileKey !== null),
        open: (key) => {
          if (fileKey !== null && fileKey !== key) {
            return Promise.reject(new Error('file is not a database'));
          }
          events.push('open');
          fileKey = key;
          return Promise.resolve(database);
        },
        remove: () => {
          events.push('remove');
          fileKey = null;
          return Promise.resolve();
        },
      },
      lossLog: {
        get: () => Promise.resolve(lossLog),
        set: (value) => {
          lossLog = value;
          return Promise.resolve();
        },
        clear: () => {
          lossLog = null;
          return Promise.resolve();
        },
      },
      randomBytes: () => Promise.resolve(new Uint8Array(32).fill(0xbb)),
      reportError: (error) => errors.push(error),
      now: () => time,
      sleep: () => Promise.resolve(),
    });
  }

  return {
    launch,
    reads,
    events,
    errors,
    database,
    advance: (ms: number) => {
      time += ms;
    },
    fileKey: () => fileKey,
    storedKey: () => storedKey,
    loseKey: () => {
      storedKey = null;
    },
    setFileKey: (key: string) => {
      fileKey = key;
    },
  };
}

describe('the key of the local database', () => {
  it('creates a key and the file on first use', async () => {
    const device = phone({ key: null, fileExists: false });
    await expect(device.launch()()).resolves.toBe(device.database);
    expect(device.storedKey()).toBe('bb'.repeat(32));
    expect(device.fileKey()).toBe('bb'.repeat(32));
    expect(device.events).toEqual(['write-key', 'open']);
  });

  it('keeps the file and its queue when SecureStore answers null for a moment', async () => {
    const device = phone();
    device.reads.push(null, null);
    await expect(device.launch()()).resolves.toBe(device.database);
    expect(device.events).toEqual(['open']);
    expect(device.fileKey()).toBe(KEY);
    expect(device.storedKey()).toBe(KEY);
  });

  it('never deletes the file nor writes a key when every read of the launch answers null', async () => {
    const device = phone();
    device.reads.push(null, null, null);
    await expect(device.launch()()).rejects.toBeInstanceOf(LocalDatabaseKeyUnavailableError);
    expect(device.events).toEqual([]);
    expect(device.fileKey()).toBe(KEY);
    expect(device.storedKey()).toBe(KEY);
    // The key comes back: the same file opens with its queue.
    await expect(device.launch()()).resolves.toBe(device.database);
    expect(device.events).toEqual(['open']);
  });

  it('never deletes the file when the key cannot be read', async () => {
    const device = phone();
    device.reads.push(new Error('User interaction is not allowed'), null, new Error('locked'));
    const failure = await device
      .launch()()
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LocalDatabaseKeyUnavailableError);
    expect((failure as LocalDatabaseKeyUnavailableError).reason).toBe('unreadable');
    expect(device.events).toEqual([]);
    expect(device.errors).toEqual([failure]);
  });

  it('gives a missing key up as lost only after several launches over a day', async () => {
    const device = phone();
    device.loseKey();
    const open = device.launch();
    // Retries within one launch are one observation.
    for (let i = 0; i < DATABASE_KEY_LOSS_CONFIRMATIONS + 1; i += 1) {
      await expect(open()).rejects.toBeInstanceOf(LocalDatabaseKeyUnavailableError);
    }
    for (let launch = 1; launch < DATABASE_KEY_LOSS_CONFIRMATIONS; launch += 1) {
      device.advance(HOUR_MS);
      await expect(device.launch()()).rejects.toBeInstanceOf(LocalDatabaseKeyUnavailableError);
    }
    // Enough launches, but not a day yet.
    expect(device.events).toEqual([]);
    device.advance(DATABASE_KEY_LOSS_MIN_MS);
    await expect(device.launch()()).resolves.toBe(device.database);
    expect(device.events).toEqual(['remove', 'write-key', 'open']);
    expect(device.errors.at(-1)).toBeInstanceOf(LocalDatabaseKeyLostError);
    expect(device.fileKey()).toBe('bb'.repeat(32));
  });

  it('starts counting again once the key is read', async () => {
    const device = phone();
    device.reads.push(null, null, null);
    await expect(device.launch()()).rejects.toBeInstanceOf(LocalDatabaseKeyUnavailableError);
    await expect(device.launch()()).resolves.toBe(device.database);
    device.advance(2 * DATABASE_KEY_LOSS_MIN_MS);
    for (let launch = 0; launch < DATABASE_KEY_LOSS_CONFIRMATIONS - 1; launch += 1) {
      device.reads.push(null, null, null);
      await expect(device.launch()()).rejects.toBeInstanceOf(LocalDatabaseKeyUnavailableError);
    }
    expect(device.events).toEqual(['open']);
  });

  it('creates the file again when it does not open with its own key', async () => {
    const device = phone();
    // Written by a newer build that an update rolled back, or damaged.
    device.setFileKey('c'.repeat(64));
    await expect(device.launch()()).resolves.toBe(device.database);
    expect(device.events).toEqual(['remove', 'open']);
    expect(device.fileKey()).toBe(KEY);
    expect(device.errors).toHaveLength(1);
  });
});

describe('a database that failed to open', () => {
  it('is opened again by a later access, at most once per wait', async () => {
    let time = 0;
    let attempts = 0;
    let fail = true;
    const database = {
      read: (task: (db: never) => Promise<unknown>) => task(undefined as never),
      write: (task: (db: never) => Promise<unknown>) => task(undefined as never),
      close: () => Promise.resolve(),
    } as unknown as LocalDatabase;
    const reopening = reopeningLocalDatabase(
      () => {
        attempts += 1;
        return fail
          ? Promise.reject(new LocalDatabaseKeyUnavailableError('unreadable'))
          : Promise.resolve(database);
      },
      { now: () => time, retryAfterMs: 5_000 },
    );
    await expect(reopening.read(() => Promise.resolve(1))).rejects.toBeInstanceOf(
      LocalDatabaseKeyUnavailableError,
    );
    time += 4_999;
    await expect(reopening.read(() => Promise.resolve(1))).rejects.toBeInstanceOf(
      LocalDatabaseKeyUnavailableError,
    );
    expect(attempts).toBe(1);
    fail = false;
    time += 1;
    await expect(reopening.write(() => Promise.resolve(2))).resolves.toBe(2);
    await expect(reopening.read(() => Promise.resolve(3))).resolves.toBe(3);
    expect(attempts).toBe(2);
  });
});
