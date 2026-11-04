import { randomUUID } from 'node:crypto';
import type {
  Participation,
  SyncChange,
  SyncMutation,
  SyncMutationResult,
  Wellness,
} from '@sport-performance/contracts';
import {
  SYNC_COLLECTIONS,
  formatHlc,
  serverHlc,
  type SyncCollection,
} from '@sport-performance/domain';
import { apiError, validationFailed, type FakeApi, type FakeResponse } from './fake-api.ts';

export const T0 = Date.UTC(2026, 10, 3, 12, 0, 0);
export const PLAYER_ID = 'b1111111-1111-4111-8111-111111111111';
export const SESSION_ID = 'c1111111-1111-4111-8111-111111111111';

export function uuid(): string {
  return randomUUID();
}

export function wellnessDto(
  overrides: { readonly [K in keyof Wellness]?: unknown } = {},
): Wellness {
  return {
    id: uuid(),
    playerId: PLAYER_ID,
    localDate: '2026-11-03',
    itemCount: 5,
    items: ['sleep', 'fatigue', 'soreness', 'stress', 'mood'],
    scores: { sleep: 4, fatigue: 4, soreness: 4, stress: 4, mood: 4 },
    meanScore: 4,
    submittedAt: '2026-11-03T11:00:00.000Z',
    channel: 'player_account',
    createdAt: '2026-11-03T11:00:00.000Z',
    updatedAt: '2026-11-03T11:00:00.000Z',
    version: 'v1',
    ...overrides,
  } as Wellness;
}

export function participationDto(
  overrides: { readonly [K in keyof Participation]?: unknown } = {},
): Participation {
  return {
    id: uuid(),
    trainingSessionId: SESSION_ID,
    playerId: PLAYER_ID,
    status: 'full',
    minutes: 60,
    contactsN: null,
    rpe: null,
    rpeReportedAt: null,
    rpeChannel: null,
    srpeAu: null,
    createdAt: '2026-11-03T11:00:00.000Z',
    updatedAt: '2026-11-03T11:00:00.000Z',
    version: 'v1',
    ...overrides,
  } as Participation;
}

export function upsert<C extends 'wellness' | 'participation'>(
  collection: C,
  data: C extends 'wellness' ? Wellness : Participation,
  clientUuid: string | null = null,
): SyncChange {
  return { collection, op: 'upsert', id: data.id, clientUuid, data } as SyncChange;
}

export function tombstone(collection: SyncCollection, id: string): SyncChange {
  return { collection, op: 'delete', id, clientUuid: null, data: null } as SyncChange;
}

type Decision = Partial<Omit<SyncMutationResult, 'mutationId' | 'op'>>;
type Failure = FakeResponse | 'network-error';

/**
 * The server side of ADR 0050 in memory, over the fake API: a push answers
 * every mutation `applied` (or what `decide` says) and remembers its
 * `mutationId`s (`replayed` on a resend); a pull pages a change log by
 * cursor (`c:<position>`), with a reset on demand.
 */
export function createFakeSyncServer(api: FakeApi, options: { serverTimeMs?: number } = {}) {
  const log: SyncChange[] = [];
  const pushes: SyncMutation[][] = [];
  const pulls: { cursor: string | null; limit: number; collections: string | null }[] = [];
  const applied = new Set<string>();
  const pushFailures: Failure[] = [];
  const pullFailures: Failure[] = [];
  let decide: (mutation: SyncMutation) => Decision | undefined = () => undefined;
  let resetNext = false;
  let refuse: (mutation: SyncMutation) => boolean = () => false;
  let hlc = formatHlc(serverHlc(options.serverTimeMs ?? T0));

  api.on('POST /v1/sync/push', (request) => {
    const failure = pushFailures.shift();
    const { mutations } = request.body as { mutations: SyncMutation[] };
    pushes.push(mutations);
    if (failure !== undefined) {
      // A lost answer: the server applied the push, the device never heard.
      if (failure === 'network-error') for (const m of mutations) applied.add(m.mutationId);
      return failure;
    }
    // The envelope of one mutation no longer valid: the whole push is a `400`.
    const refused = mutations.findIndex((m) => refuse(m));
    if (refused !== -1) return validationFailed(['body', 'mutations', refused, 'body']);
    const results: SyncMutationResult[] = mutations.map((m) => {
      const base: SyncMutationResult = {
        mutationId: m.mutationId,
        op: m.op,
        status: 'applied',
        hlc: m.hlc,
        clamped: false,
        appliedFields: [],
        supersededFields: [],
        firstOutcome: null,
        error: null,
      };
      if (applied.has(m.mutationId)) {
        return { ...base, status: 'replayed', firstOutcome: 'applied' };
      }
      const decision = { ...base, ...decide(m) };
      if (decision.status !== 'rejected') applied.add(m.mutationId);
      return decision;
    });
    return { status: 200, body: { serverHlc: hlc, results } };
  });

  api.on('GET /v1/sync/changes', (request) => {
    const failure = pullFailures.shift();
    if (failure !== undefined) return failure;
    const cursor = request.query.get('cursor');
    const limit = Number(request.query.get('limit') ?? '200');
    pulls.push({ cursor, limit, collections: request.query.get('collections') });
    if (cursor !== null && !/^c:\d+$/.test(cursor)) {
      return apiError(400, 'bad_request');
    }
    const reset = resetNext;
    resetNext = false;
    const from = reset || cursor === null ? 0 : Number(cursor.slice(2));
    const items = log.slice(from, from + limit);
    const next = from + items.length;
    return {
      status: 200,
      body: {
        items,
        cursor: `c:${String(next)}`,
        hasMore: next < log.length,
        reset,
        collections: [...SYNC_COLLECTIONS],
        serverHlc: hlc,
      },
    };
  });

  return {
    log,
    pushes,
    pulls,
    publish(...changes: SyncChange[]) {
      log.push(...changes);
    },
    decide(next: (mutation: SyncMutation) => Decision | undefined) {
      decide = next;
    },
    failPush(...failures: Failure[]) {
      pushFailures.push(...failures);
    },
    failPull(...failures: Failure[]) {
      pullFailures.push(...failures);
    },
    refuseWhole(predicate: (mutation: SyncMutation) => boolean) {
      refuse = predicate;
    },
    resetNext() {
      resetNext = true;
    },
    setServerTime(ms: number) {
      hlc = formatHlc(serverHlc(ms));
    },
  };
}

export type FakeSyncServer = ReturnType<typeof createFakeSyncServer>;
