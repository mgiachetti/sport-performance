import { describe, expect, it } from 'vitest';
import {
  CANONICAL_METRICS,
  DEFAULT_REACTION_PROTOCOL,
  DomainValidationError,
  REACTION_METRIC_BY_TASK,
  assertReactionProtocol,
  classifyReactionResponse,
  isSameDeviceOnlyProtocol,
  nextReactionTrial,
  reactionHistoryOnDevice,
  reactionProtocol,
  recordReactionTrial,
  summarizeReactionSeries,
  type ReactionProtocol,
  type ReactionResponse,
  type ReactionTask,
  type ReactionTrialRecord,
} from '../index.js';

const P = DEFAULT_REACTION_PROTOCOL;

/** A repeatable `random`: cycles through `values`. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => {
    const value = values[i % values.length] ?? 0;
    i += 1;
    return value;
  };
}

/** Plays a series answering each stimulus with `answer` until it ends. */
function play(
  task: ReactionTask,
  answer: (trial: {
    stimulus: 'go' | 'no_go';
    index: number;
    practice: boolean;
  }) => ReactionResponse,
  protocol: ReactionProtocol = P,
  random: () => number = sequence(0.1, 0.5, 0.9, 0.2, 0.7),
): ReactionTrialRecord[] {
  const records: ReactionTrialRecord[] = [];
  for (let guard = 0; guard < 500; guard += 1) {
    const trial = nextReactionTrial(task, records, protocol, random);
    if (trial === null) return records;
    records.push(recordReactionTrial(trial, answer(trial), protocol));
  }
  throw new Error('the series never ended');
}

const touch = (reactionMs: number): ReactionResponse => ({ kind: 'touch', reactionMs });

describe('reaction protocol', () => {
  it('records the canonical reaction metrics in milliseconds', () => {
    for (const code of Object.values(REACTION_METRIC_BY_TASK)) {
      expect(CANONICAL_METRICS[code].unit).toBe('msec');
      expect(CANONICAL_METRICS[code].direction).toBe('lower_is_better');
    }
  });

  it('takes the valid stimuli from the attempt count and the rest from the parameters', () => {
    expect(reactionProtocol(null)).toEqual(P);
    expect(reactionProtocol({ sameDeviceOnly: true }, 5)).toEqual(P);
    const read = reactionProtocol({ practiceTrials: 2, foreperiodMaxMs: 4000, noGoShare: 0.25 }, 8);
    expect(read).toMatchObject({
      validTrials: 8,
      practiceTrials: 2,
      foreperiodMaxMs: 4000,
      noGoShare: 0.25,
      maxTrialsPerSeries: 32,
    });
  });

  it('falls back to the default for a malformed setting, and to the whole default for an impossible mix', () => {
    expect(reactionProtocol({ practiceTrials: -1, anticipationMs: 'x' })).toEqual(P);
    // A window shorter than the anticipation threshold: no touch could ever be valid.
    expect(reactionProtocol({ responseWindowMs: 80, foreperiodMinMs: 500 }, 6)).toEqual({
      ...P,
      validTrials: 6,
      maxTrialsPerSeries: 24,
    });
    expect(() => {
      assertReactionProtocol({ ...P, maxTrialsPerSeries: 3 });
    }).toThrow(DomainValidationError);
    expect(() => {
      assertReactionProtocol({ ...P, noGoShare: 1 });
    }).toThrow(DomainValidationError);
  });

  it('says which protocols are compared only on the same device', () => {
    expect(isSameDeviceOnlyProtocol({ sameDeviceOnly: true })).toBe(true);
    expect(isSameDeviceOnlyProtocol({ sameDeviceOnly: 'true' })).toBe(false);
    expect(isSameDeviceOnlyProtocol(null)).toBe(false);
  });
});

describe('classifying a response', () => {
  it('a go touched in time is valid; too fast or before the stimulus is an anticipation', () => {
    expect(classifyReactionResponse('go', touch(240), P)).toBe('valid');
    expect(classifyReactionResponse('go', touch(100), P)).toBe('valid');
    expect(classifyReactionResponse('go', touch(99), P)).toBe('anticipation');
    expect(classifyReactionResponse('go', { kind: 'early' }, P)).toBe('anticipation');
    expect(classifyReactionResponse('go', touch(Number.NaN), P)).toBe('anticipation');
  });

  it('a go without a touch in the window is a lapse', () => {
    expect(classifyReactionResponse('go', { kind: 'none' }, P)).toBe('lapse');
    expect(classifyReactionResponse('go', touch(1001), P)).toBe('lapse');
  });

  it('a no-go touched is a commission; held, a correct rejection', () => {
    expect(classifyReactionResponse('no_go', touch(300), P)).toBe('commission');
    expect(classifyReactionResponse('no_go', { kind: 'none' }, P)).toBe('correct_rejection');
    expect(classifyReactionResponse('no_go', { kind: 'early' }, P)).toBe('anticipation');
  });

  it('keeps the time of a touch in whole milliseconds', () => {
    const trial = { index: 3, practice: false, stimulus: 'go' as const, foreperiodMs: 1500 };
    expect(recordReactionTrial(trial, touch(251.6), P)).toEqual({
      ...trial,
      outcome: 'valid',
      reactionMs: 252,
    });
    expect(recordReactionTrial(trial, { kind: 'early' }, P).reactionMs).toBeNull();
  });
});

