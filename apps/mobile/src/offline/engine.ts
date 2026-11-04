import {
  ApiContractError,
  ApiError,
  ApiNetworkError,
  MEMBERSHIP_HEADER,
  type ApiClient,
  type SyncMutation,
  type SyncMutationResult,
  type SyncOperationInput,
  type SyncOperationRequest,
  type ValidationIssue,
} from '@sport-performance/contracts';
import {
  SYNC_PULL_LIMIT_MAX,
  SYNC_PUSH_MAX,
  type SyncCollection,
  type SyncOperation,
} from '@sport-performance/domain';
import { and, asc, count, desc, eq, inArray, lte, ne } from 'drizzle-orm';
import { syncRetryDelayMs } from './backoff.ts';
import { createDeviceClock, type DeviceClock } from './clock.ts';
import type { LocalDatabase, LocalDb } from './db/database.ts';
import { deviceMeta, mutation, syncIssue, syncScope, type SyncIssueKind } from './db/schema.ts';
import {
  applyChange,
  createLocalStore,
  deleteCollections,
  toQueuedMutation,
  type LocalStore,
  type QueuedMutation,
  type StoredTarget,
} from './local-store.ts';
import { forgetsOnAck, matchesTarget, prepareMutation, type TargetableRow } from './operations.ts';

/** The membership the device syncs: what `X-Membership-Id` names. */
export interface SyncScopeRef {
  readonly membershipId: string;
  readonly userId: string;
}

/**
 * What the indicator shows (ADR 0069):
 * - `idle`: nothing running; `pendingCount` says whether something waits.
 * - `syncing`: a cycle is running.
 * - `offline`: the last attempt got no answer; it retries at `nextAttemptAt`
 *   and when the network or the foreground come back.
 * - `failing`: the server failed (`5xx`, `429`, off-contract answer); retries
 *   at `nextAttemptAt`.
 * - `paused`: the session (`401`), the club (`403`) or the app version (`426`)
 *   must be resolved first: no automatic retries until then.
 */
export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'failing' | 'paused';
export type SyncPause = 'session' | 'forbidden' | 'update';

export interface SyncStatus {
  readonly membershipId: string | null;
  readonly phase: SyncPhase;
  readonly pause: SyncPause | null;
  /** Mutations not answered by the server yet. */
  readonly pendingCount: number;
  /** Issues to show (rejected or superseded mutations not dismissed). */
  readonly issueCount: number;
  /**
   * Changes whenever the list of issues may have changed (one recorded,
   * dismissed, wiped), also when their count stays the same: what a screen
   * re-reads `issues()` on. Always set by the engine.
   */
  readonly issuesVersion?: number;
  readonly lastSyncedAt: number | null;
  readonly nextAttemptAt: number | null;
}

export interface SyncIssue {
  readonly id: number;
  readonly mutationId: string;
  readonly op: SyncOperation;
  readonly kind: SyncIssueKind;
  readonly errorCode: string | null;
  readonly errorPaths: readonly string[];
  readonly fields: readonly string[];
  readonly input: SyncOperationInput<SyncOperation>;
  readonly recordedAt: number;
  readonly createdAt: number;
}

export type SyncCycleOutcome =
  | { readonly status: 'synced'; readonly pushed: number; readonly pulled: number }
  | { readonly status: 'skipped'; readonly reason: 'no_scope' | 'paused' | 'retry_after' }
  | { readonly status: 'failed'; readonly phase: 'offline' | 'failing' | 'paused' };

export interface RequestSyncOptions {
  /** Wait this long first (coalesces the writes of one form). */
  readonly delayMs?: number;
  /**
   * The user or the system says "now" (foreground, network back, pull to
   * refresh): resumes a pause and skips the backoff, but never a `Retry-After`.
   */
  readonly force?: boolean;
}

/** A write for {@link SyncEngine.enqueueAll}. */
export type QueuedWrite = {
  [Op in SyncOperation]: { readonly op: Op; readonly input: SyncOperationRequest<Op> };
}[SyncOperation];

