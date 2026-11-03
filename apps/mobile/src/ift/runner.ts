import {
  adjustIft3015Stage,
  dueIft3015Cues,
  finishIft3015,
  ift3015CueIndexAfter,
  ift3015LeadInStartMs,
  ift3015MomentAt,
  ift3015Schedule,
  ift3015TestEndMs,
  newIft3015PlayerMarks,
  recordIft3015Miss,
  stopIft3015Player,
  undoIft3015Mark,
  type Ift3015Cue,
  type Ift3015Moment,
  type Ift3015PlayerMarks,
  type Ift3015SignalProtocol,
} from '@sport-performance/domain';
import {
  sameIftRunScope,
  type IftRunEnd,
  type IftRunScope,
  type IftRunSnapshot,
  type IftRunStore,
} from './run-store.ts';
import type { SignalPlayer } from './signal-player.ts';
import { CUE_SOUNDS } from './tones.ts';

/**
 * Runs a 30-15 IFT on the phone (B-507, ADR 0070): plays the signals of the
 * domain schedule on time and applies the staff's marks. A store outside
 * React, like the session controller (ADR 0058): the screen reads it with
 * `useSyncExternalStore`, and the session layer stops it when the user signs
 * out or changes club (`leaveScope`).
 *
 * Timing: the elapsed time is always read from a monotonic clock anchored at
 * the start of stage 1, and each wake-up is scheduled for the next cue
 * measured on that clock, so timer delays never add up. A cue later than
 * `lateToleranceMs` is skipped, never played late. While it runs the run
 * saves a heartbeat on the wall clock; after the app is killed it is restored
 * from there: resumed at the stage under way if the gap is short, or ended at
 * the last heartbeat (never at the moment it is reopened).
 */

export interface Clock {
  /** Monotonic milliseconds (`performance.now()`). */
  now(): number;
}

export interface Timers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type IftRunnerState =
  | { readonly status: 'idle' }
  | { readonly status: 'preparing' }
  | {
      readonly status: 'running';
      readonly run: IftRunSnapshot;
      /** Ms from the start of stage 1 (negative in the lead-in). */
      readonly elapsedMs: number;
      readonly moment: Ift3015Moment;
      /** Cues that came due too late to play (the phone was asleep or busy). */
      readonly skippedCues: number;
      /** Nobody is running any more: the staff ends the test or undoes the last mark. */
      readonly allOut: boolean;
    }
  | {
      /** Restored after the app was closed mid-test: resume or end it. */
      readonly status: 'interrupted';
      readonly run: IftRunSnapshot;
      /** The last moment the run was known to be playing, in ms from the start of stage 1. */
      readonly stoppedAtMs: number;
      /** The moment at `stoppedAtMs`: where the test was when the app died. */
      readonly moment: Ift3015Moment;
      /**
       * The gap since then is short enough to pick the test up where it is
       * now (`maxResumeGapMs`); otherwise it can only be ended at `stoppedAtMs`.
       */
      readonly resumable: boolean;
    }
  | { readonly status: 'finished'; readonly run: IftRunSnapshot };

export interface StartIftRun {
  readonly scope: IftRunScope;
  readonly protocol: Ift3015SignalProtocol;
  readonly playerIds: readonly string[];
  readonly categoryId: string | null;
}

/** Its functions do not use `this`: they can be passed around as callbacks. */
export interface IftRunner {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getState: () => IftRunnerState;
  /**
   * Reads a run left on the device by this user in this club (another one is
   * deleted); a run of another user or club in memory is dropped first.
   */
  readonly restore: (scope: IftRunScope) => Promise<void>;
  /**
   * The session moved to `scope` (`null`: signed out, or no club chosen): a
   * run of anyone else is stopped and forgotten, in memory and on the device.
   * Called by the session layer, whether or not the screen is open.
   */
  readonly leaveScope: (scope: IftRunScope | null) => Promise<void>;
  readonly start: (input: StartIftRun) => Promise<void>;
  /** Resumes an interrupted run at the stage under way, if it is still `resumable`. */
  readonly resume: () => Promise<void>;
  readonly miss: (playerId: string) => void;
  readonly stop: (playerId: string) => void;
  readonly undo: (playerId: string) => void;
  readonly adjust: (playerId: string, lastCompletedStage: number) => void;
  /**
   * Ends the test: every player still running stops now, or, for an
   * interrupted run, at the last moment it was known to be playing.
   */
  readonly finish: () => void;
  /** Forgets the run (its results were saved or discarded). */
  readonly discard: () => Promise<void>;
  /** Re-checks the clock now (the app came back to the foreground). */
  readonly wake: () => void;
  readonly dispose: () => void;
}

