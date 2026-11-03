import {
  membershipListSchema,
  sessionUserSchema,
  type MembershipSummary,
  type SessionUser,
} from '@sport-performance/contracts';
import type { SecureStorage } from '../platform/storage.ts';

/** Keys in the secure storage (ADR 0058). */
export const SESSION_TOKEN_KEY = 'auth.session_token';
export const DEVICE_ID_KEY = 'auth.device_id';
export const MEMBERSHIP_ID_KEY = 'auth.membership_id';
export const SESSION_SNAPSHOT_KEY = 'auth.session_snapshot';

/** The user as kept on the device: no email (shown only when online). */
export type StoredUser = Omit<SessionUser, 'email'>;

/**
 * What the app needs to open without signal (product principle 5): who is
 * signed in and their memberships, from the last time the server answered.
 */
export interface SessionSnapshot {
  readonly user: StoredUser;
  readonly memberships: readonly MembershipSummary[];
}

const storedUserSchema = sessionUserSchema.omit({ email: true });

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionStore {
  getToken(): Promise<string | null>;
  /** Saves a new session: the token, and forgets the club chosen by a previous user. */
  saveSession(token: string): Promise<void>;
  /**
   * Forgets the session, the chosen club and the snapshot. The installation
   * id stays: it identifies the device, not the user (ADR 0033).
   */
  clear(): Promise<void>;
  /** Random UUID of this installation, created on first use (`deviceId` of the sign-in). */
  getDeviceId(): Promise<string>;
  getMembershipId(): Promise<string | null>;
  setMembershipId(membershipId: string | null): Promise<void>;
  getSnapshot(): Promise<SessionSnapshot | null>;
  /** Best effort: a failing write only costs not opening offline next time. */
  saveSnapshot(snapshot: SessionSnapshot): Promise<void>;
}

export interface SessionStoreOptions {
  readonly storage: SecureStorage;
  /** `expo-crypto`'s `randomUUID` on the device. */
  readonly randomUUID: () => string;
}

export function createSessionStore({ storage, randomUUID }: SessionStoreOptions): SessionStore {
  let deviceId: Promise<string> | null = null;

  async function readDeviceId(): Promise<string> {
    const stored = await storage.getItem(DEVICE_ID_KEY);
    if (stored !== null && UUID_PATTERN.test(stored)) return stored;
    const created = randomUUID();
    await storage.setItem(DEVICE_ID_KEY, created);
    return created;
  }

  return {
    getToken: () => storage.getItem(SESSION_TOKEN_KEY),
    async saveSession(token) {
      if (token === '') throw new Error('Empty session token');
      await storage.setItem(SESSION_TOKEN_KEY, token);
      await storage.deleteItem(MEMBERSHIP_ID_KEY);
      await storage.deleteItem(SESSION_SNAPSHOT_KEY);
    },
    async clear() {
      // Each key on its own: a failure on one must not leave the token behind.
      const results = await Promise.allSettled([
        storage.deleteItem(SESSION_TOKEN_KEY),
        storage.deleteItem(MEMBERSHIP_ID_KEY),
        storage.deleteItem(SESSION_SNAPSHOT_KEY),
      ]);
      const failed = results.find((result) => result.status === 'rejected');
      if (failed !== undefined) throw failed.reason;
    },
    getDeviceId() {
      // One promise per process, so two parallel sign-ins never create two ids.
      deviceId ??= readDeviceId().catch((error: unknown) => {
        deviceId = null;
        throw error;
      });
      return deviceId;
    },
    getMembershipId: () => storage.getItem(MEMBERSHIP_ID_KEY),
    async setMembershipId(membershipId) {
      if (membershipId === null) await storage.deleteItem(MEMBERSHIP_ID_KEY);
      else await storage.setItem(MEMBERSHIP_ID_KEY, membershipId);
    },
    async getSnapshot() {
      let raw: string | null;
      try {
        raw = await storage.getItem(SESSION_SNAPSHOT_KEY);
      } catch {
        return null;
      }
      return parseSnapshot(raw);
    },
    async saveSnapshot(snapshot) {
      try {
        await storage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify(snapshot));
      } catch {
        // See the interface.
      }
    },
  };
}

/** `null` when missing or not valid anymore (an older app version wrote it). */
export function parseSnapshot(raw: string | null): SessionSnapshot | null {
  if (raw === null || raw === '') return null;
  try {
    const value = JSON.parse(raw) as { user?: unknown; memberships?: unknown };
    const user = storedUserSchema.safeParse(value.user);
    const memberships = membershipListSchema.safeParse({ items: value.memberships });
    if (!user.success || !memberships.success) return null;
    return { user: user.data, memberships: memberships.data.items };
  } catch {
    return null;
  }
}

/** The snapshot to keep from what the server answered. */
export function snapshotOf(
  user: SessionUser,
  memberships: readonly MembershipSummary[],
): SessionSnapshot {
  return {
    user: { id: user.id, name: user.name, isSuperadmin: user.isSuperadmin },
    memberships,
  };
}
