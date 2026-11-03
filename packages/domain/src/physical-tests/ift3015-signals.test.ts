import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IFT_3015_PROTOCOL,
  DEFAULT_IFT_3015_SIGNAL_PROTOCOL,
  DomainValidationError,
  adjustIft3015Stage,
  dueIft3015Cues,
  finishIft3015,
  ift3015CueIndexAfter,
  ift3015LineCueAtOrBefore,
  ift3015LineOffsetMs,
  ift3015MissStreak,
  ift3015MomentAt,
  ift3015PlayerResult,
  ift3015RunEndMs,
  ift3015Schedule,
  ift3015SignalProtocol,
  ift3015StageCompletedAt,
  ift3015StageStartMs,
  ift3015TestEndMs,
  newIft3015PlayerMarks,
  recordIft3015Miss,
  stopIft3015Player,
  undoIft3015Mark,
  type Ift3015Cue,
  type Ift3015PlayerMarks,
  type Ift3015SignalProtocol,
} from '../index.js';

const P = DEFAULT_IFT_3015_SIGNAL_PROTOCOL;
const SCHEDULE = ift3015Schedule(P);

function cuesOfStage(stage: number, schedule: readonly Ift3015Cue[] = SCHEDULE) {
  return schedule.filter((cue) => cue.stage === stage);
}

function lineCue(lineIndex: number): Ift3015Cue {
  const cue = SCHEDULE.find((c) => c.lineIndex === lineIndex);
  if (cue === undefined) throw new Error(`no line ${String(lineIndex)}`);
  return cue;
}

describe('30-15 IFT signal protocol', () => {
  it('extends the scoring protocol with the standard timing (Buchheit 2008)', () => {
    expect(P).toMatchObject({ ...DEFAULT_IFT_3015_PROTOCOL });
    expect(P.workDurationS + P.recoveryDurationS).toBe(P.stageDurationS);
    expect(P).toMatchObject({
      workDurationS: 30,
      recoveryDurationS: 15,
      shuttleLengthM: 40,
      lineSpacingM: 20,
      toleranceZoneM: 3,
      missesToStop: 3,
    });
    // The last stage is past any plausible VIFT (25 km/h).
    expect(P.initialSpeedKmh + (P.maxStages - 1) * P.stageIncrementKmh).toBeGreaterThan(25);
  });

  it('reads a protocol version, falling back per setting', () => {
    expect(ift3015SignalProtocol(null)).toEqual(P);
    expect(ift3015SignalProtocol({ ...DEFAULT_IFT_3015_PROTOCOL })).toEqual(P);
    expect(
      ift3015SignalProtocol({ maxStages: 30, missesToStop: 2, countdownS: 5, leadInS: 'x' }),
    ).toEqual({ ...P, maxStages: 30, missesToStop: 2, countdownS: 5 });
    expect(ift3015SignalProtocol({ maxStages: 0, lineSpacingM: -1 })).toEqual(P);
  });

  it('never mixes a timing that does not add up', () => {
    // 20 s of recovery in a 45 s stage: the whole default timing, the club's speeds.
    expect(
      ift3015SignalProtocol({ recoveryDurationS: 20, initialSpeedKmh: 9, maxStages: 30 }),
    ).toEqual({ ...P, initialSpeedKmh: 9, maxStages: 30 });
    // A different progression that adds up is kept whole.
    const custom = {
      stageDurationS: 40,
      workDurationS: 25,
      recoveryDurationS: 15,
      shuttleLengthM: 60,
      lineSpacingM: 30,
    };
    expect(ift3015SignalProtocol(custom)).toEqual({ ...P, ...custom });
    expect(ift3015SignalProtocol({ shuttleLengthM: 50 })).toEqual(P);
  });

  it('rejects settings that cannot be played', () => {
    const bad: Ift3015SignalProtocol[] = [
      { ...P, recoveryDurationS: 10 },
      { ...P, countdownS: 15 },
      { ...P, leadInS: 2 },
      { ...P, stopGraceS: 15 },
      { ...P, lineSpacingM: 15 },
      { ...P, maxStages: 0 },
    ];
    for (const protocol of bad) {
      expect(() => ift3015Schedule(protocol)).toThrow(DomainValidationError);
    }
  });
});