export interface SyncEngine {
  readonly store: LocalStore;
  readonly getStatus: () => SyncStatus;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * The active membership (`null` signed out or without a club). A different
   * user than the one whose data the device holds first wipes it.
   */
  setScope(scope: SyncScopeRef | null): Promise<void>;
  /**
   * Validates and queues a write in one transaction (it survives the app
   * being killed right after), then asks for a sync.
   */
  enqueue<Op extends SyncOperation>(
    op: Op,
    input: SyncOperationRequest<Op>,
  ): Promise<QueuedMutation<Op>>;
  /**
   * Validates every write, then queues them all in one transaction, in
   * order: either all of them enter the queue or none does.
   */
  enqueueAll(writes: readonly QueuedWrite[]): Promise<QueuedMutation[]>;
  /** Schedules a cycle (single-flight: never two at once). */
  requestSync(options?: RequestSyncOptions): void;
  /** Runs a cycle now, or joins the running one and runs once more after it. */
  syncNow(options?: { readonly signal?: AbortSignal }): Promise<SyncCycleOutcome>;
  issues(): Promise<SyncIssue[]>;
  dismissIssue(id: number): Promise<void>;
  dismissAllIssues(): Promise<void>;
  /** Deletes every club row, queue and issue of the device (signing out). */
  wipe(): Promise<void>;
  dispose(): void;
}

export interface SyncEngineOptions {
  readonly database: LocalDatabase;
  readonly api: Pick<ApiClient, 'pushSyncMutations' | 'pullSyncChanges'>;
  readonly randomUUID: () => string;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly reportError?: (error: unknown) => void;
  readonly setTimer?: (task: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** Mutations per push (at most `SYNC_PUSH_MAX`). */
  readonly pushBatchSize?: number;
  /** Changes per pull page (at most `SYNC_PULL_LIMIT_MAX`). */
  readonly pullLimit?: number;
  /** Collections to pull; by default, every one the role can read. */
  readonly collections?: readonly SyncCollection[];
  /** Pull pages per cycle before giving up on a server that never ends (`MAX_PULL_PAGES`). */
  readonly maxPullPages?: number;
}

/**
 * How long an applied mutation stays laid over its rows when no pull
 * brought them: past this, a full pull that started later drops it (the
 * server may have answered a replay, or the pull horizon may lag).
 */
export const ACKED_OVERLAY_MAX_MS = 2 * 60_000;
/** Coalesces the writes of one screen into one push. */
export const ENQUEUE_SYNC_DELAY_MS = 1_000;
/** `device_meta` key of the user whose data the device holds (wiped on sign-out). */
export const OWNER_KEY = 'owner.userId';
/** Pull pages per cycle, a guard against a server that never says `hasMore: false`. */
export const MAX_PULL_PAGES = 1_000;

class CycleAbort extends Error {
  readonly phase: 'offline' | 'failing' | 'paused';
  readonly retryAfterS: number | undefined;

