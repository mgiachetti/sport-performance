import { describe, expect, it } from 'vitest';
import {
  CANONICAL_TEST_CODES,
  DEFAULT_AGE_BANDS,
  DomainValidationError,
  STAGES,
  TEST_ENTRY_KINDS_BY_TEST,
  batteryIncludesTest,
  deriveResultMetrics,
  entryKindsOfTest,
  parseLocalDate,
  scoreResultMetrics,
  scoreTestEntry,
  strengthAssessmentFor,
  strengthMetricAllowed,
  testApplicability,
  testComparisonWarnings,
  testScoringSettings,
  type BatteryRow,
} from '../index.js';

const day = parseLocalDate;
const band = (code: string) => {
  const found = DEFAULT_AGE_BANDS.find((b) => b.code === code);
  if (found === undefined) throw new Error(code);
  return found;
};

describe('scoreTestEntry', () => {
  it('computes the sprint splits and the Vmax of the attempt', () => {
    const scored = scoreTestEntry('sprint_40', {
      kind: 'sprint_splits',
      split10S: 1.9,
      split20S: 3.2,
      split40S: 5.7,
    });
    expect(scored.values.map((v) => v.metricCode)).toEqual([
      'sprint_10_s',
      'sprint_20_s',
      'sprint_40_s',
      'sprint_vmax_ms',
    ]);
    expect(scored.values[3]?.value).toBeCloseTo(20 / 2.5, 10);
    expect(scored.values[3]?.computed).toBe(true);
    expect(scored.values[0]?.computed).toBe(false);
  });

  it('omits the 10 m split when the setup has no gate there', () => {
    const scored = scoreTestEntry('sprint_40', {
      kind: 'sprint_splits',
      split20S: 3,
      split40S: 5.4,
    });
    expect(scored.values.map((v) => v.metricCode)).toEqual([
      'sprint_20_s',
      'sprint_40_s',
      'sprint_vmax_ms',
    ]);
  });

  it('rejects splits that do not increase', () => {
    expect(() =>
      scoreTestEntry('sprint_40', { kind: 'sprint_splits', split20S: 3, split40S: 2.9 }),
    ).toThrow(DomainValidationError);
  });

  it('computes the CMJ height from the flight time with the gravity of the protocol', () => {
    const scored = scoreTestEntry('cmj', { kind: 'cmj_flight_time', flightTimeS: 0.5 });
    expect(scored.values[0]?.value).toBeCloseTo((9.81 * 0.25 * 100) / 8, 10);
    const moon = scoreTestEntry(
      'cmj',
      { kind: 'cmj_flight_time', flightTimeS: 0.5 },
      testScoringSettings({ gravityMs2: 1.62 }),
    );
    expect(moon.values[0]?.value).toBeCloseTo((1.62 * 0.25 * 100) / 8, 10);
  });

  it('computes the CMJ height from video frames', () => {
    const scored = scoreTestEntry('cmj', {
      kind: 'cmj_video_frames',
      takeoffFrame: 100,
      landingFrame: 220,
      frameRateFps: 240,
    });
    expect(scored.values[0]?.value).toBeCloseTo((9.81 * 0.25 * 100) / 8, 10);
  });

  it('computes the VIFT with the progression of the protocol', () => {
    expect(
      scoreTestEntry('ift_3015', { kind: 'ift_stage', lastCompletedStage: 17 }).values[0]?.value,
    ).toBe(16);
    const custom = testScoringSettings({ initialSpeedKmh: 10, stageIncrementKmh: 1 });
    expect(
      scoreTestEntry('ift_3015', { kind: 'ift_stage', lastCompletedStage: 3 }, custom).values[0]
        ?.value,
    ).toBe(12);
  });

  it('estimates the 1RM of a set and flags sets outside the protocol', () => {
    const ok = scoreTestEntry('strength', { kind: 'strength_set', loadKg: 60, reps: 5, rir: 2 });
    expect(ok.values[0]).toEqual({
      metricCode: 'e1rm_kg',
      value: 60 * (1 + 7 / 30),
      computed: true,
    });
    expect(ok.issues).toEqual([]);
    const failure = scoreTestEntry('strength', {
      kind: 'strength_set',
      loadKg: 60,
      reps: 8,
      rir: 0,
    });
    expect(failure.issues).toEqual(['reps_above_protocol', 'rir_below_protocol']);
    const strict = scoreTestEntry(
      'strength',
      { kind: 'strength_set', loadKg: 60, reps: 5, rir: 2 },
      testScoringSettings({ e1rmMinReps: 3, e1rmMaxReps: 5, e1rmMinRir: 3 }),
    );
    expect(strict.issues).toEqual(['rir_below_protocol']);
  });

  it('passes typed values through and rejects kinds of another test', () => {
    expect(
      scoreTestEntry('bronco', { kind: 'value', metricCode: 'bronco_time_s', value: 290 }).values,
    ).toEqual([{ metricCode: 'bronco_time_s', value: 290, computed: false }]);
    expect(() => scoreTestEntry('bronco', { kind: 'ift_stage', lastCompletedStage: 3 })).toThrow(
      DomainValidationError,
    );
    expect(() =>
      scoreTestEntry('anthro', { kind: 'value', metricCode: 'height_cm', value: 170 }),
    ).toThrow(DomainValidationError);
    expect(() =>
      scoreTestEntry('cmj', { kind: 'value', metricCode: 'cmj_height_cm', value: Number.NaN }),
    ).toThrow(DomainValidationError);
  });

  it('declares the entry kinds of every canonical test, and value for club tests', () => {
    expect(Object.keys(TEST_ENTRY_KINDS_BY_TEST).sort()).toEqual([...CANONICAL_TEST_CODES].sort());
    expect(entryKindsOfTest('yo_yo_ir1')).toEqual(['value']);
  });

  it('falls back to the defaults for malformed protocol settings', () => {
    const settings = testScoringSettings({
      gravityMs2: -1,
      initialSpeedKmh: 'fast',
      e1rmMinReps: 6,
      e1rmMaxReps: 4,
    });
    expect(settings.gravityMs2).toBe(9.81);
    expect(settings.ift.initialSpeedKmh).toBe(8);
    expect(settings.e1rm).toEqual({ minReps: 3, maxReps: 5, minRir: 2 });
  });
});