describe('a simple series', () => {
  it('starts with practice, then ends with the planned valid stimuli and their mean', () => {
    const times = [400, 380, 360, 250, 260, 270, 240, 230];
    const records = play('simple', (trial) => touch(times[trial.index] ?? 999));
    expect(records.map((r) => r.practice)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(records.every((r) => r.stimulus === 'go')).toBe(true);
    const summary = summarizeReactionSeries('simple', records, P);
    expect(summary).toMatchObject({
      status: 'complete',
      validMs: [250, 260, 270, 240, 230],
      meanMs: 250,
      anticipations: 0,
      scoredTrials: 5,
    });
  });

  it('repeats anticipations and lapses until the valid ones are in', () => {
    const answers: ReactionResponse[] = [
      touch(300),
      touch(300),
      touch(300),
      { kind: 'early' },
      touch(250),
      { kind: 'none' },
      touch(50),
      touch(260),
      touch(270),
      touch(280),
      touch(290),
    ];
    const records = play('simple', (trial) => answers[trial.index] ?? touch(999));
    const summary = summarizeReactionSeries('simple', records, P);
    expect(summary).toMatchObject({
      status: 'complete',
      validMs: [250, 260, 270, 280, 290],
      meanMs: 270,
      anticipations: 2,
      lapses: 1,
      scoredTrials: 8,
    });
  });

  it('is incomplete past the cap of stimuli, and then nothing more is planned', () => {
    const records = play('simple', () => ({ kind: 'early' }));
    const summary = summarizeReactionSeries('simple', records, P);
    expect(summary.status).toBe('incomplete');
    expect(summary.meanMs).toBeNull();
    expect(summary.scoredTrials).toBe(P.maxTrialsPerSeries);
    expect(nextReactionTrial('simple', records, P, Math.random)).toBeNull();
  });

  it('draws the wait within the protocol range', () => {
    const records = play('simple', () => touch(250), P, sequence(0, 0.999_999, 0.5));
    for (const record of records) {
      expect(record.foreperiodMs).toBeGreaterThanOrEqual(P.foreperiodMinMs);
      expect(record.foreperiodMs).toBeLessThanOrEqual(P.foreperiodMaxMs);
      expect(Number.isInteger(record.foreperiodMs)).toBe(true);
    }
    expect(records[0]?.foreperiodMs).toBe(1000);
    expect(records[1]?.foreperiodMs).toBe(3000);
  });
});

describe('a go/no-go series', () => {
  const perfect = (trial: { stimulus: 'go' | 'no_go' }): ReactionResponse =>
    trial.stimulus === 'go' ? touch(320) : { kind: 'none' };

  it('scores only the go stimuli and counts the commissions', () => {
    const records = play('go_no_go', (trial) =>
      trial.stimulus === 'go' ? touch(300 + trial.index) : touch(350),
    );
    const summary = summarizeReactionSeries('go_no_go', records, P);
    expect(summary.status).toBe('complete');
    expect(summary.validMs).toHaveLength(5);
    expect(summary.commissions).toBe(summary.noGoTrials);
    expect(summary.correctRejections).toBe(0);
  });

  it('shows a no-go in practice, never first, and never more than two in a row', () => {
    // Always "no-go" when free to draw: the rules decide.
    const records = play('go_no_go', perfect, P, () => 0);
    expect(records[0]?.stimulus).toBe('go');
    expect(records.filter((r) => r.practice).some((r) => r.stimulus === 'no_go')).toBe(true);
    let run = 0;
    for (const record of records) {
      run = record.stimulus === 'no_go' ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(P.maxNoGoInARow);
    }
    expect(summarizeReactionSeries('go_no_go', records, P)).toMatchObject({
      status: 'complete',
      meanMs: 320,
      commissions: 0,
    });
  });

  it('draws mostly go stimuli with the standard share', () => {
    const records = play('go_no_go', perfect, P, () => 0.5);
    expect(records.filter((r) => !r.practice).every((r) => r.stimulus === 'go')).toBe(true);
  });
});

describe('comparing a result', () => {
  it('keeps only the same player on the same device, oldest first', () => {
    const points = [
      { playerId: 'p1', deviceId: 'd1', measuredOn: '2026-07-10', valueMs: 260 },
      { playerId: 'p1', deviceId: 'd2', measuredOn: '2026-04-10', valueMs: 230 },
      { playerId: 'p2', deviceId: 'd1', measuredOn: '2026-04-10', valueMs: 210 },
      { playerId: 'p1', deviceId: null, measuredOn: '2026-03-01', valueMs: 240 },
      { playerId: 'p1', deviceId: 'd1', measuredOn: '2026-02-10', valueMs: 280 },
    ];
    expect(reactionHistoryOnDevice(points, 'p1', 'd1').map((p) => p.valueMs)).toEqual([280, 260]);
  });
});
