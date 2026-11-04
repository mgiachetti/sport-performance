import { DEFAULT_REACTION_PROTOCOL, type ReactionProtocol } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { REACTION_FEEDBACK_MS, createReactionRunner, type ReactionRunState } from './runner.ts';

/** A clock and timers the test moves by hand. */
function manualTime() {
  let time = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  return {
    clock: { now: () => time },
    timers: {
      setTimeout: (callback: () => void, delayMs: number) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { at: time + delayMs, callback });
        return id;
      },
      clearTimeout: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    /** Moves the clock, firing every timer due on the way, in order. */
    advance(ms: number) {
      const end = time + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        pending.delete(due[0]);
        time = due[1].at;
        due[1].callback();
      }
      time = end;
    },
    pendingCount: () => pending.size,
  };
}

const PROTOCOL: ReactionProtocol = {
  ...DEFAULT_REACTION_PROTOCOL,
  practiceTrials: 1,
  validTrials: 2,
  foreperiodMinMs: 1000,
  foreperiodMaxMs: 1000,
};

function setup() {
  const time = manualTime();
  const runner = createReactionRunner({ ...time, random: () => 0.5 });
  const phase = () => runner.getState().phase;
  /** Waits out the foreperiod and touches `reactionMs` after the stimulus. */
  const react = (reactionMs: number) => {
    expect(phase()).toBe('waiting');
    time.advance(1000);
    expect(phase()).toBe('stimulus');
    time.advance(reactionMs);
    runner.touch();
    expect(phase()).toBe('feedback');
    time.advance(REACTION_FEEDBACK_MS);
  };
  return { time, runner, phase, react };
}

function summaries(state: ReactionRunState) {
  if (state.phase !== 'finished') throw new Error(`not finished: ${state.phase}`);
  return state.summaries;
}

describe('the reaction runner', () => {
  it('runs practice and the valid stimuli of each task, then finishes with both summaries', () => {
    const { runner, phase, react } = setup();
    runner.start(PROTOCOL, ['simple']);
    expect(runner.getState()).toMatchObject({ phase: 'intro', task: 'simple', taskIndex: 0 });
    runner.begin();
    react(400); // practice
    react(250);
    react(270);
    expect(phase()).toBe('finished');
    expect(summaries(runner.getState())).toEqual([
      expect.objectContaining({
        task: 'simple',
        status: 'complete',
        validMs: [250, 270],
        meanMs: 260,
      }),
    ]);
  });

  it('times from the frame the stimulus is on screen, not from the timer', () => {
    const { runner, time } = setup();
    runner.start(PROTOCOL, ['simple']);
    runner.begin();
    time.advance(1000);
    // The frame arrives 16 ms after the timer; the touch 266 ms after the timer.
    runner.stimulusShown(1016);
    runner.stimulusShown(1100); // only the first frame counts
    runner.touch(1266);
    const state = runner.getState();
    expect(state.phase === 'feedback' && state.record).toMatchObject({
      outcome: 'valid',
      reactionMs: 250,
    });
  });

  it('counts a touch during the wait as an anticipation and a missing one as a lapse', () => {
    const { runner, time } = setup();
    runner.start(PROTOCOL, ['simple']);
    runner.begin();
    time.advance(400);
    runner.touch();
    let state = runner.getState();
    expect(state.phase === 'feedback' && state.record.outcome).toBe('anticipation');
    time.advance(REACTION_FEEDBACK_MS + 1000 + PROTOCOL.responseWindowMs);
    state = runner.getState();
    expect(state.phase === 'feedback' && state.record.outcome).toBe('lapse');
  });

  it('goes from one series to the next through its intro', () => {
    const { runner, phase, react } = setup();
    runner.start(PROTOCOL);
    runner.begin();
    react(300);
    react(250);
    react(250);
    expect(runner.getState()).toMatchObject({
      phase: 'intro',
      task: 'go_no_go',
      taskIndex: 1,
      taskCount: 2,
    });
    expect(phase()).toBe('intro');
  });

  it('starts the series again when interrupted, and keeps no timer', () => {
    const { runner, time, react } = setup();
    runner.start(PROTOCOL, ['simple']);
    runner.begin();
    react(300);
    react(250);
    time.advance(500);
    runner.interrupt();
    expect(runner.getState()).toMatchObject({ phase: 'intro', task: 'simple' });
    expect(time.pendingCount()).toBe(0);
    runner.begin();
    react(300); // practice again: the series started over
    const state = runner.getState();
    expect(state.phase === 'waiting' && state.progress).toEqual({
      practice: false,
      valid: 0,
      needed: 2,
    });
  });

  it('forgets everything on reset and tells its listeners', () => {
    const { runner, time } = setup();
    const seen: string[] = [];
    runner.subscribe(() => seen.push(runner.getState().phase));
    runner.start(PROTOCOL, ['simple']);
    runner.begin();
    runner.reset();
    expect(runner.getState()).toEqual({ phase: 'idle' });
    expect(time.pendingCount()).toBe(0);
    expect(seen).toEqual(['intro', 'waiting', 'idle']);
    // A touch with nothing in course does nothing.
    runner.touch();
    expect(runner.getState()).toEqual({ phase: 'idle' });
  });
});
