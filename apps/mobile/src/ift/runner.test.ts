import {
  DEFAULT_IFT_3015_SIGNAL_PROTOCOL,
  ift3015Schedule,
  ift3015StageStartMs,
  ift3015TestEndMs,
  type Ift3015SignalProtocol,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { memorySecureStorage } from '../platform/storage.ts';
import {
  DEFAULT_MAX_RESUME_GAP_MS,
  createIftRunner,
  type IftRunnerState,
  type Timers,
} from './runner.ts';
import { IFT_RUN_STORAGE_KEY, createSecureIftRunStore, parseIftRunSnapshot } from './run-store.ts';
import { recordingSignalPlayer } from './signal-player.ts';
import { CUE_SOUNDS } from './tones.ts';

const SCOPE = { userId: 'user-1', membershipId: 'membership-1' };
const P = DEFAULT_IFT_3015_SIGNAL_PROTOCOL;
const SHORT: Ift3015SignalProtocol = { ...P, maxStages: 3 };

/**
 * A monotonic clock and timers that run in order as time advances; each
 * timer fires `lagMs` after it is due, like a busy JS thread.
 */
function fakeTime(startMs = 1_000_000) {
  let now = startMs;
  let wall = 1_790_000_000_000;
  let lagMs = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: Timers = {
    setTimeout(callback, delayMs) {
      const id = ++seq;
      pending.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    clock: { now: () => now },
    wallClock: () => wall,
    timers,
    setLag(ms: number) {
      lagMs = ms;
    },
    /** Moves both clocks forward, firing every timer due on the way. */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        let nextId: number | null = null;
        let nextAt = Infinity;
        for (const [id, t] of pending) {
          if (t.at + lagMs < nextAt) {
            nextAt = t.at + lagMs;
            nextId = id;
          }
        }
        if (nextId === null || nextAt > end) break;
        const t = pending.get(nextId);
        pending.delete(nextId);
        wall += Math.max(0, nextAt - now);
        now = Math.max(now, nextAt);
        t?.callback();
      }
      wall += end - now;
      now = end;
    },
    /** The app was killed: the wall clock moves on, nothing runs. */
    killFor(ms: number) {
      pending.clear();
      wall += ms;
      now += ms;
    },
  };
}

function setup(protocol: Ift3015SignalProtocol = P) {
  const time = fakeTime();
  const audio = recordingSignalPlayer();
  const storage = memorySecureStorage();
  const store = createSecureIftRunStore(storage);
  const errors: unknown[] = [];
  let uuid = 0;
  const make = () =>
    createIftRunner({
      clock: time.clock,
      wallClock: time.wallClock,
      timers: time.timers,
      audio,
      store,
      randomUUID: () => `run-${String(++uuid)}`,
      reportError: (error) => errors.push(error),
    });
  const runner = make();
  let t0 = 0;
  audio.now = () => time.clock.now() - t0;
  const start = async (playerIds = ['a', 'b']) => {
    await runner.start({ scope: SCOPE, protocol, playerIds, categoryId: 'cat-1' });
    // Elapsed 0 = start of stage 1.
    t0 = time.clock.now() + protocol.leadInS * 1000;
  };
  return { time, audio, storage, store, errors, runner, make, start };
}

function running(state: IftRunnerState) {
  if (state.status !== 'running') throw new Error(`not running: ${state.status}`);
  return state;
}