describe('scoreResultMetrics', () => {
  const rules = (code: string) =>
    code === 'sprint_40_s'
      ? ({ aggregation: 'best', direction: 'lower_is_better' } as const)
      : code === 'weight_kg'
        ? ({ aggregation: 'best', direction: 'neutral' } as const)
        : ({ aggregation: 'best', direction: 'higher_is_better' } as const);

  it('takes the best attempt by the direction of the metric', () => {
    const scores = scoreResultMetrics(
      [
        { metricCode: 'sprint_40_s', value: 5.8, attemptNumber: 1 },
        { metricCode: 'sprint_40_s', value: 5.6, attemptNumber: 2 },
        { metricCode: 'cmj_height_cm', value: 31, attemptNumber: 1 },
        { metricCode: 'cmj_height_cm', value: 33, attemptNumber: 2 },
      ],
      rules,
    );
    expect(scores).toEqual([
      { metricCode: 'sprint_40_s', value: 5.6, aggregation: 'best', attemptCount: 2 },
      { metricCode: 'cmj_height_cm', value: 33, aggregation: 'best', attemptCount: 2 },
    ]);
  });

  it('uses the result-level value when there is one, and the mean without a direction', () => {
    const scores = scoreResultMetrics(
      [
        { metricCode: 'cmj_height_cm', value: 31, attemptNumber: 1 },
        { metricCode: 'cmj_height_cm', value: 35, attemptNumber: null },
        { metricCode: 'weight_kg', value: 60, attemptNumber: 1 },
        { metricCode: 'weight_kg', value: 61, attemptNumber: 2 },
      ],
      rules,
    );
    expect(scores).toEqual([
      { metricCode: 'cmj_height_cm', value: 35, aggregation: 'single', attemptCount: 1 },
      { metricCode: 'weight_kg', value: 60.5, aggregation: 'mean', attemptCount: 2 },
    ]);
  });
});

describe('deriveResultMetrics', () => {
  it('derives the 505 asymmetry from the best of each side', () => {
    const derived = deriveResultMetrics(
      'cod_505',
      new Map([
        ['cod505_left_s', 2.5],
        ['cod505_right_s', 2.4],
      ]),
    );
    expect(derived).toHaveLength(1);
    expect(derived[0]?.metricCode).toBe('cod505_asymmetry_pct');
    expect(derived[0]?.value).toBeCloseTo((0.1 / 2.4) * 100, 10);
    expect(deriveResultMetrics('cod_505', new Map([['cod505_left_s', 2.5]]))).toEqual([]);
  });

  it('derives relative strength from the best load and the body mass', () => {
    expect(deriveResultMetrics('strength', new Map([['e1rm_kg', 90]]), { bodyMassKg: 60 })).toEqual(
      [{ metricCode: 'relative_strength_kg_kg', value: 1.5 }],
    );
    expect(
      deriveResultMetrics(
        'strength',
        new Map([
          ['rm1_kg', 120],
          ['e1rm_kg', 90],
        ]),
        { bodyMassKg: 80 },
      ),
    ).toEqual([{ metricCode: 'relative_strength_kg_kg', value: 1.5 }]);
    expect(deriveResultMetrics('strength', new Map([['e1rm_kg', 90]]))).toEqual([]);
    expect(
      deriveResultMetrics('strength', new Map([['pushups_n', 20]]), { bodyMassKg: 60 }),
    ).toEqual([]);
  });
});

