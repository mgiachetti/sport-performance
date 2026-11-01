import { describe, expect, it } from 'vitest';
import {
  ATTEMPT_AGGREGATIONS,
  CANONICAL_METRICS,
  DEFAULT_ATTEMPT_SCORING,
  DEFAULT_E1RM_PROTOCOL,
  DEFAULT_IFT_3015_PROTOCOL,
  DomainValidationError,
  SPRINT_VMAX_SEGMENT,
  aggregateAttempts,
  aggregateCanonicalMetricAttempts,
  cmjHeightCmFromFlightTimeS,
  cod505Asymmetry,
  cod505AsymmetryPct,
  e1rmSetIssues,
  epleyE1rmKg,
  flightTimeSFromFrames,
  intermittentRunDistanceM,
  isAttemptAggregation,
  parseAttemptAggregation,
  relativeStrengthKgKg,
  scoreCmj,
  scoreCod505,
  scoreE1rm,
  scoreSprint40,
  segmentSpeedMs,
  sprintVmaxMs,
  vift3015Kmh,
  type AttemptScoredMetricCode,
} from '../index.js';

function expectInvalid(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainValidationError);
  expect((caught as DomainValidationError).code).toBe('invalid_argument');
}

const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe('attempt aggregation', () => {
  it('is a closed enumeration', () => {
    expect(ATTEMPT_AGGREGATIONS).toEqual(['best', 'mean']);
    expect(isAttemptAggregation('best')).toBe(true);
    expect(isAttemptAggregation('max')).toBe(false);
    expect(parseAttemptAggregation('mean')).toBe('mean');
    expectInvalid(() => parseAttemptAggregation('median'));
  });

  it('picks the highest value when higher is better', () => {
    expect(
      aggregateAttempts([31.2, 33.4, 32.9], { aggregation: 'best', direction: 'higher_is_better' }),
    ).toEqual({ value: 33.4, aggregation: 'best', attemptCount: 3, selectedIndex: 1 });
  });

  it('picks the lowest value when lower is better', () => {
    expect(
      aggregateAttempts([5.61, 5.48, 5.52], { aggregation: 'best', direction: 'lower_is_better' }),
    ).toMatchObject({ value: 5.48, selectedIndex: 1 });
  });

  it('keeps the earliest attempt on a tie', () => {
    expect(
      aggregateAttempts([30, 32, 32], { aggregation: 'best', direction: 'higher_is_better' })
        .selectedIndex,
    ).toBe(1);
  });

  it('averages every attempt for mean, in any direction', () => {
    const result = aggregateAttempts([30, 32, 34], { aggregation: 'mean', direction: 'neutral' });
    expect(result).toEqual({
      value: 32,
      aggregation: 'mean',
      attemptCount: 3,
      selectedIndex: null,
    });
  });

  it('handles a single attempt', () => {
    expect(
      aggregateAttempts([7.1], { aggregation: 'best', direction: 'lower_is_better' }),
    ).toMatchObject({ value: 7.1, attemptCount: 1, selectedIndex: 0 });
  });

  it('rejects empty lists, non-finite values and best on a neutral metric', () => {
    expectInvalid(() => aggregateAttempts([], { aggregation: 'mean', direction: 'neutral' }));
    for (const value of NON_FINITE) {
      expectInvalid(() =>
        aggregateAttempts([30, value], { aggregation: 'best', direction: 'higher_is_better' }),
      );
    }
    expectInvalid(() => aggregateAttempts([1, 2], { aggregation: 'best', direction: 'neutral' }));
  });

  it('defines the default scoring as data for canonical test metrics with a direction', () => {
    for (const [code, scoring] of Object.entries(DEFAULT_ATTEMPT_SCORING)) {
      const metric = CANONICAL_METRICS[code as AttemptScoredMetricCode];
      expect(metric.source).toBe('test');
      expect(metric.direction).not.toBe('neutral');
      expect(isAttemptAggregation(scoring.aggregation)).toBe(true);
      expect(Number.isInteger(scoring.plannedAttempts)).toBe(true);
      expect(scoring.plannedAttempts).toBeGreaterThan(0);
    }
    expect(DEFAULT_ATTEMPT_SCORING.cmj_height_cm).toEqual({
      aggregation: 'best',
      plannedAttempts: 3,
    });
    expect(JSON.parse(JSON.stringify(DEFAULT_ATTEMPT_SCORING))).toEqual(DEFAULT_ATTEMPT_SCORING);
  });

  it('uses the canonical direction and default aggregation of a metric', () => {
    expect(aggregateCanonicalMetricAttempts('sprint_40_s', [5.6, 5.5]).value).toBe(5.5);
    expect(aggregateCanonicalMetricAttempts('cmj_height_cm', [30, 34]).value).toBe(34);
    expect(aggregateCanonicalMetricAttempts('cmj_height_cm', [30, 34], 'mean').value).toBe(32);
  });
});