function marksOf(state: IftRunnerState, playerId: string) {
  if (!('run' in state)) throw new Error('no run');
  const marks = state.run.players.find((p) => p.playerId === playerId);
  if (marks === undefined) throw new Error(`no player ${playerId}`);
  return marks;
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('IFT runner', () => {
  it('prepares the audio, keeps the session and starts with the lead-in', async () => {
    const { runner, audio, start, store } = setup();
    await start();
    expect(audio.calls).toEqual(['prepare', 'beginSession']);
    const state = running(runner.getState());
    expect(state.elapsedMs).toBe(-P.leadInS * 1000);
    expect(state.moment.phase).toBe('lead_in');
    await flush();
    expect((await store.load())?.players.map((p) => p.playerId)).toEqual(['a', 'b']);
  });

  it('plays every cue of the schedule exactly on time', async () => {
    const { runner, audio, time, start } = setup(SHORT);
    await start();
    time.advance(SHORT.leadInS * 1000 + ift3015TestEndMs(SHORT) + 1_000);
    const expected = ift3015Schedule(SHORT).map((cue) => ({
      sound: CUE_SOUNDS[cue.kind],
      atMs: cue.atMs,
    }));
    expect(audio.played).toEqual(expected);
    const state = runner.getState();
    expect(state.status).toBe('finished');
    expect(audio.calls.at(-1)).toBe('endSession');
    // Everybody completed the 3 stages of the recording.
    expect(marksOf(state, 'a')).toMatchObject({ outcome: 'completed', lastCompletedStage: 3 });
  });

  it('does not drift when every timer fires late', async () => {
    const { audio, time, start } = setup(SHORT);
    await start();
    time.setLag(40);
    time.advance(SHORT.leadInS * 1000 + ift3015TestEndMs(SHORT) + 100);
    const schedule = ift3015Schedule(SHORT);
    expect(audio.played).toHaveLength(schedule.length);
    audio.played.forEach((played, i) => {
      const lateness = played.atMs - (schedule[i]?.atMs ?? NaN);
      expect(lateness).toBeGreaterThanOrEqual(0);
      expect(lateness).toBeLessThanOrEqual(40);
    });
  });

  it('skips cues that came due while the phone could not play them', async () => {
    const { runner, audio, time, start } = setup();
    await start();
    time.advance(P.leadInS * 1000 + 8_000);
    const before = audio.played.length;
    // The JS thread is blocked for 3 s across the first line signal (9 s).
    time.setLag(3_000);
    time.advance(1_500);
    time.setLag(0);
    runner.wake();
    expect(audio.played.length).toBe(before);
    expect(running(runner.getState()).skippedCues).toBe(1);
    time.advance(9_000);
    expect(audio.played.at(-1)).toMatchObject({ sound: 'line', atMs: 18_000 });
  });

  it('records the marks of the staff and keeps the test open when everybody is out', async () => {
    const { runner, audio, time, start, store } = setup();
    await start();
    // Into stage 2 run: `a` stops.
    time.advance(P.leadInS * 1000 + ift3015StageStartMs(2, P) + 5_000);
    runner.stop('a');
    expect(marksOf(runner.getState(), 'a')).toMatchObject({
      outcome: 'stopped',
      lastCompletedStage: 1,
    });
    // `b` misses the first line of stage 2 (54 471 ms), then undo.
    time.advance(55_000 - (ift3015StageStartMs(2, P) + 5_000));
    runner.miss('b');
    expect(marksOf(runner.getState(), 'b').misses).toEqual([3]);
    runner.undo('b');
    expect(marksOf(runner.getState(), 'b').misses).toEqual([]);
    // `b` marked out by mistake: the test stays open and the mark can be undone.
    runner.stop('b');
    expect(running(runner.getState()).allOut).toBe(true);
    runner.undo('b');
    expect(running(runner.getState()).allOut).toBe(false);
    expect(marksOf(runner.getState(), 'b').outcome).toBe('running');
    runner.stop('b');
    expect(running(runner.getState()).allOut).toBe(true);
    runner.finish();
    const state = runner.getState();
    expect(state.status).toBe('finished');
    expect(audio.played.at(-1)?.sound).toBe('end');
    await flush();
    const saved = await store.load();
    expect(saved).toMatchObject({ status: 'finished', endedBy: 'staff' });
    expect(saved?.players.map((p) => p.lastCompletedStage)).toEqual([1, 1]);
  });

  it('ends the test on demand and lets the staff correct a stage', async () => {
    const { runner, time, start } = setup();
    await start();
    time.advance(P.leadInS * 1000 + ift3015StageStartMs(6, P) + 2_000);
    runner.finish();
    let state = runner.getState();
    expect(state.status).toBe('finished');
    expect(marksOf(state, 'a').lastCompletedStage).toBe(5);
    runner.adjust('a', 6);
    state = runner.getState();
    expect(marksOf(state, 'a').adjustedStage).toBe(6);
    // After the end an undo only reverts a correction.
    runner.undo('a');
    runner.undo('b');
    state = runner.getState();
    expect(marksOf(state, 'a')).toMatchObject({ adjustedStage: null, outcome: 'stopped' });
    expect(marksOf(state, 'b').outcome).toBe('stopped');
  });

  it('saves a heartbeat while it runs', async () => {
    const { time, start, store } = setup();
    await start();
    time.advance(5_400);
    await flush();
    const saved = await store.load();
    expect(time.wallClock() - (saved?.lastAliveWallMs ?? 0)).toBeLessThanOrEqual(1_000);
  });

  it('restores a run after the app is killed and resumes at the stage under way', async () => {
    const first = setup();
    await first.start();
    first.time.advance(P.leadInS * 1000 + 20_000);
    first.runner.miss('a');
    first.time.advance(50_000); // 70 s: stage 2 run (45–75 s)
    await flush();
    first.time.killFor(10_000); // now at 80 s: stage 2 recovery (75–90 s)
    const runner = first.make();
    await runner.restore(SCOPE);
    const state = runner.getState();
    if (state.status !== 'interrupted') throw new Error(state.status);
    // Where it was when the app died, not where it would be now.
    expect(state.moment).toMatchObject({ phase: 'run', stage: 2 });
    expect(state.stoppedAtMs).toBeGreaterThan(69_000);
    expect(state.stoppedAtMs).toBeLessThanOrEqual(70_000);
    expect(state.resumable).toBe(true);
    expect(marksOf(state, 'a').misses).toEqual([1]);
    // Marks wait for the resume.
    runner.stop('b');
    expect(marksOf(runner.getState(), 'b').outcome).toBe('running');
    first.audio.played.length = 0;
    await runner.resume();
    expect(running(runner.getState()).moment).toMatchObject({ phase: 'recovery', stage: 2 });
    first.time.advance(11_000);
    // Countdown of stage 3 at 87, 88, 89 s, then its start at 90 s.
    expect(first.audio.played.map((p) => p.sound)).toEqual(['pip', 'pip', 'pip', 'go']);
  });

  it('stops offering to resume once the gap is too long', async () => {
    const first = setup();
    await first.start();
    first.time.advance(P.leadInS * 1000 + 20_000);
    await flush();
    first.time.killFor(DEFAULT_MAX_RESUME_GAP_MS - 5_000);
    const runner = first.make();
    await runner.restore(SCOPE);
    expect(runner.getState()).toMatchObject({ status: 'interrupted', resumable: true });
    first.time.advance(6_000);
    expect(runner.getState()).toMatchObject({ status: 'interrupted', resumable: false });
    first.audio.calls.length = 0;
    await runner.resume();
    expect(runner.getState()).toMatchObject({ status: 'interrupted', resumable: false });
    expect(first.audio.calls).toEqual([]);
  });

  it('ends an interrupted run at the last moment it was playing, never when reopened', async () => {
    const first = setup(SHORT);
    await first.start();
    first.time.advance(SHORT.leadInS * 1000 + 50_000);
    await flush();
    first.time.killFor(5_000);
    const a = first.make();
    await a.restore(SCOPE);
    a.finish();
    expect(marksOf(a.getState(), 'a')).toMatchObject({ outcome: 'stopped', lastCompletedStage: 1 });

    // Reopened long after the last stage: still the stage it was at, not every stage.
    const second = setup();
    await second.start();
    second.time.advance(P.leadInS * 1000 + ift3015StageStartMs(3, P) + 10_000);
    await flush();
    second.time.killFor(30 * 60_000);
    const b = second.make();
    await b.restore(SCOPE);
    expect(b.getState()).toMatchObject({ status: 'interrupted', resumable: false });
    await b.resume();
    expect(b.getState().status).toBe('interrupted');
    b.finish();
    const state = b.getState();
    if (state.status !== 'finished') throw new Error(state.status);
    expect(state.run.endedBy).toBe('interrupted');
    expect(marksOf(state, 'a')).toMatchObject({ outcome: 'stopped', lastCompletedStage: 2 });
    await flush();
    expect((await second.store.load())?.endedBy).toBe('interrupted');
  });

  it("never shows another user's or club's run, and forgets a discarded one", async () => {
    const first = setup();
    await first.start();
    await flush();
    const other = first.make();
    await other.restore({ ...SCOPE, membershipId: 'membership-2' });
    expect(other.getState().status).toBe('idle');
    expect(first.storage.entries.has(IFT_RUN_STORAGE_KEY)).toBe(false);

    const again = setup();
    await again.start();
    await again.runner.discard();
    expect(again.runner.getState().status).toBe('idle');
    expect(again.storage.entries.has(IFT_RUN_STORAGE_KEY)).toBe(false);
    expect(again.audio.calls.at(-1)).toBe('endSession');
  });

  it('drops the run in memory when another user or club opens the screen', async () => {
    const { runner, start, audio } = setup();
    await start();
    expect(runner.getState().status).toBe('running');
    await runner.restore({ userId: 'user-2', membershipId: 'membership-9' });
    expect(runner.getState().status).toBe('idle');
    expect(audio.calls.at(-1)).toBe('endSession');
  });

  it('stops and forgets the run of a session that left, wherever the screen is', async () => {
    const { runner, start, audio, storage, store } = setup();
    await start();
    await flush();
    // Same user and club (a refresh): nothing changes.
    await runner.leaveScope(SCOPE);
    expect(runner.getState().status).toBe('running');
    expect(storage.entries.has(IFT_RUN_STORAGE_KEY)).toBe(true);
    // Signed out: no signals, no marks left on the device.
    await runner.leaveScope(null);
    expect(runner.getState().status).toBe('idle');
    expect(audio.calls.at(-1)).toBe('endSession');
    expect(storage.entries.has(IFT_RUN_STORAGE_KEY)).toBe(false);

    // A run left on the device by another club goes when the session moves on.
    const other = setup();
    await other.start();
    await flush();
    other.time.killFor(1_000);
    const fresh = other.make();
    await fresh.leaveScope({ ...SCOPE, membershipId: 'membership-2' });
    expect(other.storage.entries.has(IFT_RUN_STORAGE_KEY)).toBe(false);
    expect(await store.load()).toBeNull();
  });

  it('gives the audio back if the run is dropped while it is being prepared', async () => {
    const { runner, audio } = setup();
    let release: () => void = () => undefined;
    audio.prepare = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const starting = runner.start({
      scope: SCOPE,
      protocol: P,
      playerIds: ['a'],
      categoryId: null,
    });
    expect(runner.getState().status).toBe('preparing');
    await runner.leaveScope(null);
    expect(runner.getState().status).toBe('idle');
    release();
    await starting;
    expect(runner.getState().status).toBe('idle');
    expect(audio.calls).toEqual(['beginSession', 'endSession']);
  });

  it('goes back to idle if the audio cannot be prepared', async () => {
    const { runner, audio, errors } = setup();
    audio.prepare = () => Promise.reject(new Error('no audio'));
    await expect(
      runner.start({ scope: SCOPE, protocol: P, playerIds: ['a'], categoryId: null }),
    ).rejects.toThrow('no audio');
    expect(runner.getState().status).toBe('idle');
    expect(errors).toHaveLength(1);
  });

  it('stores ids and numbers only', async () => {
    const { start, storage } = setup();
    await start(['a']);
    await flush();
    const text = storage.entries.get(IFT_RUN_STORAGE_KEY) ?? '';
    const parsed = parseIftRunSnapshot(text);
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed ?? {}).sort()).toEqual(
      [
        'categoryId',
        'endedAtMs',
        'endedBy',
        'lastAliveWallMs',
        'players',
        'protocol',
        'runId',
        'scope',
        'stage1WallMs',
        'status',
        'version',
      ].sort(),
    );
    expect(parseIftRunSnapshot('{"version":2}')).toBeNull();
    expect(parseIftRunSnapshot('nope')).toBeNull();
    expect(parseIftRunSnapshot(text.replace('"running"', '"paused"'))).toBeNull();
  });
});