describe('stage rules', () => {
  it('records only the strength metrics of the assessment of the player', () => {
    const m13 = strengthAssessmentFor('foundation', band('m13'));
    expect(m13).toBe('technique_reps');
    expect(strengthMetricAllowed('pushups_n', m13)).toBe(true);
    expect(strengthMetricAllowed('e1rm_kg', m13)).toBe(false);
    expect(strengthMetricAllowed('rm1_kg', m13)).toBe(false);
    // An M14 pinned at performance still never does maximal loads.
    expect(strengthMetricAllowed('rm1_kg', strengthAssessmentFor('performance', band('m14')))).toBe(
      false,
    );
    expect(
      strengthMetricAllowed('e1rm_kg', strengthAssessmentFor('development', band('m15'))),
    ).toBe(true);
    expect(strengthMetricAllowed('rm1_kg', strengthAssessmentFor('development', band('m15')))).toBe(
      false,
    );
    expect(strengthMetricAllowed('rm3_kg', strengthAssessmentFor('performance', band('m17')))).toBe(
      true,
    );
    expect(strengthMetricAllowed('cmj_height_cm', 'technique_reps')).toBe(true);
  });

  const battery: BatteryRow[] = [
    {
      sport: 'rugby',
      sex: 'male',
      stage: 'performance',
      categoryId: null,
      testCode: 'bronco',
      validFrom: day('2026-01-01'),
      validTo: null,
    },
    {
      sport: 'rugby',
      sex: null,
      stage: null,
      categoryId: 'c-m15',
      testCode: 'neck',
      validFrom: day('2026-01-01'),
      validTo: day('2026-07-01'),
    },
  ];
  const m17 = { sport: 'rugby', sex: 'male', stage: 'performance', categoryId: 'c-m17' } as const;
  const m15 = { sport: 'rugby', sex: 'male', stage: 'development', categoryId: 'c-m15' } as const;

  it('finds a test in the battery in effect for the scope of the player', () => {
    expect(batteryIncludesTest(battery, 'bronco', m17, day('2026-03-01'))).toBe(true);
    expect(batteryIncludesTest(battery, 'bronco', m15, day('2026-03-01'))).toBe(false);
    expect(
      batteryIncludesTest(battery, 'bronco', { ...m17, sex: 'female' }, day('2026-03-01')),
    ).toBe(false);
    expect(batteryIncludesTest(battery, 'bronco', m17, day('2025-12-31'))).toBe(false);
    expect(batteryIncludesTest(battery, 'neck', m15, day('2026-06-30'))).toBe(true);
    expect(batteryIncludesTest(battery, 'neck', m15, day('2026-07-01'))).toBe(false);
    expect(batteryIncludesTest(battery, 'neck', m17, day('2026-03-01'))).toBe(false);
  });

  it('never lets a maximal loaded test apply to M13/M14', () => {
    for (const stage of STAGES) {
      expect(
        testApplicability({ inBattery: true, maximalLoad: true, stage, ageBand: band('m14') }),
      ).toEqual({ applicable: false, reason: 'maximal_load_not_allowed' });
    }
    expect(
      testApplicability({
        inBattery: true,
        maximalLoad: true,
        stage: 'performance',
        ageBand: band('m17'),
      }),
    ).toEqual({ applicable: true });
    expect(
      testApplicability({
        inBattery: false,
        maximalLoad: false,
        stage: 'performance',
        ageBand: band('m17'),
      }),
    ).toEqual({ applicable: false, reason: 'not_in_battery' });
  });
});

describe('testComparisonWarnings', () => {
  const photocell = { method: 'photocell', protocolVersion: 1, deviceId: 'd1' } as const;

  it('warns when methods or protocol versions differ', () => {
    expect(testComparisonWarnings([photocell, photocell])).toEqual([]);
    expect(testComparisonWarnings([photocell, { ...photocell, method: 'manual' }])).toEqual([
      'mixed_methods',
    ]);
    expect(
      testComparisonWarnings([
        photocell,
        { ...photocell, method: 'historical', protocolVersion: 2 },
      ]),
    ).toEqual(['mixed_methods', 'mixed_protocol_versions']);
  });

  it('warns about devices only for tests compared on the same device', () => {
    const other = { ...photocell, deviceId: 'd2' };
    expect(testComparisonWarnings([photocell, other])).toEqual([]);
    expect(testComparisonWarnings([photocell, other], { sameDeviceOnly: true })).toEqual([
      'mixed_devices',
    ]);
    expect(
      testComparisonWarnings([photocell, { ...photocell, deviceId: null }], {
        sameDeviceOnly: true,
      }),
    ).toEqual(['mixed_devices']);
  });

  it('warns when strength results mix exercises', () => {
    const trapBar = { ...photocell, method: 'manual', exercise: 'trap_bar_deadlift' } as const;
    expect(testComparisonWarnings([trapBar, trapBar])).toEqual([]);
    expect(testComparisonWarnings([trapBar, { ...trapBar, exercise: 'bench_press' }])).toEqual([
      'mixed_exercises',
    ]);
  });
});