export interface IftRunnerDeps {
  readonly clock: Clock;
  readonly wallClock: () => number;
  readonly timers: Timers;
  readonly audio: SignalPlayer;
  readonly store: IftRunStore;
  readonly randomUUID: () => string;
  readonly reportError: (error: unknown) => void;
  /** How late a cue may still sound. */
  readonly lateToleranceMs?: number;
  /** Screen refresh while running. */
  readonly tickMs?: number;
  /** How often a running run saves that it is still alive. */
  readonly heartbeatMs?: number;
  /** Longest gap after which an interrupted run may still be resumed. */
  readonly maxResumeGapMs?: number;
}

export const DEFAULT_LATE_TOLERANCE_MS = 250;
export const DEFAULT_TICK_MS = 200;
export const DEFAULT_HEARTBEAT_MS = 1_000;
/** One recovery: past it the players have been without signals for too long. */
export const DEFAULT_MAX_RESUME_GAP_MS = 15_000;

export function createIftRunner(deps: IftRunnerDeps): IftRunner {
  const { clock, wallClock, timers, audio, store, reportError } = deps;
  const lateToleranceMs = deps.lateToleranceMs ?? DEFAULT_LATE_TOLERANCE_MS;
  const tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const maxResumeGapMs = deps.maxResumeGapMs ?? DEFAULT_MAX_RESUME_GAP_MS;
  const listeners = new Set<() => void>();
  let state: IftRunnerState = { status: 'idle' };
  let schedule: readonly Ift3015Cue[] = [];
  let nextIndex = 0;
  /** Monotonic time of the start of stage 1. */
  let stage1MonoMs = 0;
  let skippedCues = 0;
  let timer: unknown = null;
  let disposed = false;
  /** Bumped whenever the run is dropped: an `await` started before it gives up. */
  let generation = 0;
  /** Whose run is being prepared (`preparing` has no snapshot yet). */
  let preparingScope: IftRunScope | null = null;

  const emit = (next: IftRunnerState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  /** Saves the run; a running one is stamped as alive now. */
  const persist = (run: IftRunSnapshot): IftRunSnapshot => {
    const saved: IftRunSnapshot =
      run.status === 'running' ? { ...run, lastAliveWallMs: wallClock() } : run;
    store.save(saved).catch(reportError);
    return saved;
  };
  const clearTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const elapsedMs = () => clock.now() - stage1MonoMs;
  /** Read again after an `await`: the state may have moved on meanwhile. */
  const currentState = (): IftRunnerState => state;

  const currentRun = (): IftRunSnapshot | null =>
    state.status === 'running' || state.status === 'interrupted' || state.status === 'finished'
      ? state.run
      : null;

  const scopeInMemory = (): IftRunScope | null =>
    state.status === 'preparing' ? preparingScope : (currentRun()?.scope ?? null);

  /** Stops whatever is in memory, without touching the device. */
  const drop = () => {
    generation += 1;
    clearTimer();
    if (state.status === 'running') audio.endSession().catch(reportError);
    preparingScope = null;
    emit({ status: 'idle' });
  };

  const allOut = (run: IftRunSnapshot) => run.players.every((marks) => marks.outcome !== 'running');

  const endRun = (run: IftRunSnapshot, atMs: number, playEnd: boolean, endedBy: IftRunEnd) => {
    clearTimer();
    const ended = persist({
      ...run,
      status: 'finished',
      endedAtMs: atMs,
      endedBy,
      players: finishIft3015(run.players, run.protocol, atMs),
    });
    if (playEnd) audio.play('end');
    audio.endSession().catch(reportError);
    emit({ status: 'finished', run: ended });
  };

  const pump = () => {
    timer = null;
    if (disposed || state.status !== 'running') return;
    let run = state.run;
    const now = elapsedMs();
    const due = dueIft3015Cues(schedule, nextIndex, now, lateToleranceMs);
    nextIndex = due.nextIndex;
    skippedCues += due.skipped.length;
    for (const cue of due.play) audio.play(CUE_SOUNDS[cue.kind]);
    const endMs = ift3015TestEndMs(run.protocol);
    if (now >= endMs) {
      // The test-end cue already sounded if it was on time.
      endRun(run, endMs, false, 'schedule');
      return;
    }
    if (wallClock() - run.lastAliveWallMs >= heartbeatMs) run = persist(run);
    emit({
      status: 'running',
      run,
      elapsedMs: now,
      moment: ift3015MomentAt(run.protocol, now),
      skippedCues,
      allOut: allOut(run),
    });
    const untilCue = due.nextAtMs === null ? tickMs : due.nextAtMs - elapsedMs();
    timer = timers.setTimeout(pump, Math.max(0, Math.min(tickMs, untilCue)));
  };

  const run = (snapshot: IftRunSnapshot, atMs: number) => {
    schedule = ift3015Schedule(snapshot.protocol);
    stage1MonoMs = clock.now() - atMs;
    nextIndex = ift3015CueIndexAfter(schedule, atMs - 1);
    skippedCues = 0;
    const alive = persist(snapshot);
    emit({
      status: 'running',
      run: alive,
      elapsedMs: atMs,
      moment: ift3015MomentAt(alive.protocol, atMs),
      skippedCues,
      allOut: allOut(alive),
    });
    pump();
  };

  /** Ms from the start of stage 1 now, on the wall clock (after the app was killed). */
  const wallElapsedMs = (snapshot: IftRunSnapshot) => wallClock() - snapshot.stage1WallMs;

  const isResumable = (snapshot: IftRunSnapshot) =>
    wallClock() - snapshot.lastAliveWallMs <= maxResumeGapMs &&
    wallElapsedMs(snapshot) < ift3015TestEndMs(snapshot.protocol);

  /** Shows a run restored after the app was killed; `resumable` turns off when its gap runs out. */
  const interrupt = (snapshot: IftRunSnapshot) => {
    clearTimer();
    const { protocol } = snapshot;
    const stoppedAtMs = Math.min(
      Math.max(snapshot.lastAliveWallMs - snapshot.stage1WallMs, ift3015LeadInStartMs(protocol)),
      ift3015TestEndMs(protocol),
    );
    const resumable = isResumable(snapshot);
    emit({
      status: 'interrupted',
      run: snapshot,
      stoppedAtMs,
      moment: ift3015MomentAt(protocol, stoppedAtMs),
      resumable,
    });
    if (!resumable) return;
    const untilExpiryMs = Math.min(
      snapshot.lastAliveWallMs + maxResumeGapMs - wallClock(),
      ift3015TestEndMs(protocol) - wallElapsedMs(snapshot),
    );
    timer = timers.setTimeout(
      () => {
        timer = null;
        if (!disposed && state.status === 'interrupted' && state.run === snapshot) {
          interrupt(snapshot);
        }
      },
      Math.max(0, untilExpiryMs) + 1,
    );
  };

  const updatePlayer = (
    playerId: string,
    change: (marks: Ift3015PlayerMarks, run: IftRunSnapshot, atMs: number) => Ift3015PlayerMarks,
  ) => {
    const current = currentRun();
    if (current === null || state.status === 'interrupted') return;
    const atMs = state.status === 'running' ? elapsedMs() : (current.endedAtMs ?? 0);
    const players = current.players.map((marks) =>
      marks.playerId === playerId ? change(marks, current, atMs) : marks,
    );
    if (players.every((marks, i) => marks === current.players[i])) return;
    const next = persist({ ...current, players });
    if (state.status === 'running') {
      // Nobody left running: the test goes on until the staff ends it, so a
      // wrong last mark can still be undone.
      emit({ ...state, run: next, allOut: allOut(next) });
    } else {
      emit({ status: 'finished', run: next });
    }
  };

  /** Takes the audio session; gives it back if the run moved on meanwhile. */
  const takeAudio = async (stillWanted: () => boolean): Promise<boolean> => {
    await audio.prepare();
    await audio.beginSession();
    if (disposed || !stillWanted()) {
      if (currentState().status !== 'running') audio.endSession().catch(reportError);
      return false;
    }
    return true;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,

    async restore(scope) {
      const inMemory = scopeInMemory();
      // Another user or club on this phone: never theirs to see or to keep running.
      if (inMemory !== null && !sameIftRunScope(inMemory, scope)) drop();
      if (state.status !== 'idle') return;
      const started = generation;
      const snapshot = await store.load();
      if (snapshot === null || started !== generation || currentState().status !== 'idle') return;
      if (!sameIftRunScope(snapshot.scope, scope)) {
        await store.clearUnlessScope(scope);
        return;
      }
      if (snapshot.status === 'finished') {
        emit({ status: 'finished', run: snapshot });
        return;
      }
      interrupt(snapshot);
    },

    async leaveScope(scope) {
      const inMemory = scopeInMemory();
      if (inMemory !== null && (scope === null || !sameIftRunScope(inMemory, scope))) drop();
      await store.clearUnlessScope(scope);
    },

    async start({ scope, protocol, playerIds, categoryId }) {
      if (state.status !== 'idle') return;
      const players = [...new Set(playerIds)].map(newIft3015PlayerMarks);
      if (players.length === 0) return;
      const started = generation;
      preparingScope = scope;
      emit({ status: 'preparing' });
      const stillWanted = () => started === generation && currentState().status === 'preparing';
      try {
        if (!(await takeAudio(stillWanted))) return;
      } catch (error) {
        reportError(error);
        if (stillWanted()) {
          preparingScope = null;
          emit({ status: 'idle' });
        }
        throw error;
      }
      preparingScope = null;
      const leadInMs = -ift3015LeadInStartMs(protocol);
      const snapshot: IftRunSnapshot = {
        version: 1,
        scope,
        runId: deps.randomUUID(),
        categoryId,
        protocol,
        stage1WallMs: wallClock() + leadInMs,
        status: 'running',
        lastAliveWallMs: wallClock(),
        endedAtMs: null,
        endedBy: null,
        players,
      };
      run(snapshot, -leadInMs);
    },

    async resume() {
      if (state.status !== 'interrupted') return;
      const snapshot = state.run;
      if (!isResumable(snapshot)) {
        interrupt(snapshot);
        return;
      }
      const started = generation;
      const stillWanted = () => {
        const now = currentState();
        return started === generation && now.status === 'interrupted' && now.run === snapshot;
      };
      if (!(await takeAudio(stillWanted))) return;
      if (!isResumable(snapshot)) {
        // Preparing the audio took longer than the gap that was left.
        audio.endSession().catch(reportError);
        interrupt(snapshot);
        return;
      }
      run(snapshot, wallElapsedMs(snapshot));
    },

    miss(playerId) {
      if (state.status !== 'running') return;
      updatePlayer(playerId, (marks, current, atMs) =>
        recordIft3015Miss(marks, schedule, current.protocol, atMs),
      );
    },

    stop(playerId) {
      if (state.status !== 'running') return;
      updatePlayer(playerId, (marks, current, atMs) =>
        stopIft3015Player(marks, current.protocol, atMs),
      );
    },

    undo(playerId) {
      if (state.status === 'running') {
        updatePlayer(playerId, (marks) => undoIft3015Mark(marks));
        return;
      }
      // After the end only a correction of the stage can be undone, never an end.
      if (state.status === 'finished') {
        updatePlayer(playerId, (marks) =>
          marks.adjustedStage === null ? marks : undoIft3015Mark(marks),
        );
      }
    },

    adjust(playerId, lastCompletedStage) {
      updatePlayer(playerId, (marks, current) =>
        marks.outcome === 'running'
          ? marks
          : adjustIft3015Stage(marks, lastCompletedStage, current.protocol),
      );
    },

    finish() {
      if (state.status === 'running') {
        const atMs = Math.min(elapsedMs(), ift3015TestEndMs(state.run.protocol));
        endRun(state.run, atMs, true, 'staff');
        return;
      }
      if (state.status === 'interrupted') {
        // Nobody knows what happened after the app died: whoever was still
        // running stops at the last moment the signals were playing.
        endRun(state.run, state.stoppedAtMs, false, 'interrupted');
      }
    },

    async discard() {
      drop();
      await store.clear();
    },

    wake() {
      if (state.status === 'interrupted') {
        interrupt(state.run);
        return;
      }
      if (state.status !== 'running') return;
      clearTimer();
      audio.beginSession().catch(reportError);
      pump();
    },

    dispose() {
      if (state.status === 'running') audio.endSession().catch(reportError);
      disposed = true;
      generation += 1;
      clearTimer();
      listeners.clear();
    },
  };
}