describe('CMJ by flight time', () => {
  it('computes h = g·t²/8 in cm', () => {
    // 0.5 s → 9.81 × 0.25 / 8 = 0.3065625 m
    expect(cmjHeightCmFromFlightTimeS(0.5)).toBeCloseTo(30.65625, 10);
    expect(cmjHeightCmFromFlightTimeS(0.4)).toBeCloseTo(19.62, 10);
  });

  it('accepts another gravity', () => {
    expect(cmjHeightCmFromFlightTimeS(0.5, 9.8)).toBeCloseTo(30.625, 10);
  });

  it('rejects non-positive or non-finite inputs', () => {
    for (const value of [0, -0.4, ...NON_FINITE]) {
      expectInvalid(() => cmjHeightCmFromFlightTimeS(value));
      expectInvalid(() => cmjHeightCmFromFlightTimeS(0.5, value));
    }
  });

  it('converts video frames to flight time', () => {
    expect(flightTimeSFromFrames({ takeoffFrame: 100, landingFrame: 220, frameRateFps: 240 })).toBe(
      0.5,
    );
  });

  it('rejects inconsistent frames', () => {
    expectInvalid(() =>
      flightTimeSFromFrames({ takeoffFrame: 120, landingFrame: 120, frameRateFps: 240 }),
    );
    expectInvalid(() =>
      flightTimeSFromFrames({ takeoffFrame: 120, landingFrame: 100, frameRateFps: 240 }),
    );
    expectInvalid(() =>
      flightTimeSFromFrames({ takeoffFrame: 1.5, landingFrame: 100, frameRateFps: 240 }),
    );
    expectInvalid(() =>
      flightTimeSFromFrames({ takeoffFrame: -1, landingFrame: 100, frameRateFps: 240 }),
    );
    expectInvalid(() =>
      flightTimeSFromFrames({ takeoffFrame: 0, landingFrame: 100, frameRateFps: 0 }),
    );
  });

  it('scores the best of three by default', () => {
    const score = scoreCmj({ flightTimesS: [0.48, 0.5, 0.49] });
    expect(score.attemptHeightsCm).toHaveLength(3);
    expect(score.heightCm.value).toBeCloseTo(30.65625, 10);
    expect(score.heightCm.selectedIndex).toBe(1);
    expect(score.heightCm.aggregation).toBe('best');
  });

  it('scores the mean when the definition says so', () => {
    const score = scoreCmj({ flightTimesS: [0.4, 0.5], aggregation: 'mean' });
    expect(score.heightCm.value).toBeCloseTo((19.62 + 30.65625) / 2, 10);
    expectInvalid(() => scoreCmj({ flightTimesS: [] }));
  });
});

describe('sprint 40 m and Vmax 20–40', () => {
  it('computes segment speed', () => {
    expect(segmentSpeedMs(20, 3.1, 5.6)).toBeCloseTo(8, 10);
    expect(segmentSpeedMs(10, 0, 2)).toBe(5);
    expectInvalid(() => segmentSpeedMs(20, 5.6, 5.6));
    expectInvalid(() => segmentSpeedMs(20, 5.6, 3.1));
    expectInvalid(() => segmentSpeedMs(0, 3.1, 5.6));
    expectInvalid(() => segmentSpeedMs(20, -1, 5.6));
    expectInvalid(() => segmentSpeedMs(20, Number.NaN, 5.6));
  });

  it('uses the 20–40 m segment for Vmax', () => {
    expect(SPRINT_VMAX_SEGMENT).toEqual({ fromM: 20, toM: 40 });
    expect(sprintVmaxMs({ split10S: 1.85, split20S: 3.1, split40S: 5.6 })).toBeCloseTo(8, 10);
    expect(sprintVmaxMs({ split20S: 3.2, split40S: 5.7 })).toBeCloseTo(8, 10);
  });

  it('rejects splits that do not increase with distance', () => {
    expectInvalid(() => sprintVmaxMs({ split20S: 5.6, split40S: 3.1 }));
    expectInvalid(() => sprintVmaxMs({ split10S: 3.1, split20S: 3.1, split40S: 5.6 }));
    expectInvalid(() => sprintVmaxMs({ split10S: 0, split20S: 3.1, split40S: 5.6 }));
    expectInvalid(() => sprintVmaxMs({ split20S: Number.NaN, split40S: 5.6 }));
  });

  it('scores each metric as the best across attempts, Vmax per attempt', () => {
    const score = scoreSprint40([
      { split10S: 1.9, split20S: 3.15, split40S: 5.65 }, // vmax 8.0
      { split10S: 1.85, split20S: 3.2, split40S: 5.6 }, // vmax 8.333…
      { split20S: 3.1, split40S: 5.7 }, // vmax 7.692…
    ]);
    expect(score.split10S).toMatchObject({ value: 1.85, attemptCount: 2, selectedIndex: 1 });
    expect(score.split20S).toMatchObject({ value: 3.1, selectedIndex: 2 });
    expect(score.split40S).toMatchObject({ value: 5.6, selectedIndex: 1 });
    expect(score.vmaxMs.value).toBeCloseTo(20 / 2.4, 10);
    expect(score.vmaxMs.selectedIndex).toBe(1);
    expect(score.attemptVmaxMs).toHaveLength(3);
  });

  it('maps the 10 m split back to the attempt index', () => {
    const score = scoreSprint40([
      { split20S: 3.1, split40S: 5.7 },
      { split10S: 1.9, split20S: 3.2, split40S: 5.6 },
    ]);
    expect(score.split10S).toMatchObject({ value: 1.9, selectedIndex: 1 });
  });

  it('returns no 10 m split when no attempt has one', () => {
    expect(scoreSprint40([{ split20S: 3.1, split40S: 5.6 }]).split10S).toBeNull();
  });

  it('supports the mean and rejects an empty test', () => {
    const score = scoreSprint40(
      [
        { split20S: 3.0, split40S: 5.5 },
        { split20S: 3.2, split40S: 5.7 },
      ],
      { aggregation: 'mean' },
    );
    expect(score.split40S.value).toBeCloseTo(5.6, 10);
    expect(score.vmaxMs.value).toBeCloseTo(8, 10);
    expect(score.split10S).toBeNull();
    expectInvalid(() => scoreSprint40([]));
  });
});

