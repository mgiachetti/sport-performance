import type { SecureStorage } from '../platform/storage.ts';
import { hashKioskPin, kioskLockoutMs, sameHash, type Sha256Hex } from './pin.ts';

/**
 * Kiosk mode on the device (B-504, ADR 0086): whether this device is a
 * kiosk, for which categories, under whose session and behind which PIN.
 * It lives in the secure storage so that killing the app, or restarting the
 * device, opens the kiosk again, never the staff member's app.
 */

export const KIOSK_CONFIG_KEY = 'kiosk.config';

export interface KioskCategory {
  readonly id: string;
  readonly name: string;
}

/** Whose kiosk it is: the staff member's user and membership. */
export interface KioskScope {
  readonly userId: string;
  readonly membershipId: string;
}

export interface KioskConfig {
  readonly version: 1;
  readonly scope: KioskScope;
  /**
   * SHA-256 of the session token the kiosk was opened with: another sign-in
   * (the session closed from the web, or someone else) is another session,
   * and the kiosk it finds is discarded.
   */
  readonly sessionFingerprint: string;
  readonly categories: readonly KioskCategory[];
  readonly pin: { readonly salt: string; readonly hash: string };
  /** Wrong PINs in a row. */
  readonly failedAttempts: number;
  /** Epoch ms until which the exit does not take a PIN; `null` when it does. */
  readonly lockedUntilMs: number | null;
  readonly startedAtMs: number;
}

export type KioskState =
  | { readonly status: 'loading' }
  | { readonly status: 'off' }
  | { readonly status: 'on'; readonly config: KioskConfig };

export type KioskExitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'wrong'; readonly lockedUntilMs: number | null }
  | { readonly ok: false; readonly reason: 'locked'; readonly lockedUntilMs: number };

export interface KioskController {
  readonly getState: () => KioskState;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Reads the stored kiosk and keeps it only if it belongs to `scope` (the
   * session's user and active membership) and to the current session token;
   * otherwise deletes it. `null`: nobody signed in to a club.
   */
  sync(scope: KioskScope | null): Promise<void>;
  /** Opens the kiosk for `categories` behind `pin` (already validated). */
  start(scope: KioskScope, categories: readonly KioskCategory[], pin: string): Promise<void>;
  /** Leaves the kiosk with its PIN; wrong PINs count towards the wait. */
  exit(pin: string): Promise<KioskExitResult>;
}

export interface KioskControllerOptions {
  readonly storage: SecureStorage;
  readonly sessionToken: () => Promise<string | null>;
  readonly sha256Hex: Sha256Hex;
  readonly randomUUID: () => string;
  readonly now: () => number;
  readonly reportError: (error: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** The stored config, or `null` when it is missing or not one this build wrote. */
export function parseKioskConfig(text: string | null): KioskConfig | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== 1) return null;
  const { scope, pin, categories } = value;
  if (!isRecord(scope) || !isText(scope.userId) || !isText(scope.membershipId)) return null;
  if (!isRecord(pin) || !isText(pin.salt) || !isText(pin.hash)) return null;
  if (!isText(value.sessionFingerprint)) return null;
  if (!Array.isArray(categories) || categories.length === 0) return null;
  const parsed: KioskCategory[] = [];
  for (const category of categories) {
    if (!isRecord(category) || !isText(category.id) || typeof category.name !== 'string') {
      return null;
    }
    parsed.push({ id: category.id, name: category.name });
  }
  const failed = value.failedAttempts;
  const locked = value.lockedUntilMs;
  if (typeof failed !== 'number' || !Number.isInteger(failed) || failed < 0) return null;
  if (locked !== null && typeof locked !== 'number') return null;
  if (typeof value.startedAtMs !== 'number') return null;
  return {
    version: 1,
    scope: { userId: scope.userId, membershipId: scope.membershipId },
    sessionFingerprint: value.sessionFingerprint,
    categories: parsed,
    pin: { salt: pin.salt, hash: pin.hash },
    failedAttempts: failed,
    lockedUntilMs: locked,
    startedAtMs: value.startedAtMs,
  };
}

export function createKioskController(options: KioskControllerOptions): KioskController {
  const { storage, sha256Hex } = options;
  let state: KioskState = { status: 'loading' };
  const listeners = new Set<() => void>();
  // Reads and writes in order: an exit never races the read of the launch.
  let queue: Promise<unknown> = Promise.resolve();

  function set(next: KioskState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function fingerprint(): Promise<string | null> {
    const token = await options.sessionToken();
    return token === null ? null : sha256Hex(`sport-performance:kiosk-session:v1:${token}`);
  }

  async function save(config: KioskConfig): Promise<void> {
    await storage.setItem(KIOSK_CONFIG_KEY, JSON.stringify(config));
    set({ status: 'on', config });
  }

  async function remove(): Promise<void> {
    await storage.deleteItem(KIOSK_CONFIG_KEY);
    set({ status: 'off' });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sync(scope) {
      return serial(async () => {
        try {
          const config = parseKioskConfig(await storage.getItem(KIOSK_CONFIG_KEY));
          if (config === null) {
            await remove();
            return;
          }
          const current = scope === null ? null : await fingerprint();
          const same =
            scope !== null &&
            current !== null &&
            config.scope.userId === scope.userId &&
            config.scope.membershipId === scope.membershipId &&
            sameHash(config.sessionFingerprint, current);
          if (same) set({ status: 'on', config });
          else await remove();
        } catch (error) {
          // An unreadable Keychain must not lock the staff out of their own app.
          options.reportError(error);
          set({ status: 'off' });
        }
      });
    },
    start(scope, categories, pin) {
      return serial(async () => {
        if (categories.length === 0) throw new Error('A kiosk needs at least one category');
        const session = await fingerprint();
        if (session === null) throw new Error('No session to open the kiosk with');
        const salt = options.randomUUID();
        await save({
          version: 1,
          scope,
          sessionFingerprint: session,
          categories: [...categories],
          pin: { salt, hash: await hashKioskPin(pin, salt, sha256Hex) },
          failedAttempts: 0,
          lockedUntilMs: null,
          startedAtMs: options.now(),
        });
      });
    },
    exit(pin) {
      return serial(async (): Promise<KioskExitResult> => {
        if (state.status !== 'on') return { ok: true };
        const { config } = state;
        const now = options.now();
        if (config.lockedUntilMs !== null && now < config.lockedUntilMs) {
          return { ok: false, reason: 'locked', lockedUntilMs: config.lockedUntilMs };
        }
        const hash = await hashKioskPin(pin, config.pin.salt, sha256Hex);
        if (sameHash(hash, config.pin.hash)) {
          await remove();
          return { ok: true };
        }
        const failedAttempts = config.failedAttempts + 1;
        const wait = kioskLockoutMs(failedAttempts);
        const lockedUntilMs = wait === 0 ? null : now + wait;
        await save({ ...config, failedAttempts, lockedUntilMs });
        return { ok: false, reason: 'wrong', lockedUntilMs };
      });
    },
  };
}