describe('30-15 IFT schedule', () => {
  it('times the stages: 30 s run and 15 s recovery from stage 1 at 0', () => {
    expect(ift3015StageStartMs(1, P)).toBe(0);
    expect(ift3015StageStartMs(2, P)).toBe(45_000);
    expect(ift3015RunEndMs(1, P)).toBe(30_000);
    expect(ift3015TestEndMs(P)).toBe(39 * 45_000 + 30_000);
  });

  it('computes the line offsets exactly (k · 20 m / speed)', () => {
    // 8 km/h = 2.222 m/s: 20 m every 9 s.
    expect(ift3015LineOffsetMs(1, 8, 20)).toBe(9_000);
    expect(ift3015LineOffsetMs(3, 8, 20)).toBe(27_000);
    // 8.5 km/h: 20 m every 8.470588 s, rounded to the millisecond.
    expect(ift3015LineOffsetMs(1, 8.5, 20)).toBe(8_471);
    expect(ift3015LineOffsetMs(2, 8.5, 20)).toBe(16_941);
    expect(ift3015LineOffsetMs(5, 12, 20)).toBe(30_000);
  });

  it('plays a countdown, the start, a signal per line and the end of each run', () => {
    expect(
      cuesOfStage(1).map((cue) => [cue.kind, cue.atMs, cue.lineIndex, cue.secondsLeft]),
    ).toEqual([
      ['countdown', -3_000, null, 3],
      ['countdown', -2_000, null, 2],
      ['countdown', -1_000, null, 1],
      ['stage_start', 0, null, null],
      ['line', 9_000, 0, null],
      ['line', 18_000, 1, null],
      ['line', 27_000, 2, null],
      ['run_end', 30_000, null, null],
    ]);
    // Stage 2 (8.5 km/h): countdown in the recovery of stage 1.
    const stage2 = cuesOfStage(2);
    expect(stage2[0]).toMatchObject({ kind: 'countdown', atMs: 42_000 });
    expect(stage2.filter((cue) => cue.kind === 'line').map((cue) => cue.atMs)).toEqual([
      45_000 + 8_471,
      45_000 + 16_941,
      45_000 + 25_412,
    ]);
  });

  it('makes the end of the run the line signal when both fall together', () => {
    // Stage 9 runs at 12 km/h: 5 lines of 20 m in exactly 30 s.
    const stage9 = cuesOfStage(9);
    const lines = stage9.filter((cue) => cue.lineIndex !== null);
    expect(lines).toHaveLength(5);
    expect(lines.at(-1)).toMatchObject({ kind: 'run_end', atMs: ift3015RunEndMs(9, P) });
    expect(stage9.filter((cue) => cue.kind === 'run_end')).toHaveLength(1);
  });

  it('numbers the line signals across stages and ends with the test end', () => {
    const lineIndexes = SCHEDULE.flatMap((cue) => (cue.lineIndex === null ? [] : [cue.lineIndex]));
    expect(lineIndexes).toEqual(lineIndexes.map((_, i) => i));
    expect(SCHEDULE.map((cue) => cue.index)).toEqual(SCHEDULE.map((_, i) => i));
    const times = SCHEDULE.map((cue) => cue.atMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(SCHEDULE.at(-1)).toMatchObject({
      kind: 'test_end',
      stage: 40,
      atMs: ift3015TestEndMs(P),
    });
    expect(SCHEDULE.filter((cue) => cue.kind === 'test_end')).toHaveLength(1);
  });

  it('counts the lines a player on pace reaches in each run', () => {
    // Distance in 30 s / 20 m, floored: 66.7 m at 8 km/h → 3 lines.
    for (const stage of [1, 5, 10, 20, 30, 40]) {
      const speedMs = (P.initialSpeedKmh + (stage - 1) * P.stageIncrementKmh) / 3.6;
      const expected = Math.floor((speedMs * 30) / 20 + 1e-9);
      expect(cuesOfStage(stage).filter((cue) => cue.lineIndex !== null)).toHaveLength(expected);
    }
  });

  it('can run without countdown', () => {
    const schedule = ift3015Schedule({ ...P, countdownS: 0, maxStages: 2 });
    expect(schedule.some((cue) => cue.kind === 'countdown')).toBe(false);
    expect(schedule.at(-1)?.kind).toBe('test_end');
  });
});

describe('30-15 IFT moment', () => {
  it('tells the phase, the stage and the time left', () => {
    expect(ift3015MomentAt(P, -4_000)).toMatchObject({
      phase: 'lead_in',
      stage: 1,
      nextSpeedKmh: 8,
      phaseElapsedMs: 6_000,
      phaseRemainingMs: 4_000,
    });
    const run = ift3015MomentAt(P, 9_000);
    expect(run).toMatchObject({ phase: 'run', stage: 1, speedKmh: 8, phaseRemainingMs: 21_000 });
    expect(run.expectedDistanceM).toBeCloseTo(20, 9);
    expect(ift3015MomentAt(P, 30_000)).toMatchObject({
      phase: 'recovery',
      stage: 1,
      nextSpeedKmh: 8.5,
      phaseElapsedMs: 0,
      phaseRemainingMs: 15_000,
      expectedDistanceM: 0,
    });
    expect(ift3015MomentAt(P, 45_000)).toMatchObject({ phase: 'run', stage: 2, speedKmh: 8.5 });
    expect(ift3015MomentAt(P, ift3015TestEndMs(P))).toMatchObject({
      phase: 'finished',
      stage: 40,
      nextSpeedKmh: null,
      phaseRemainingMs: 0,
    });
  });
});

describe('30-15 IFT drift-free scheduling', () => {
  it('returns what is due, and when the next one is', () => {
    const start = ift3015CueIndexAfter(SCHEDULE, -10_000);
    expect(start).toBe(0);
    const first = dueIft3015Cues(SCHEDULE, start, -3_000, 250);
    expect(first.play.map((cue) => cue.secondsLeft)).toEqual([3]);
    expect(first.nextAtMs).toBe(-2_000);
    const none = dueIft3015Cues(SCHEDULE, first.nextIndex, -2_500, 250);
    expect(none.play).toEqual([]);
    expect(none.nextIndex).toBe(first.nextIndex);
  });

  it('never plays a late cue: it skips it', () => {
    // Woke up 1.2 s late for the start: the countdown pips and the start are skipped.
    const due = dueIft3015Cues(SCHEDULE, 0, 1_200, 250);
    expect(due.play).toEqual([]);
    expect(due.skipped.map((cue) => cue.kind)).toEqual([
      'countdown',
      'countdown',
      'countdown',
      'stage_start',
    ]);
    expect(due.nextAtMs).toBe(9_000);
    // Slightly late is still on time.
    expect(dueIft3015Cues(SCHEDULE, 3, 100, 250).play.map((cue) => cue.kind)).toEqual([
      'stage_start',
    ]);
  });

  it('ends after the last cue', () => {
    const due = dueIft3015Cues(SCHEDULE, SCHEDULE.length - 1, ift3015TestEndMs(P), 0);
    expect(due.play.map((cue) => cue.kind)).toEqual(['test_end']);
    expect(due.nextAtMs).toBeNull();
    expect(due.nextIndex).toBe(SCHEDULE.length);
  });

  it('resumes mid-test at the next cue', () => {
    const index = ift3015CueIndexAfter(SCHEDULE, 9_000);
    expect(SCHEDULE[index]).toMatchObject({ kind: 'line', atMs: 18_000 });
    expect(ift3015LineCueAtOrBefore(SCHEDULE, 8_999)).toBeNull();
    expect(ift3015LineCueAtOrBefore(SCHEDULE, 31_000)?.lineIndex).toBe(2);
  });
});

describe('30-15 IFT marks', () => {
  const fresh = newIft3015PlayerMarks('p1');

  function missAt(marks: Ift3015PlayerMarks, atMs: number) {
    return recordIft3015Miss(marks, SCHEDULE, P, atMs);
  }

  it('assigns a miss to the latest line signal, once', () => {
    const once = missAt(fresh, 9_400);
    expect(once.misses).toEqual([0]);
    expect(missAt(once, 9_900)).toBe(once);
    // Before the first line: nothing to miss.
    expect(missAt(fresh, 5_000)).toBe(fresh);
  });

  it('ends the test at three consecutive misses, across stages', () => {
    // Stage 1 has lines 0–2 and stage 2 lines 3–5.
    let marks = missAt(fresh, lineCue(2).atMs + 300);
    marks = missAt(marks, lineCue(3).atMs + 300);
    expect(marks.outcome).toBe('running');
    expect(ift3015MissStreak(marks, SCHEDULE, lineCue(3).atMs + 500)).toBe(2);
    marks = missAt(marks, lineCue(4).atMs + 300);
    expect(marks).toMatchObject({
      outcome: 'missed_lines',
      lastCompletedStage: 1,
      endedAtMs: lineCue(4).atMs,
    });
    // Ended: further taps change nothing.
    expect(missAt(marks, lineCue(5).atMs)).toBe(marks);
  });

  it('resets the streak when a signal passes unmarked', () => {
    let marks = missAt(fresh, lineCue(0).atMs);
    marks = missAt(marks, lineCue(1).atMs);
    expect(ift3015MissStreak(marks, SCHEDULE, lineCue(2).atMs + 100)).toBe(2);
    expect(ift3015MissStreak(marks, SCHEDULE, lineCue(3).atMs + 100)).toBe(0);
    marks = missAt(marks, lineCue(3).atMs + 100);
    marks = missAt(marks, lineCue(4).atMs + 100);
    expect(marks.outcome).toBe('running');
    marks = missAt(marks, lineCue(5).atMs + 100);
    expect(marks).toMatchObject({ outcome: 'missed_lines', lastCompletedStage: 1 });
  });

  it('counts the stage of a stop by the phase', () => {
    expect(ift3015StageCompletedAt(P, -2_000)).toBe(0);
    expect(ift3015StageCompletedAt(P, 10_000)).toBe(0);
    expect(ift3015StageCompletedAt(P, 45_000 + 10_000)).toBe(1);
    // Right after the end of the run of stage 2: the tap is for failing it.
    expect(ift3015StageCompletedAt(P, ift3015RunEndMs(2, P) + 1_999)).toBe(1);
    // Later in the recovery: stage 2 was run in full.
    expect(ift3015StageCompletedAt(P, ift3015RunEndMs(2, P) + 2_000)).toBe(2);
    expect(ift3015StageCompletedAt(P, ift3015TestEndMs(P))).toBe(40);
  });

  it('stops a player, and finishes the rest at the end', () => {
    const stopped = stopIft3015Player(fresh, P, ift3015StageStartMs(12, P) + 5_000);
    expect(stopped).toMatchObject({ outcome: 'stopped', lastCompletedStage: 11 });
    expect(stopIft3015Player(stopped, P, 999_999)).toBe(stopped);

    const players = finishIft3015([stopped, newIft3015PlayerMarks('p2')], P, ift3015TestEndMs(P));
    expect(players[0]).toBe(stopped);
    expect(players[1]).toMatchObject({ outcome: 'completed', lastCompletedStage: 40 });
    // Ended early by the staff mid-run of stage 7.
    const early = finishIft3015([fresh], P, ift3015StageStartMs(7, P) + 1_000);
    expect(early[0]).toMatchObject({ outcome: 'stopped', lastCompletedStage: 6 });
  });

  it('undoes the last mark', () => {
    const one = missAt(fresh, lineCue(0).atMs);
    expect(undoIft3015Mark(one).misses).toEqual([]);
    expect(undoIft3015Mark(fresh)).toBe(fresh);

    let out = missAt(one, lineCue(1).atMs);
    out = missAt(out, lineCue(2).atMs);
    expect(out.outcome).toBe('missed_lines');
    const back = undoIft3015Mark(out);
    expect(back).toMatchObject({ outcome: 'running', misses: [0, 1], lastCompletedStage: null });

    const stopped = stopIft3015Player(one, P, 50_000);
    expect(undoIft3015Mark(stopped)).toMatchObject({ outcome: 'running', misses: [0] });
  });

  it('lets the staff correct the stage, and undo the correction', () => {
    const stopped = stopIft3015Player(fresh, P, ift3015StageStartMs(10, P) + 3_000);
    const corrected = adjustIft3015Stage(stopped, 10, P);
    expect(ift3015PlayerResult(corrected, P)).toMatchObject({
      lastCompletedStage: 10,
      viftKmh: 12.5,
      adjusted: true,
    });
    expect(undoIft3015Mark(corrected)).toEqual(stopped);
    expect(adjustIft3015Stage(stopped, 9, P).adjustedStage).toBeNull();
    expect(() => adjustIft3015Stage(fresh, 3, P)).toThrow(DomainValidationError);
    expect(() => adjustIft3015Stage(stopped, 41, P)).toThrow(DomainValidationError);
    expect(() => adjustIft3015Stage(stopped, 1.5, P)).toThrow(DomainValidationError);
  });

  it('gives the VIFT and the entry the API scores', () => {
    expect(ift3015PlayerResult(fresh, P)).toBeNull();
    const stopped = stopIft3015Player(fresh, P, ift3015StageStartMs(19, P) + 1_000);
    expect(ift3015PlayerResult(stopped, P)).toEqual({
      playerId: 'p1',
      outcome: 'stopped',
      lastCompletedStage: 18,
      viftKmh: 16.5,
      entry: { kind: 'ift_stage', lastCompletedStage: 18 },
      adjusted: false,
    });
    // Did not complete stage 1: no VIFT to record.
    const none = stopIft3015Player(fresh, P, 4_000);
    expect(ift3015PlayerResult(none, P)).toMatchObject({
      lastCompletedStage: 0,
      viftKmh: null,
      entry: null,
    });
  });
});