describe('505 asymmetry', () => {
  it('is relative to the faster side and reports which one it is', () => {
    expect(cod505Asymmetry({ leftS: 2.5, rightS: 2.4 })).toEqual({
      asymmetryPct: expect.closeTo((0.1 / 2.4) * 100, 10) as unknown,
      fasterSide: 'right',
    });
    expect(cod505Asymmetry({ leftS: 2.4, rightS: 2.5 }).fasterSide).toBe('left');
    expect(cod505AsymmetryPct({ leftS: 2.4, rightS: 2.5 })).toBeCloseTo((0.1 / 2.4) * 100, 10);
  });

  it('is symmetric in magnitude', () => {
    expect(cod505AsymmetryPct({ leftS: 2.4, rightS: 2.6 })).toBe(
      cod505AsymmetryPct({ leftS: 2.6, rightS: 2.4 }),
    );
  });

  it('is 0 with no side when both times are equal', () => {
    expect(cod505Asymmetry({ leftS: 2.5, rightS: 2.5 })).toEqual({
      asymmetryPct: 0,
      fasterSide: 'none',
    });
  });

  it('rejects invalid times', () => {
    expectInvalid(() => cod505AsymmetryPct({ leftS: 0, rightS: 2.5 }));
    expectInvalid(() => cod505AsymmetryPct({ leftS: 2.5, rightS: Number.NaN }));
  });

  it('scores the best per side and the asymmetry of those', () => {
    const score = scoreCod505({ leftAttemptsS: [2.55, 2.5], rightAttemptsS: [2.4, 2.45, 2.42] });
    expect(score.leftS).toMatchObject({ value: 2.5, selectedIndex: 1 });
    expect(score.rightS).toMatchObject({ value: 2.4, selectedIndex: 0 });
    expect(score.asymmetryPct).toBeCloseTo((0.1 / 2.4) * 100, 10);
    expect(score.fasterSide).toBe('right');
  });

  it('requires attempts on both sides', () => {
    expectInvalid(() => scoreCod505({ leftAttemptsS: [2.5], rightAttemptsS: [] }));
    expectInvalid(() => scoreCod505({ leftAttemptsS: [2.5, -1], rightAttemptsS: [2.4] }));
  });
});

