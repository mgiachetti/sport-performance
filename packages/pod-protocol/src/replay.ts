import { assertUint } from './bytes.js';
import { isAfter, type LinkCounter } from './counters.js';
import { fail } from './errors.js';

/**
 * Anti-replay state of the receiver (ADR 0106): the last accepted
 * (boot counter, frame number) per pod and key epoch. Plain JSON-able data,
 * immutable updates, so the tablet keeps it in its encrypted local database
 * and it survives app restarts.
 */
export interface ReplayState {
  readonly version: 1;
  /** Key: `"<podShortId>/<keyId>"`. */
  readonly entries: Readonly<Record<string, LinkCounter>>;
}

export function emptyReplayState(): ReplayState {
  return { version: 1, entries: {} };
}

function entryKey(podShortId: number, keyId: number): string {
  assertUint('podShortId', podShortId, 16);
  assertUint('keyId', keyId, 8);
  return `${String(podShortId)}/${String(keyId)}`;
}

export function lastAccepted(
  state: ReplayState,
  podShortId: number,
  keyId: number,
): LinkCounter | undefined {
  return state.entries[entryKey(podShortId, keyId)];
}

/**
 * Boot counter to rebuild the high bits against: the one of this epoch, or the
 * highest seen for the pod in any epoch (the boot counter is persistent and
 * does not restart with a key rotation), or the server hint.
 */
export function bootCounterReference(
  state: ReplayState,
  podShortId: number,
  keyId: number,
  serverHint?: number,
): number | undefined {
  const own = lastAccepted(state, podShortId, keyId);
  if (own) {
    return own.bootCounter;
  }
  const prefix = `${String(podShortId)}/`;
  let best = serverHint;
  for (const [key, entry] of Object.entries(state.entries)) {
    if (key.startsWith(prefix) && (best === undefined || entry.bootCounter > best)) {
      best = entry.bootCounter;
    }
  }
  return best;
}

export function isFresh(
  state: ReplayState,
  podShortId: number,
  keyId: number,
  counter: LinkCounter,
): boolean {
  const last = lastAccepted(state, podShortId, keyId);
  return last === undefined || isAfter(counter, last);
}

/** Records an accepted frame. Call only after the MIC verified. */
export function recordAccepted(
  state: ReplayState,
  podShortId: number,
  keyId: number,
  counter: LinkCounter,
): ReplayState {
  if (!isFresh(state, podShortId, keyId, counter)) {
    fail(
      'replay',
      `pod ${String(podShortId)}: (${String(counter.bootCounter)}, ${String(counter.frameNumber)}) is not newer than the last accepted`,
    );
  }
  return {
    version: 1,
    entries: {
      ...state.entries,
      [entryKey(podShortId, keyId)]: {
        bootCounter: counter.bootCounter,
        frameNumber: counter.frameNumber,
      },
    },
  };
}

/** Drops the entries of epochs no longer in use (after a rotation's overlap window). */
export function forgetEpochs(
  state: ReplayState,
  keep: (podShortId: number, keyId: number) => boolean,
): ReplayState {
  const entries: Record<string, LinkCounter> = {};
  for (const [key, entry] of Object.entries(state.entries)) {
    const [pod, epoch] = key.split('/').map(Number);
    if (pod !== undefined && epoch !== undefined && keep(pod, epoch)) {
      entries[key] = entry;
    }
  }
  return { version: 1, entries };
}

export function serializeReplayState(state: ReplayState): string {
  return JSON.stringify(state);
}

/** Strict parse: anything unexpected throws rather than silently resetting the window. */
export function parseReplayState(json: string): ReplayState {
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) {
    fail('field_out_of_range', 'replay state must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.entries !== 'object' || record.entries === null) {
    fail('unsupported_version', 'replay state must be version 1 with entries');
  }
  const entries: Record<string, LinkCounter> = {};
  for (const [key, raw] of Object.entries(record.entries as Record<string, unknown>)) {
    const match = /^(\d+)\/(\d+)$/.exec(key);
    if (!match) {
      fail('field_out_of_range', `bad replay entry key ${key}`);
    }
    entryKey(Number(match[1]), Number(match[2]));
    const entry = raw as Partial<LinkCounter> | null;
    const bootCounter = entry?.bootCounter;
    const frameNumber = entry?.frameNumber;
    if (typeof bootCounter !== 'number' || typeof frameNumber !== 'number') {
      fail('field_out_of_range', `bad replay entry ${key}`);
    }
    assertUint('bootCounter', bootCounter, 32);
    assertUint('frameNumber', frameNumber, 16);
    entries[key] = { bootCounter, frameNumber };
  }
  return { version: 1, entries };
}
