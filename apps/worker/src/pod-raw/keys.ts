import { isUuid, type ClubId } from '@sport-performance/domain';

/**
 * Where the worker gets each club's master key of the pods (ADR 0106): the
 * storage keys of a pod are derived from it with the pod's `DEVICEID` and the
 * key epoch, so the worker can decode a `pod_raw`. Injectable: the
 * environment's provider below, test keys in tests. A real key is never
 * committed, logged or stored next to the data it protects.
 */
export interface PodKeyProvider {
  /** The club's 32-byte master key, or `null` when the club has none configured. */
  masterKey(clubId: ClubId): Promise<Uint8Array | null>;
}

export const MASTER_KEY_BYTES = 32;

/**
 * `POD_MASTER_KEYS`: `<club uuid>:<base64 of 32 bytes>` pairs separated by
 * commas. Returns the problems (never a key) or the parsed map.
 */
export function parsePodMasterKeys(
  value: string,
): { ok: true; keys: ReadonlyMap<string, string> } | { ok: false; problem: string } {
  const keys = new Map<string, string>();
  for (const entry of value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')) {
    const separator = entry.indexOf(':');
    // Ids are compared lowercase (Postgres prints uuids lowercase); a key wrapped by `base64`
    // or pasted with spaces keeps only its characters.
    const clubId = entry.slice(0, separator).trim().toLowerCase();
    const key = entry.slice(separator + 1).replace(/\s+/g, '');
    if (separator < 1 || !isUuid(clubId)) {
      return { ok: false, problem: 'every entry is <club uuid>:<base64 key>' };
    }
    if (
      !/^[A-Za-z0-9+/]+={0,2}$/.test(key) ||
      Buffer.from(key, 'base64').length !== MASTER_KEY_BYTES
    ) {
      return { ok: false, problem: `every key is ${String(MASTER_KEY_BYTES)} bytes in base64` };
    }
    if (keys.has(clubId)) return { ok: false, problem: 'a club appears twice' };
    keys.set(clubId, key);
  }
  return { ok: true, keys };
}

/** The provider of keys from the environment (`POD_MASTER_KEYS`, parsed by the config). */
export function staticPodKeyProvider(keys: ReadonlyMap<string, string>): PodKeyProvider {
  return {
    masterKey: (clubId) => {
      const key = keys.get(clubId.toLowerCase());
      return Promise.resolve(key === undefined ? null : new Uint8Array(Buffer.from(key, 'base64')));
    },
  };
}
