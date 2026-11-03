import { describe, expect, it } from 'vitest';
import type { TestDaySheetStation } from '../endpoints/test-day-sheet.js';
import {
  attemptMetricValues,
  attemptPlausibilityWarnings,
  entryModesOf,
  fieldStationSettingsSchema,
  nextAttemptNumber,
  parseAttempt,
  scoreAttemptValues,
} from './entry.js';

const metric = (
  code: string,
  unit: string,
  direction: 'higher_is_better' | 'lower_is_better',
  derived = false,
) => ({ code, unit, direction, derived });

function station(
  testCode: string,
  entryKinds: TestDaySheetStation['definition']['entryKinds'],
  metrics: TestDaySheetStation['definition']['metrics'],
): TestDaySheetStation {
  return {
    testCode,
    scheduled: true,
    definition: {
      id: '0192e7a0-5555-7000-8000-000000000001',
      code: testCode,
      entryKinds,
      version: 1,
      sports: null,
      attemptCount: 3,
      attemptAggregation: 'best',
      maximalLoad: false,
      sameDeviceOnly: false,
      protocol: {
        summary: null,
        steps: [],
        restBetweenAttemptsS: null,
        equipment: [],
        parameters: {},
      },
      metrics,
      validFrom: '2026-01-01',
      validTo: null,
    },
  } as unknown as TestDaySheetStation;
}

const SPRINT = station(
  'sprint_40',
  ['sprint_splits', 'value'],
  [
    metric('sprint_10_s', 's', 'lower_is_better'),
    metric('sprint_20_s', 's', 'lower_is_better'),
    metric('sprint_40_s', 's', 'lower_is_better'),
    metric('sprint_vmax_ms', 'ms', 'higher_is_better', true),
  ],
);
const COD = station(
  'cod_505',
  ['value'],
  [
    metric('cod505_left_s', 's', 'lower_is_better'),
    metric('cod505_right_s', 's', 'lower_is_better'),
    metric('cod505_asymmetry_pct', 'pct', 'lower_is_better', true),
  ],
);

describe('typing a station (shared by the web and the field app)', () => {
  it('types the sprint by splits only, with a decimal comma', () => {
    expect(entryModesOf(SPRINT)).toEqual(['sprint_splits']);
    const parsed = parseAttempt(SPRINT, 'sprint_splits', { split20S: '3,1', split40S: '5,5' });
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(attemptMetricValues(SPRINT, parsed)).toContainEqual({
      metricCode: 'sprint_vmax_ms',
      value: 20 / 2.4,
    });
    expect(parseAttempt(SPRINT, 'sprint_splits', { split20S: '3,1' })).toEqual({
      status: 'invalid',
      fieldKey: 'split40S',
      problem: 'required',
    });
  });

  it('scores by the best attempt of each metric, with the derived ones', () => {
    const scored = scoreAttemptValues(COD, [
      { metricCode: 'cod505_left_s', value: 2.5, attemptNumber: 1 },
      { metricCode: 'cod505_right_s', value: 2.7, attemptNumber: 1 },
      { metricCode: 'cod505_left_s', value: 2.4, attemptNumber: 2 },
    ]);
    expect(scored.bestAttempt.get('cod505_left_s')).toBe(2);
    expect(scored.bestAttempt.get('cod505_right_s')).toBe(1);
    expect(scored.scores.map((s) => s.metricCode)).toContain('cod505_asymmetry_pct');
  });

  it('warns about a value out of the plausible range for the sex and age', () => {
    const parsed = parseAttempt(SPRINT, 'sprint_splits', { split20S: '1,0', split40S: '1,9' });
    const warnings = attemptPlausibilityWarnings(
      SPRINT,
      'sprint_splits',
      parsed,
      { sex: 'male', birthDate: '2011-05-01' as never },
      '2026-04-14' as never,
    );
    expect(warnings.map((w) => w.fieldKey)).toContain('split40S');
  });

  it('numbers the next attempt after every result', () => {
    expect(
      nextAttemptNumber([
        { entries: [{ attemptNumber: 1 }, { attemptNumber: 3 }] },
        { entries: [{ attemptNumber: 4 }, { attemptNumber: null }] },
      ] as never),
    ).toBe(5);
  });
});

describe('the settings of a station on a phone', () => {
  it('take known modes and methods only', () => {
    expect(
      fieldStationSettingsSchema.parse({
        mode: 'sprint_splits',
        method: 'photocell',
        deviceId: null,
      }),
    ).toEqual({ mode: 'sprint_splits', method: 'photocell', deviceId: null });
    expect(fieldStationSettingsSchema.parse({})).toEqual({});
    expect(fieldStationSettingsSchema.safeParse({ mode: 'video_frames' }).success).toBe(false);
    expect(fieldStationSettingsSchema.safeParse({ method: 'historical' }).success).toBe(false);
    expect(fieldStationSettingsSchema.safeParse({ exercise: 3 }).success).toBe(false);
  });
});
