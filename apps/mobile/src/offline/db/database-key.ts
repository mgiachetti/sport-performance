import type { LocalDatabase } from './database.ts';

/** A SQLCipher key as the app stores it: 256 bits in hex. */
const KEY_PATTERN = /^[0-9a-f]{64}$/;

/** Reads of the key before deciding it is not there (a Keystore that wakes up slowly). */
export const DATABASE_KEY_READ_ATTEMPTS = 3;
/** Wait before the second read; doubles for each next one. */
export const DATABASE_KEY_RETRY_BASE_MS = 250;
/**
 * A file without its key is only given up after the key was missing this
 * many times, in different launches, over at least `DATABASE_KEY_LOSS_MIN_MS`:
 * a key that is gone for good (the file restored on another phone, where a
 * `THIS_DEVICE_ONLY` item never arrives) stays gone; one that a bad moment
 * of the Keychain / Keystore hid comes back.
 */
export const DATABASE_KEY_LOSS_CONFIRMATIONS = 3;
export const DATABASE_KEY_LOSS_MIN_MS = 24 * 60 * 60_000;

/** Where the key lives (the Keychain / Keystore). `read` resolves `null` only when there is no item. */
export interface DatabaseKeyStore {
  read(): Promise<string | null>;
  write(key: string): Promise<void>;
}

/** The encrypted file. */
export interface EncryptedDatabaseFile {
  exists(): Promise<boolean>;
  open(key: string): Promise<LocalDatabase>;
  remove(): Promise<void>;
}

/**
 * Plain storage (never the secure one: it is what failed) for how many times
 * the key was missing next to an existing file.
 */
export interface KeyLossLog {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

export interface OpenEncryptedDatabaseOptions {
  readonly keys: DatabaseKeyStore;
  readonly file: EncryptedDatabaseFile;
  readonly lossLog: KeyLossLog;
  /** 32 random bytes, from a cryptographic source. */
  readonly randomBytes: () => Promise<Uint8Array>;
  readonly reportError: (error: unknown) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * The key could not be read, or it is missing next to a file that holds
 * data (maybe the queue of a day without signal): nothing is deleted. The
 * next attempt (another access, the next launch) tries again.
 */
export class LocalDatabaseKeyUnavailableError extends Error {
  readonly reason: 'unreadable' | 'missing';

  constructor(reason: 'unreadable' | 'missing', options?: { cause?: unknown }) {
    super(
      reason === 'unreadable'
        ? 'The key of the local database could not be read'
        : 'The key of the local database is missing; the file is kept',
      options,
    );
    this.name = 'LocalDatabaseKeyUnavailableError';
    this.reason = reason;
  }
}

/** The key was confirmed lost: the file that needed it was deleted and a new one created. */
export class LocalDatabaseKeyLostError extends Error {
  constructor() {
    super('The key of the local database was lost; the file was created again');
    this.name = 'LocalDatabaseKeyLostError';
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

type KeyRead =
  | { readonly kind: 'found'; readonly key: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly error: unknown };

interface LossRecord {
  readonly count: number;
  readonly firstAt: number;
}

function parseLoss(value: string | null): LossRecord | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as Partial<LossRecord>;
    if (typeof parsed.count === 'number' && typeof parsed.firstAt === 'number') {
      return { count: parsed.count, firstAt: parsed.firstAt };
    }
  } catch {
    // An unreadable record counts as none.
  }
  return null;
}

/**
 * Opens the encrypted local database (ADR 0069), telling "there is no key"
 * from "the key could not be read" before deleting anything:
 *
 * - The key is read a few times with a short wait: a rejection or a `null`
 *   that a retry fixes never reaches the decision.
 * - Read: the file opens with it. A file that does not open with its own key
 *   (written by a newer build, damaged) is deleted and created again.
 * - Unreadable on every try: `LocalDatabaseKeyUnavailableError`, nothing deleted.
 * - Missing and no file: the first use; a new key is stored, read back, and
 *   the file created.
 * - Missing next to a file: kept (`LocalDatabaseKeyUnavailableError`) until
 *   the key was missing `DATABASE_KEY_LOSS_CONFIRMATIONS` times in different
 *   launches over `DATABASE_KEY_LOSS_MIN_MS`; only then is it given up as
 *   lost (restored on another phone): deleted and created with a new key.
 *
 * The decisions are reported (never with data) so they show in Sentry.
 */
export function createEncryptedDatabaseOpener(options: OpenEncryptedDatabaseOptions) {
  const { keys, file, lossLog, reportError } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  /** One count per launch: retries within it are the same observation. */
  let lossCountedThisLaunch = false;

  async function readKey(): Promise<KeyRead> {
    let last: KeyRead = { kind: 'missing' };
    for (let attempt = 0; attempt < DATABASE_KEY_READ_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(DATABASE_KEY_RETRY_BASE_MS * 2 ** (attempt - 1));
      try {
        const stored = await keys.read();
        if (stored !== null && KEY_PATTERN.test(stored)) return { kind: 'found', key: stored };
        // A malformed value is not a key: the same as none.
        last = { kind: 'missing' };
      } catch (error) {
        last = { kind: 'unreadable', error };
      }
    }
    return last;
  }

  async function createKey(): Promise<string> {
    const fresh = toHex(await options.randomBytes());
    await keys.write(fresh);
    // Never a file encrypted with a key that did not stick.
    if ((await keys.read()) !== fresh) {
      throw new LocalDatabaseKeyUnavailableError('unreadable');
    }
    return fresh;
  }

  /** `true` when the key is confirmed lost. */
  async function recordLoss(): Promise<boolean> {
    const at = now();
    const previous = parseLoss(await lossLog.get());
    const record: LossRecord =
      previous === null
        ? { count: 1, firstAt: at }
        : { count: previous.count + (lossCountedThisLaunch ? 0 : 1), firstAt: previous.firstAt };
    lossCountedThisLaunch = true;
    await lossLog.set(JSON.stringify(record));
    return (
      record.count >= DATABASE_KEY_LOSS_CONFIRMATIONS &&
      at - record.firstAt >= DATABASE_KEY_LOSS_MIN_MS
    );
  }

  async function openWithKey(key: string): Promise<LocalDatabase> {
    try {
      return await file.open(key);
    } catch (error) {
      reportError(error);
      await file.remove();
      return file.open(key);
    }
  }

  return async function open(): Promise<LocalDatabase> {
    const read = await readKey();
    if (read.kind === 'found') {
      await lossLog.clear();
      return openWithKey(read.key);
    }
    if (read.kind === 'unreadable') {
      const error = new LocalDatabaseKeyUnavailableError('unreadable', { cause: read.error });
      reportError(error);
      throw error;
    }
    if (!(await file.exists())) {
      await lossLog.clear();
      return file.open(await createKey());
    }
    if (!(await recordLoss())) {
      const error = new LocalDatabaseKeyUnavailableError('missing');
      reportError(error);
      throw error;
    }
    reportError(new LocalDatabaseKeyLostError());
    await file.remove();
    const key = await createKey();
    await lossLog.clear();
    return file.open(key);
  };
}