describe('strength: Epley e1RM with RIR', () => {
  it('applies load × (1 + (reps + RIR)/30)', () => {
    expect(epleyE1rmKg({ loadKg: 60, reps: 5, rir: 2 })).toBeCloseTo(74, 10);
    expect(epleyE1rmKg({ loadKg: 100, reps: 3, rir: 0 })).toBeCloseTo(110, 10);
    expect(epleyE1rmKg({ loadKg: 90, reps: 1, rir: 0 })).toBeCloseTo(93, 10);
  });

  it('counts reps in reserve as reps done', () => {
    expect(epleyE1rmKg({ loadKg: 60, reps: 3, rir: 2 })).toBe(
      epleyE1rmKg({ loadKg: 60, reps: 5, rir: 0 }),
    );
  });

  it('rejects invalid sets', () => {
    expectInvalid(() => epleyE1rmKg({ loadKg: 0, reps: 5, rir: 2 }));
    expectInvalid(() => epleyE1rmKg({ loadKg: 60, reps: 0, rir: 2 }));
    expectInvalid(() => epleyE1rmKg({ loadKg: 60, reps: 4.5, rir: 2 }));
    expectInvalid(() => epleyE1rmKg({ loadKg: 60, reps: 5, rir: -1 }));
    expectInvalid(() => epleyE1rmKg({ loadKg: Number.NaN, reps: 5, rir: 2 }));
  });

  it('defaults to the development-stage protocol: 3–5 reps, RIR ≥ 2', () => {
    expect(DEFAULT_E1RM_PROTOCOL).toEqual({ minReps: 3, maxReps: 5, minRir: 2 });
    expect(e1rmSetIssues({ loadKg: 60, reps: 4, rir: 2 })).toEqual([]);
    expect(e1rmSetIssues({ loadKg: 60, reps: 2, rir: 3 })).toEqual(['reps_below_protocol']);
    expect(e1rmSetIssues({ loadKg: 60, reps: 8, rir: 0 })).toEqual([
      'reps_above_protocol',
      'rir_below_protocol',
    ]);
  });

  it('accepts a club protocol and validates it', () => {
    const protocol = { minReps: 1, maxReps: 10, minRir: 1 };
    expect(e1rmSetIssues({ loadKg: 60, reps: 8, rir: 1 }, protocol)).toEqual([]);
    expectInvalid(() =>
      e1rmSetIssues({ loadKg: 60, reps: 4, rir: 2 }, { minReps: 5, maxReps: 3, minRir: 2 }),
    );
    expectInvalid(() =>
      e1rmSetIssues({ loadKg: 60, reps: 4, rir: 2 }, { minReps: 3, maxReps: 5, minRir: -1 }),
    );
  });

  it('scores the best e1RM across sets, with issues per set', () => {
    const score = scoreE1rm([
      { loadKg: 60, reps: 5, rir: 2 }, // 74
      { loadKg: 65, reps: 4, rir: 2 }, // 78
      { loadKg: 70, reps: 3, rir: 1 }, // 79.333…
    ]);
    expect(score.e1rmKg.value).toBeCloseTo(70 * (1 + 4 / 30), 10);
    expect(score.e1rmKg.selectedIndex).toBe(2);
    expect(score.setE1rmKg[1]).toBeCloseTo(78, 10);
    expect(score.setIssues).toEqual([[], [], ['rir_below_protocol']]);
    expectInvalid(() => scoreE1rm([]));
  });

  it('computes strength relative to body mass in kg/kg', () => {
    expect(relativeStrengthKgKg({ loadKg: 120, bodyMassKg: 80 })).toBe(1.5);
    expectInvalid(() => relativeStrengthKgKg({ loadKg: 120, bodyMassKg: 0 }));
    expectInvalid(() => relativeStrengthKgKg({ loadKg: -1, bodyMassKg: 80 }));
  });
});

describe('30-15 IFT', () => {
  it('defaults to 8 km/h + 0.5 km/h per 45 s stage', () => {
    expect(DEFAULT_IFT_3015_PROTOCOL).toEqual({
      initialSpeedKmh: 8,
      stageIncrementKmh: 0.5,
      stageDurationS: 45,
    });
    expect(vift3015Kmh(1)).toBe(8);
    expect(vift3015Kmh(20)).toBe(17.5);
    expect(vift3015Kmh(23)).toBe(19);
  });

  it('accepts a club progression', () => {
    expect(
      vift3015Kmh(5, { initialSpeedKmh: 10, stageIncrementKmh: 0.5, stageDurationS: 45 }),
    ).toBe(12);
  });

  it('rejects invalid stages and protocols', () => {
    expectInvalid(() => vift3015Kmh(0));
    expectInvalid(() => vift3015Kmh(2.5));
    expectInvalid(() =>
      vift3015Kmh(3, { initialSpeedKmh: 8, stageIncrementKmh: 0, stageDurationS: 45 }),
    );
  });

  it('prescribes run distances from the VIFT', () => {
    // 18 km/h = 5 m/s; 90% for 15 s → 67.5 m
    expect(
      intermittentRunDistanceM({ viftKmh: 18, intensityPct: 90, workDurationS: 15 }),
    ).toBeCloseTo(67.5, 10);
    expectInvalid(() =>
      intermittentRunDistanceM({ viftKmh: 18, intensityPct: 0, workDurationS: 15 }),
    );
    expectInvalid(() =>
      intermittentRunDistanceM({ viftKmh: Number.NaN, intensityPct: 90, workDurationS: 15 }),
    );
  });
});
