import {
  IFT_3015_OUTCOMES,
  assertIft3015SignalProtocol,
  type Ift3015Outcome,
  type Ift3015PlayerMarks,
  type Ift3015SignalProtocol,
} from '@sport-performance/domain';
import type { SecureStorage } from '../platform/storage.ts';

/** Whose run it is: another user or club on the same phone never sees it. */
export interface IftRunScope {
  readonly userId: string;
  readonly membershipId: string;
}

/**
 * What survives the app being killed mid-test (ADR 0070): the protocol, when
 * stage 1 started on the wall clock and every mark. Ids and numbers only, no
 * names: the screen reads them again from the roster.
 */
export interface IftRunSnapshot {
  readonly version: 1;
  readonly scope: IftRunScope;
  readonly runId: string;
  readonly categoryId: string | null;
  /**
   * The field test day it was started from (B-505, ADR 0074), or `null` when
   * started from Inicio: only that day's 30-15 station can record its stages.
   */
  readonly testSessionId: string | null;
  /**
   * Players whose stage the day's 30-15 station already queued (B-505): the
   * run is kept until the staff dismisses it, and these are never queued twice.
   */
  readonly savedPlayerIds: readonly string[];
  readonly protocol: Ift3015SignalProtocol;
  /** Wall-clock time (ms since 1970) of the start of stage 1. */
  readonly stage1WallMs: number;
  readonly status: 'running' | 'finished';
  /**
   * Wall-clock time of the last moment the run was known to be playing (a
   * heartbeat while it runs): an interrupted run ends there, never at the
   * moment it is reopened.
   */
  readonly lastAliveWallMs: number;
  /** When the test ended, in ms from the start of stage 1. */
  readonly endedAtMs: number | null;
  /**
   * Why it ended: the last stage ran out, the staff ended it, or it was ended
   * after the app was killed (its stages need a check by the staff).
   */
  readonly endedBy: IftRunEnd | null;
  readonly players: readonly Ift3015PlayerMarks[];
}

export const IFT_RUN_ENDS = ['schedule', 'staff', 'interrupted'] as const;
export type IftRunEnd = (typeof IFT_RUN_ENDS)[number];

export function sameIftRunScope(a: IftRunScope, b: IftRunScope): boolean {
  return a.userId === b.userId && a.membershipId === b.membershipId;
}

export interface IftRunStore {
  load(): Promise<IftRunSnapshot | null>;
  save(snapshot: IftRunSnapshot): Promise<void>;
  clear(): Promise<void>;
  /**
   * Deletes the stored run unless it belongs to `scope` (`null`: nobody is
   * signed in to a club), in order with the other writes.
   */
  clearUnlessScope(scope: IftRunScope | null): Promise<void>;
}

/** Key in the secure storage of the device. */
export const IFT_RUN_STORAGE_KEY = 'ift3015.run';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStage = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseMarks(value: unknown): Ift3015PlayerMarks | null {
  if (!isRecord(value)) return null;
  const { playerId, misses, outcome, lastCompletedStage, endedAtMs, adjustedStage } = value;
  if (!isString(playerId)) return null;
  if (!Array.isArray(misses) || !misses.every(isStage)) return null;
  if (!(IFT_3015_OUTCOMES as readonly unknown[]).includes(outcome)) return null;
  if (lastCompletedStage !== null && !isStage(lastCompletedStage)) return null;
  if (endedAtMs !== null && !isFiniteNumber(endedAtMs)) return null;
  if (adjustedStage !== null && !isStage(adjustedStage)) return null;
  return {
    playerId,
    misses,
    outcome: outcome as Ift3015Outcome,
    lastCompletedStage,
    endedAtMs,
    adjustedStage,
  };
}

function parseProtocol(value: unknown): Ift3015SignalProtocol | null {
  if (!isRecord(value)) return null;
  const protocol = value as unknown as Ift3015SignalProtocol;
  try {
    assertIft3015SignalProtocol(protocol);
    return protocol;
  } catch {
    return null;
  }
}

/** A stored snapshot, or `null` if it is not one this version of the app wrote. */
export function parseIftRunSnapshot(text: string | null): IftRunSnapshot | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== 1) return null;
  const { scope, runId, categoryId, stage1WallMs, status, lastAliveWallMs, endedAtMs, endedBy } =
    value;
  if (!isRecord(scope) || !isString(scope.userId) || !isString(scope.membershipId)) return null;
  if (!isString(runId) || (categoryId !== null && !isString(categoryId))) return null;
  // Absent in runs stored before B-505: started outside any test day.
  const testSessionId = value.testSessionId ?? null;
  if (testSessionId !== null && !isString(testSessionId)) return null;
  const savedPlayerIds = value.savedPlayerIds ?? [];
  if (!Array.isArray(savedPlayerIds) || !savedPlayerIds.every(isString)) return null;
  if (!isFiniteNumber(stage1WallMs)) return null;
  if (status !== 'running' && status !== 'finished') return null;
  if (!isFiniteNumber(lastAliveWallMs)) return null;
  if (endedAtMs !== null && !isFiniteNumber(endedAtMs)) return null;
  if (endedBy !== null && !(IFT_RUN_ENDS as readonly unknown[]).includes(endedBy)) return null;
  const protocol = parseProtocol(value.protocol);
  if (protocol === null || !Array.isArray(value.players)) return null;
  const players = value.players.map(parseMarks);
  if (players.some((marks) => marks === null)) return null;
  return {
    version: 1,
    scope: { userId: scope.userId, membershipId: scope.membershipId },
    runId,
    categoryId,
    testSessionId,
    savedPlayerIds,
    protocol,
    stage1WallMs,
    status,
    lastAliveWallMs,
    endedAtMs,
    endedBy: endedBy as IftRunEnd | null,
    players: players as Ift3015PlayerMarks[],
  };
}

/**
 * The run in the secure storage (Keychain / Keystore): test data of minors
 * never goes to plain storage (ADR 0058). One run per device; writes are
 * applied in order.
 */
export function createSecureIftRunStore(storage: SecureStorage): IftRunStore {
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };
  const read = async () => parseIftRunSnapshot(await storage.getItem(IFT_RUN_STORAGE_KEY));
  return {
    load: async () => {
      await queue;
      return read();
    },
    save: (snapshot) =>
      enqueue(() => storage.setItem(IFT_RUN_STORAGE_KEY, JSON.stringify(snapshot))),
    clear: () => enqueue(() => storage.deleteItem(IFT_RUN_STORAGE_KEY)),
    clearUnlessScope: (scope) =>
      enqueue(async () => {
        if ((await storage.getItem(IFT_RUN_STORAGE_KEY)) === null) return;
        const snapshot = await read();
        if (snapshot !== null && scope !== null && sameIftRunScope(snapshot.scope, scope)) return;
        await storage.deleteItem(IFT_RUN_STORAGE_KEY);
      }),
  };
}
