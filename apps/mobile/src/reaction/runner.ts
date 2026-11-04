import {
  nextReactionTrial,
  recordReactionTrial,
  summarizeReactionSeries,
  type ReactionProtocol,
  type ReactionResponse,
  type ReactionSeriesSummary,
  type ReactionTask,
  type ReactionTrial,
  type ReactionTrialRecord,
} from '@sport-performance/domain';

/**
 * The run of the reaction test on the phone (B-606, ADR 0076): a store
 * outside React that shows each stimulus after its random wait, times the
 * touch on a monotonic clock and records what the domain classifies. The
 * screen renders its state and calls `touch` from `onPressIn` (the earliest
 * event of a touch) and `stimulusShown` from the first frame after the
 * stimulus is committed, so the time runs from when the stimulus is on
 * screen and not from when the timer fired.
 *
 * Nothing is persisted: a run interrupted (the app to the background, the
 * screen left) starts its series again, because a wait timed by a timer
 * that the system paused is not a reaction time.
 */

export interface ReactionClock {
  /** Monotonic milliseconds (`performance.now()`). */
  now(): number;
}

export interface ReactionTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** How long the feedback after a stimulus stays (ms) before the next wait. */
export const REACTION_FEEDBACK_MS = 700;

export type ReactionRunState =
  | { readonly phase: 'idle' }
  /** Before a series: the instructions of its task. */
  | {
      readonly phase: 'intro';
      readonly task: ReactionTask;
      readonly taskIndex: number;
      readonly taskCount: number;
      readonly completed: readonly ReactionSeriesSummary[];
    }
  /** The random wait: the screen shows the fixation mark. A touch now is an anticipation. */
  | {
      readonly phase: 'waiting';
      readonly task: ReactionTask;
      readonly trial: ReactionTrial;
      readonly progress: ReactionProgress;
    }
  /** The stimulus is on screen. */
  | {
      readonly phase: 'stimulus';
      readonly task: ReactionTask;
      readonly trial: ReactionTrial;
      readonly progress: ReactionProgress;
    }
  /** What the last stimulus ended as, for a moment. */
  | {
      readonly phase: 'feedback';
      readonly task: ReactionTask;
      readonly record: ReactionTrialRecord;
      readonly progress: ReactionProgress;
    }
  /** Every series ended (complete or incomplete): the summaries, in task order. */
  | { readonly phase: 'finished'; readonly summaries: readonly ReactionSeriesSummary[] };

export interface ReactionProgress {
  readonly practice: boolean;
  /** Valid stimuli so far and the ones the series needs. */
  readonly valid: number;
  readonly needed: number;
}

export interface ReactionRunner {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getState: () => ReactionRunState;
  /** Starts a run of `tasks` in order (default: simple, then go/no-go). */
  start(protocol: ReactionProtocol, tasks?: readonly ReactionTask[]): void;
  /** From the intro of a series: its first wait. */
  begin(): void;
  /** A touch of the response area, at `at` on the clock (default: now). */
  touch(at?: number): void;
  /** The first frame with the stimulus on screen, at `at` on the clock. */
  stimulusShown(at: number): void;
  /** The app left the foreground or the screen closed: the series in course starts again. */
  interrupt(): void;
  /** Forgets everything (the next player starts from nothing). */
  reset(): void;
  dispose(): void;
}

export interface ReactionRunnerOptions {
  readonly clock: ReactionClock;
  readonly timers: ReactionTimers;
  /** In `[0, 1)`: the waits and the kind of each go/no-go stimulus. */
  readonly random: () => number;
}