  constructor(phase: 'offline' | 'failing' | 'paused', retryAfterS?: number) {
    super(phase);
    this.phase = phase;
    this.retryAfterS = retryAfterS;
  }
}

function errorPathsOf(result: SyncMutationResult, index: number): string[] {
  const prefix = ['body', 'mutations', index];
  return (result.error?.details ?? []).map((issue) => {
    const path = issue.path;
    const local = prefix.every((part, at) => path[at] === part) ? path.slice(prefix.length) : path;
    return local.join('.');
  });
}

function pauseOf(error: ApiError): SyncPause | null {
  if (error.status === 426 || error.code === 'app_update_required') return 'update';
  if (error.status === 401) return 'session';
  if (error.status === 403) return 'forbidden';
  return null;
}

/** An answer that may succeed later on its own. */
function isTransient(error: ApiError): boolean {
  return error.status >= 500 || error.status === 429 || error.status === 408;
}

/**
 * The issues all point at the body of the request (`['body', ...]`, as the
 * API and the client contract locate them by part). Without issues, or with
 * one on the headers (`['headers', ...]`: the client headers of the app,
 * ADR 0045), params or query, the refusal is not about the mutations.
 */
function pointsAtBody(issues: readonly ValidationIssue[]): boolean {
  return issues.length > 0 && issues.every((issue) => issue.path[0] === 'body');
}

/**
 * The server refused a whole push because of what it carries: the envelope
 * of a mutation it no longer accepts (`400 validation_failed` with every
 * issue in the body, or the client contract refusing the body), a conflict
 * (`409 conflict`) or a body too big (`413`). Only these send the batch one
 * mutation at a time and reject the one refused alone. Anything else (`404`,
 * `405`, `410`, `431`, a `400` without the validation code or with an issue
 * outside the body, such as malformed client headers, a proxy page) says
 * nothing about the mutations: a misconfigured deploy, proxy, route or
 * client. Rejecting on those would empty the queue of a day of work, so the
 * queue stays and the cycle backs off like a failing server (ADR 0069).
 */
export function refusesMutations(error: unknown): boolean {
  if (error instanceof ApiContractError) {
    return error.side === 'request' && pointsAtBody(error.issues);
  }
  if (!(error instanceof ApiError)) return false;
  if (error.status === 400)
    return error.code === 'validation_failed' && pointsAtBody(error.details);
  if (error.status === 409) return error.code === 'conflict';
  return error.status === 413;
}

/**
 * The offline sync engine of the app (B-502, ADR 0015, ADR 0050, ADR 0069):
 * pushes the queue in order and pulls the changes since the cursor, for the
 * active membership, one cycle at a time, with backoff, and keeps the status
 * the indicator shows. Everything it knows is in the local database, so a
 * killed app picks up where it stopped: a mutation pushed without an answer
 * is pushed again with the same `mutationId` (the server answers `replayed`),
 * and a pull page and its cursor are committed together.
 */
export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const { database, api } = options;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const report = options.reportError ?? (() => undefined);
  const setTimer = options.setTimer ?? ((task, ms) => setTimeout(task, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  const pushBatchSize = Math.min(options.pushBatchSize ?? SYNC_PUSH_MAX, SYNC_PUSH_MAX);
  const pullLimit = Math.min(options.pullLimit ?? 200, SYNC_PULL_LIMIT_MAX);
  const maxPullPages = Math.max(1, options.maxPullPages ?? MAX_PULL_PAGES);
  const clock: DeviceClock = createDeviceClock({ now, randomUUID: options.randomUUID });
  const store = createLocalStore(database);

  let scope: SyncScopeRef | null = null;
  let status: SyncStatus = {
    membershipId: null,
    phase: 'idle',
    pause: null,
    pendingCount: 0,
    issueCount: 0,
    issuesVersion: 0,
    lastSyncedAt: null,
    nextAttemptAt: null,
  };
  /** Bumped by every write to the issues; published by `refreshCounts`. */
  let issuesVersion = 0;
  const listeners = new Set<() => void>();
  let running: Promise<SyncCycleOutcome> | null = null;
  /** The membership of the last cycle that started. */
  let cycleScope: string | null = null;
  let runAgain = false;
  let failures = 0;
  let retryAfterUntil = 0;
  let timer: unknown = null;
  let disposed = false;
  let wiping: Promise<void> | null = null;

  function setStatus(patch: Partial<SyncStatus>): void {
    const next = { ...status, ...patch };
    const changed = (Object.keys(next) as (keyof SyncStatus)[]).some(
      (key) => next[key] !== status[key],
    );
    if (!changed) return;
    status = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        report(error);
      }
    }
  }

  async function refreshCounts(): Promise<void> {
    const current = scope;
    if (current === null) {
      setStatus({
        membershipId: null,
        pendingCount: 0,
        issueCount: 0,
        issuesVersion,
        lastSyncedAt: null,
      });
      return;
    }
    const counts = await database.read(async (db) => {
      const [pending] = await db
        .select({ value: count() })
        .from(mutation)
        .where(and(eq(mutation.membershipId, current.membershipId), eq(mutation.state, 'pending')));
      const [issues] = await db
        .select({ value: count() })
        .from(syncIssue)
        .where(eq(syncIssue.membershipId, current.membershipId));
      const [row] = await db
        .select({ lastSyncedAt: syncScope.lastSyncedAt })
        .from(syncScope)
        .where(eq(syncScope.membershipId, current.membershipId));
      return {
        pendingCount: pending?.value ?? 0,
        issueCount: issues?.value ?? 0,
        lastSyncedAt: row?.lastSyncedAt ?? null,
      };
    });
    if (scope?.membershipId !== current.membershipId) return;
    setStatus({ membershipId: current.membershipId, ...counts, issuesVersion });
  }