export function createReactionRunner(options: ReactionRunnerOptions): ReactionRunner {
  const { clock, timers, random } = options;
  const listeners = new Set<() => void>();
  let state: ReactionRunState = { phase: 'idle' };
  let protocol: ReactionProtocol | null = null;
  let tasks: readonly ReactionTask[] = [];
  let taskIndex = 0;
  let completed: ReactionSeriesSummary[] = [];
  let records: ReactionTrialRecord[] = [];
  let timer: unknown = null;
  /** When the stimulus in course went on screen (monotonic ms). */
  let onsetAt: number | null = null;
  let onsetConfirmed = false;

  function set(next: ReactionRunState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function clearTimer(): void {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }

  function schedule(callback: () => void, delayMs: number): void {
    clearTimer();
    timer = timers.setTimeout(() => {
      timer = null;
      callback();
    }, delayMs);
  }

  function task(): ReactionTask {
    const current = tasks[taskIndex];
    if (current === undefined) throw new Error('reaction runner: no task in course');
    return current;
  }

  function progress(trial: { practice: boolean }): ReactionProgress {
    const needed = protocol?.validTrials ?? 0;
    const valid =
      protocol === null ? 0 : summarizeReactionSeries(task(), records, protocol).validMs.length;
    return { practice: trial.practice, valid, needed };
  }

  function intro(): void {
    set({
      phase: 'intro',
      task: task(),
      taskIndex,
      taskCount: tasks.length,
      completed: [...completed],
    });
  }

  function nextTrial(): void {
    if (protocol === null) return;
    const trial = nextReactionTrial(task(), records, protocol, random);
    if (trial === null) {
      completed.push(summarizeReactionSeries(task(), records, protocol));
      records = [];
      taskIndex += 1;
      if (taskIndex >= tasks.length) {
        set({ phase: 'finished', summaries: [...completed] });
        return;
      }
      intro();
      return;
    }
    onsetAt = null;
    onsetConfirmed = false;
    set({ phase: 'waiting', task: task(), trial, progress: progress(trial) });
    schedule(() => {
      showStimulus(trial);
    }, trial.foreperiodMs);
  }

  function showStimulus(trial: ReactionTrial): void {
    if (protocol === null) return;
    onsetAt = clock.now();
    set({ phase: 'stimulus', task: task(), trial, progress: progress(trial) });
    // The window runs from the provisional onset: never shorter than the protocol's.
    schedule(() => {
      respond(trial, { kind: 'none' });
    }, protocol.responseWindowMs);
  }

  function respond(trial: ReactionTrial, response: ReactionResponse): void {
    if (protocol === null) return;
    clearTimer();
    const record = recordReactionTrial(trial, response, protocol);
    records.push(record);
    set({ phase: 'feedback', task: task(), record, progress: progress(trial) });
    schedule(nextTrial, REACTION_FEEDBACK_MS);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    start(next, order = ['simple', 'go_no_go']) {
      clearTimer();
      if (order.length === 0) throw new Error('reaction runner: no task to run');
      protocol = next;
      tasks = [...order];
      taskIndex = 0;
      completed = [];
      records = [];
      intro();
    },
    begin() {
      if (state.phase !== 'intro') return;
      records = [];
      nextTrial();
    },
    touch(at = clock.now()) {
      if (state.phase === 'waiting') {
        respond(state.trial, { kind: 'early' });
        return;
      }
      if (state.phase === 'stimulus' && onsetAt !== null) {
        respond(state.trial, { kind: 'touch', reactionMs: at - onsetAt });
      }
    },
    stimulusShown(at) {
      if (state.phase !== 'stimulus' || onsetAt === null || onsetConfirmed) return;
      onsetConfirmed = true;
      // The frame is never before the timer that asked for it.
      if (at > onsetAt) onsetAt = at;
    },
    interrupt() {
      if (state.phase === 'waiting' || state.phase === 'stimulus' || state.phase === 'feedback') {
        clearTimer();
        records = [];
        intro();
      }
    },
    reset() {
      clearTimer();
      protocol = null;
      tasks = [];
      taskIndex = 0;
      completed = [];
      records = [];
      onsetAt = null;
      set({ phase: 'idle' });
    },
    dispose() {
      clearTimer();
      listeners.clear();
    },
  };
}