  async function ensureScope(db: LocalDb, ref: SyncScopeRef): Promise<void> {
    await db
      .insert(syncScope)
      .values({ membershipId: ref.membershipId, userId: ref.userId, createdAt: now() })
      .onConflictDoNothing();
  }

  function clearTimerIfAny(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function schedule(delayMs: number): void {
    if (disposed) return;
    clearTimerIfAny();
    const at = Math.max(now() + delayMs, retryAfterUntil);
    timer = setTimer(
      () => {
        timer = null;
        void syncNow();
      },
      Math.max(0, at - now()),
    );
  }

  // ─── Push ──────────────────────────────────────────────────────────────────────────

  function toWire(queued: QueuedMutation): SyncMutation {
    const input = queued.input as { params?: unknown; target?: unknown; body?: unknown };
    return {
      // Generated with `randomUUID` when queued.
      mutationId: queued.mutationId as SyncMutation['mutationId'],
      hlc: queued.hlc,
      op: queued.op,
      ...(input.params !== undefined && { params: input.params }),
      ...(input.target !== undefined && { target: input.target }),
      ...(input.body !== undefined && { body: input.body }),
    };
  }

  async function recordIssue(
    db: LocalDb,
    ref: SyncScopeRef,
    queued: QueuedMutation,
    kind: SyncIssueKind,
    detail: { errorCode?: string; errorPaths?: string[]; fields?: string[] },
  ): Promise<void> {
    issuesVersion += 1;
    await db.insert(syncIssue).values({
      membershipId: ref.membershipId,
      mutationId: queued.mutationId,
      op: queued.op,
      kind,
      errorCode: detail.errorCode ?? null,
      errorPaths: detail.errorPaths === undefined ? null : JSON.stringify(detail.errorPaths),
      fields: detail.fields === undefined ? null : JSON.stringify(detail.fields),
      // Health data (the pain report, ADR 0078) never stays on the device once sent, not
      // even when the server rejects it: the issue says what failed, without the answer.
      input: forgetsOnAck(queued.op) ? '{}' : JSON.stringify(queued.input),
      recordedAt: queued.createdAt,
      createdAt: now(),
    });
  }

  /** What the server answered about one mutation: out of the queue, or laid over until a pull. */
  async function settle(
    db: LocalDb,
    ref: SyncScopeRef,
    queued: QueuedMutation,
    result: SyncMutationResult,
    index: number,
  ): Promise<void> {
    if (result.status === 'rejected') {
      await recordIssue(db, ref, queued, 'rejected', {
        errorCode: result.error?.code ?? 'internal',
        errorPaths: errorPathsOf(result, index),
      });
      await db.delete(mutation).where(eq(mutation.mutationId, queued.mutationId));
      return;
    }
    if (result.supersededFields.length > 0) {
      await recordIssue(db, ref, queued, 'superseded', { fields: result.supersededFields });
    }
    if (result.status === 'superseded') {
      // A later edit won every field: the pull brings it; nothing of this one to show.
      await db.delete(mutation).where(eq(mutation.mutationId, queued.mutationId));
      return;
    }
    if (forgetsOnAck(queued.op)) {
      // Nothing of it comes back in a pull (health data, ADR 0078): out of the device now.
      await db.delete(mutation).where(eq(mutation.mutationId, queued.mutationId));
      return;
    }
    await db
      .update(mutation)
      .set({ state: 'acked', ackedAt: now() })
      .where(eq(mutation.mutationId, queued.mutationId));
  }

  async function pendingBatch(ref: SyncScopeRef, limit: number): Promise<QueuedMutation[]> {
    const rows = await database.read((db) =>
      db
        .select()
        .from(mutation)
        .where(and(eq(mutation.membershipId, ref.membershipId), eq(mutation.state, 'pending')))
        .orderBy(asc(mutation.seq))
        .limit(limit),
    );
    return rows.map(toQueuedMutation);
  }

  async function countAttempt(batch: readonly QueuedMutation[]): Promise<void> {
    if (batch.length === 0) return;
    await database.write(async (db) => {
      for (const queued of batch) {
        await db
          .update(mutation)
          .set({ attempts: queued.attempts + 1 })
          .where(eq(mutation.mutationId, queued.mutationId));
      }
    });
  }

  /**
   * How a failed request ends the cycle. With `unexpected`, a `4xx` that is
   * neither a pause nor transient (a route the server does not have, headers
   * a proxy refuses) is also reported: a deployment problem to look at, not
   * something the device can fix.
   */
  function failureOf(error: unknown, failure: { unexpected?: boolean } = {}): CycleAbort {
    if (error instanceof CycleAbort) return error;
    if (error instanceof ApiNetworkError) return new CycleAbort('offline');
    if (error instanceof ApiError) {
      const pause = pauseOf(error);
      if (pause !== null) {
        setStatus({ pause });
        return new CycleAbort('paused');
      }
      if (failure.unexpected === true && !isTransient(error)) report(error);
      return new CycleAbort('failing', error.retryAfterS);
    }
    report(error);
    return new CycleAbort('failing');
  }

  async function sendPush(
    ref: SyncScopeRef,
    batch: readonly QueuedMutation[],
    signal: AbortSignal | undefined,
  ) {
    return api.pushSyncMutations(
      { body: { mutations: batch.map(toWire) } },
      { headers: { [MEMBERSHIP_HEADER]: ref.membershipId }, ...(signal && { signal }) },
    );
  }

  async function applyPushAnswer(
    ref: SyncScopeRef,
    batch: readonly QueuedMutation[],
    answer: { serverHlc: string; results: SyncMutationResult[] },
  ): Promise<void> {
    await database.write(async (db) => {
      await clock.receive(db, answer.serverHlc);
      const byId = new Map<string, { result: SyncMutationResult; index: number }>(
        answer.results.map((result, index) => [result.mutationId, { result, index }]),
      );
      for (const queued of batch) {
        const answered = byId.get(queued.mutationId);
        // Not answered (should not happen): it stays pending and goes in the next push.
        if (answered !== undefined) await settle(db, ref, queued, answered.result, answered.index);
      }
      await db
        .update(syncScope)
        .set({ lastPushedAt: now() })
        .where(eq(syncScope.membershipId, ref.membershipId));
    });
  }

  /**
   * A refusal of the whole push because of a mutation in it
   * (`refusesMutations`: the envelope of one no longer valid for this server)
   * would block the queue forever: the batch goes one mutation at a time,
   * and only the one the server refuses alone, with that same kind of
   * refusal, is rejected. Any other answer stops here and keeps the rest.
   */
  async function pushOneByOne(
    ref: SyncScopeRef,
    batch: readonly QueuedMutation[],
    signal: AbortSignal | undefined,
  ): Promise<void> {
    for (const queued of batch) {
      try {
        const answer = await sendPush(ref, [queued], signal);
        await applyPushAnswer(ref, [queued], answer);
      } catch (error) {
        if (!refusesMutations(error)) {
          await countAttempt([queued]);
          throw failureOf(error, { unexpected: true });
        }
        await database.write(async (db) => {
          await recordIssue(db, ref, queued, 'rejected', {
            errorCode: error instanceof ApiError ? error.code : 'validation_failed',
            errorPaths: [],
          });
          await db.delete(mutation).where(eq(mutation.mutationId, queued.mutationId));
        });
      }
    }
  }

  async function push(ref: SyncScopeRef, signal: AbortSignal | undefined): Promise<number> {
    let pushed = 0;
    // Bounded: each round takes mutations out of `pending` or aborts.
    for (;;) {
      const batch = await pendingBatch(ref, pushBatchSize);
      if (batch.length === 0) return pushed;
      try {
        const answer = await sendPush(ref, batch, signal);
        await applyPushAnswer(ref, batch, answer);
      } catch (error) {
        if (refusesMutations(error)) {
          await pushOneByOne(ref, batch, signal);
        } else {
          await countAttempt(batch);
          throw failureOf(error, { unexpected: true });
        }
      }
      pushed += batch.length;
      await refreshCounts();
    }
  }

  // ─── Pull ──────────────────────────────────────────────────────────────────────────

  async function markSeen(db: LocalDb, ref: SyncScopeRef, rows: TargetableRow[]): Promise<void> {
    if (rows.length === 0) return;
    const acked = await db
      .select()
      .from(mutation)
      .where(and(eq(mutation.membershipId, ref.membershipId), eq(mutation.state, 'acked')));
    for (const row of acked) {
      const queued = toQueuedMutation(row);
      const targets: StoredTarget[] = queued.targets.map((target) =>
        target.seen === true || !rows.some((pulled) => matchesTarget(target, pulled))
          ? target
          : { ...target, seen: true },
      );
      if (targets.every((target, index) => target === queued.targets[index])) continue;
      if (targets.every((target) => target.seen === true)) {
        await db.delete(mutation).where(eq(mutation.seq, queued.seq));
      } else {
        await db
          .update(mutation)
          .set({ targets: JSON.stringify(targets) })
          .where(eq(mutation.seq, queued.seq));
      }
    }
  }

  async function pull(ref: SyncScopeRef, signal: AbortSignal | undefined): Promise<number> {
    const startedAt = now();
    let pulled = 0;
    const [stored] = await database.read((db) =>
      db
        .select({ cursor: syncScope.cursor, collections: syncScope.collections })
        .from(syncScope)
        .where(eq(syncScope.membershipId, ref.membershipId)),
    );
    let cursor = stored?.cursor ?? null;
    const wanted = options.collections === undefined ? null : [...options.collections].sort();
    // A different set of collections than the cursor covers starts over (the server resets).
    if (cursor !== null && wanted !== null && stored?.collections !== JSON.stringify(wanted)) {
      cursor = null;
    }
    let retriedCursor = false;
    let complete = false;
    for (let pageNumber = 0; pageNumber < maxPullPages; pageNumber += 1) {
      let page;
      try {
        page = await api.pullSyncChanges(
          {
            query: {
              limit: pullLimit,
              ...(cursor !== null && { cursor }),
              ...(wanted !== null && { collections: wanted.join(',') }),
            },
          },
          { headers: { [MEMBERSHIP_HEADER]: ref.membershipId }, ...(signal && { signal }) },
        );
      } catch (error) {
        // A cursor the server no longer reads (another build, another club): from the start.
        if (
          error instanceof ApiError &&
          error.code === 'bad_request' &&
          cursor !== null &&
          !retriedCursor
        ) {
          retriedCursor = true;
          cursor = null;
          continue;
        }
        throw failureOf(error, { unexpected: true });
      }
      const current = page;
      await database.write(async (db) => {
        await clock.receive(db, current.serverHlc);
        // Cursor `null`: the device may hold rows from before (wiped cursor, other set of collections).
        if (current.reset || cursor === null) {
          await deleteCollections(db, ref.membershipId, current.collections);
        }
        const rows: TargetableRow[] = [];
        for (const change of current.items) {
          rows.push(await applyChange(db, ref.membershipId, change, now()));
        }
        await markSeen(db, ref, rows);
        await db
          .update(syncScope)
          .set({
            cursor: current.cursor,
            collections: JSON.stringify([...current.collections].sort()),
            lastPulledAt: now(),
          })
          .where(eq(syncScope.membershipId, ref.membershipId));
      });
      pulled += current.items.length;
      cursor = current.cursor;
      if (!current.hasMore) {
        complete = true;
        break;
      }
    }
    if (!complete) {
      // The pages applied so far stay, each with its cursor (the next cycle
      // goes on from there), but this is not a sync: `lastSyncedAt` and the
      // acked overlays stay as they were until a pull reaches the end.
      report(new Error(`Sync pull did not finish within ${String(maxPullPages)} pages`));
      throw new CycleAbort('failing');
    }
    // Applied a while before this full pull started and never seen: the server has them.
    await database.write((db) =>
      db
        .delete(mutation)
        .where(
          and(
            eq(mutation.membershipId, ref.membershipId),
            eq(mutation.state, 'acked'),
            lte(mutation.ackedAt, startedAt - ACKED_OVERLAY_MAX_MS),
          ),
        ),
    );
    return pulled;
  }

  // ─── Cycle ─────────────────────────────────────────────────────────────────────────

  async function cycle(signal: AbortSignal | undefined): Promise<SyncCycleOutcome> {
    if (wiping !== null) await wiping;
    const ref = scope;
    cycleScope = ref?.membershipId ?? null;
    if (ref === null) return { status: 'skipped', reason: 'no_scope' };
    if (status.pause !== null) return { status: 'skipped', reason: 'paused' };
    // Never before the server's `Retry-After`, whoever asks (the background
    // task, a screen): the timer already waits for it.
    if (now() < retryAfterUntil) return { status: 'skipped', reason: 'retry_after' };
    clearTimerIfAny();
    setStatus({ phase: 'syncing', nextAttemptAt: null });
    try {
      await database.write((db) => ensureScope(db, ref));
      const pushed = await push(ref, signal);
      const pulled = await pull(ref, signal);
      await database.write((db) =>
        db
          .update(syncScope)
          .set({ lastSyncedAt: now() })
          .where(eq(syncScope.membershipId, ref.membershipId)),
      );
      failures = 0;
      retryAfterUntil = 0;
      if (scope?.membershipId === ref.membershipId) setStatus({ phase: 'idle' });
      await refreshCounts();
      return { status: 'synced', pushed, pulled };
    } catch (error) {
      const failure = failureOf(error);
      if (scope?.membershipId !== ref.membershipId) {
        // The app moved to another membership meanwhile: its own cycle comes next.
        return { status: 'failed', phase: failure.phase };
      }
      await refreshCounts().catch(report);
      if (failure.phase === 'paused') {
        setStatus({ phase: 'paused', nextAttemptAt: null });
        return { status: 'failed', phase: 'paused' };
      }
      failures += 1;
      const delay = syncRetryDelayMs(failures, random, failure.retryAfterS);
      if (failure.retryAfterS !== undefined) retryAfterUntil = now() + delay;
      setStatus({ phase: failure.phase, nextAttemptAt: now() + delay });
      schedule(delay);
      return { status: 'failed', phase: failure.phase };
    }
  }

  /** The membership changed since the last cycle started: run again for the new one. */
  const scopeChanged = () => cycleScope !== (scope?.membershipId ?? null);

  function syncNow(runOptions: { signal?: AbortSignal } = {}): Promise<SyncCycleOutcome> {
    if (running !== null) {
      runAgain = true;
      return running;
    }
    const current = (async () => {
      let outcome = await cycle(runOptions.signal);
      // Writes queued while the cycle ran go out right away.
      while (runAgain && !disposed && (outcome.status === 'synced' || scopeChanged())) {
        runAgain = false;
        outcome = await cycle(runOptions.signal);
      }
      runAgain = false;
      return outcome;
    })();
    running = current;
    current
      .finally(() => {
        if (running === current) running = null;
      })
      .catch(report);
    return current;
  }

  async function enqueueWrites(writes: readonly QueuedWrite[]): Promise<QueuedMutation[]> {
    const ref = scope;
    if (ref === null) throw new Error('No active membership to queue a write for');
    // Every write is validated before the transaction opens.
    const prepared = writes.map((write) => ({
      ...prepareMutation<SyncOperation>(write.op, write.input),
      op: write.op,
    }));
    if (prepared.length === 0) return [];
    const queued = await database.write(async (db) => {
      await ensureScope(db, ref);
      const stored: QueuedMutation[] = [];
      for (const write of prepared) {
        const hlc = await clock.tick(db);
        const [row] = await db
          .insert(mutation)
          .values({
            membershipId: ref.membershipId,
            mutationId: options.randomUUID(),
            op: write.op,
            hlc,
            input: JSON.stringify(write.input),
            targets: JSON.stringify(write.targets),
            state: 'pending',
            attempts: 0,
            createdAt: now(),
          })
          .returning();
        if (row === undefined) throw new Error('The mutation was not stored');
        stored.push(toQueuedMutation(row));
      }
      return stored;
    });
    await refreshCounts();
    requestSync({ delayMs: ENQUEUE_SYNC_DELAY_MS });
    return queued;
  }

  function requestSync(request: RequestSyncOptions = {}): void {
    if (disposed || scope === null) return;
    if (request.force === true) {
      if (status.pause !== null) setStatus({ pause: null, phase: 'idle' });
      failures = 0;
    } else if (status.pause !== null || status.nextAttemptAt !== null) {
      // Paused, or waiting out a backoff: the timer (or a forced request) runs it.
      return;
    }
    if (running !== null) {
      runAgain = true;
      return;
    }
    schedule(request.delayMs ?? 0);
  }

  return {
    store,
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async setScope(next) {
      if (next?.membershipId === scope?.membershipId && next?.userId === scope?.userId) return;
      clearTimerIfAny();
      failures = 0;
      retryAfterUntil = 0;
      scope = next;
      setStatus({
        membershipId: next?.membershipId ?? null,
        phase: 'idle',
        pause: null,
        nextAttemptAt: null,
      });
      if (next !== null) {
        // Another person signs in on this phone: nothing of the previous one stays.
        const owner = await database.read(async (db) => {
          const [row] = await db.select().from(deviceMeta).where(eq(deviceMeta.key, OWNER_KEY));
          return row?.value ?? null;
        });
        if (owner !== next.userId) {
          issuesVersion += 1;
          await database.write(async (db) => {
            await db.delete(syncScope).where(ne(syncScope.userId, next.userId));
            await db
              .insert(deviceMeta)
              .values({ key: OWNER_KEY, value: next.userId })
              .onConflictDoUpdate({ target: deviceMeta.key, set: { value: next.userId } });
          });
        }
      }
      await refreshCounts();
      if (next !== null) schedule(0);
    },
    async enqueue(op, input) {
      const [queued] = await enqueueWrites([{ op, input } as QueuedWrite]);
      if (queued === undefined) throw new Error('The mutation was not stored');
      return queued as QueuedMutation<typeof op>;
    },
    enqueueAll: enqueueWrites,
    requestSync,
    syncNow,
    async issues() {
      const ref = scope;
      if (ref === null) return [];
      const rows = await database.read((db) =>
        db
          .select()
          .from(syncIssue)
          .where(eq(syncIssue.membershipId, ref.membershipId))
          .orderBy(desc(syncIssue.id)),
      );
      return rows.map((row) => ({
        id: row.id,
        mutationId: row.mutationId,
        op: row.op,
        kind: row.kind,
        errorCode: row.errorCode,
        errorPaths: row.errorPaths === null ? [] : (JSON.parse(row.errorPaths) as string[]),
        fields: row.fields === null ? [] : (JSON.parse(row.fields) as string[]),
        input: JSON.parse(row.input) as SyncOperationInput<SyncOperation>,
        recordedAt: row.recordedAt,
        createdAt: row.createdAt,
      }));
    },
    async dismissIssue(id) {
      const ref = scope;
      if (ref === null) return;
      await database.write((db) =>
        db
          .delete(syncIssue)
          .where(and(eq(syncIssue.id, id), eq(syncIssue.membershipId, ref.membershipId))),
      );
      issuesVersion += 1;
      await refreshCounts();
    },
    async dismissAllIssues() {
      const ref = scope;
      if (ref === null) return;
      await database.write((db) =>
        db.delete(syncIssue).where(eq(syncIssue.membershipId, ref.membershipId)),
      );
      issuesVersion += 1;
      await refreshCounts();
    },
    async wipe() {
      const task = (async () => {
        clearTimerIfAny();
        if (running !== null) await running.catch(() => undefined);
        await database.write(async (db) => {
          await db.delete(syncScope);
          await db.delete(deviceMeta).where(inArray(deviceMeta.key, [OWNER_KEY]));
        });
      })();
      wiping = task;
      try {
        await task;
      } finally {
        wiping = null;
        issuesVersion += 1;
      }
      await refreshCounts();
    },
    dispose() {
      disposed = true;
      clearTimerIfAny();
      listeners.clear();
    },
  };
}
