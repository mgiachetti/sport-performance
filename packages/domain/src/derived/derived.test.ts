import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DERIVED_PARAMETERS,
  DEFAULT_LOAD_PARAMETERS,
  DomainValidationError,
  KHAMIS_ROCHE_1994_TABLE,
  addDays,
  decimalAgeYears,
  deriveMaturation,
  maturationGaps,
  maturityOffset,
  maturityOffsetEquationChain,
  parseLocalDate,
  predictAdultHeight,
  resolveDerivedParameters,
  wellnessBaselineSeries,
  type AnthropometryInput,
  type LocalDate,
} from '../index.js';

const d = (value: string): LocalDate => parseLocalDate(value);

function expectInvalid(fn: () => unknown): void {
  expect(fn).toThrow(DomainValidationError);
}

describe('resolveDerivedParameters', () => {
  it('defaults every block', () => {
    expect(resolveDerivedParameters()).toEqual(DEFAULT_DERIVED_PARAMETERS);
    expect(resolveDerivedParameters(null)).toBe(DEFAULT_DERIVED_PARAMETERS);
    expect(resolveDerivedParameters({})).toEqual(DEFAULT_DERIVED_PARAMETERS);
    expect(DEFAULT_DERIVED_PARAMETERS.load).toBe(DEFAULT_LOAD_PARAMETERS);
    expect(DEFAULT_DERIVED_PARAMETERS.wellnessBaseline).toEqual({ windowDays: 28, minSamples: 10 });
    expect(DEFAULT_DERIVED_PARAMETERS.maturation).toEqual({
      maturityOffsetEquation: 'moore_2015',
      growthVelocity: { minIntervalDays: 84, maxIntervalDays: 400 },
      khamisRocheTableCode: 'khamis_roche_1994',
      khamisRocheAgeMode: 'linear',
    });
  });

  it('merges partial JSON with the defaults', () => {
    const parameters = resolveDerivedParameters(
      JSON.parse(
        '{"load":{"acuteWindowDays":3,"chronicWindowDays":21,"minHistoryDays":21},"wellnessBaseline":{"minSamples":5},"maturation":{"maturityOffsetEquation":"mirwald_2002","growthVelocity":{"minIntervalDays":60}}}',
      ),
    );
    expect(parameters.load).toMatchObject({ acuteWindowDays: 3, chronicWindowDays: 21 });
    expect(parameters.wellnessBaseline).toEqual({ windowDays: 28, minSamples: 5 });
    expect(parameters.maturation.maturityOffsetEquation).toBe('mirwald_2002');
    expect(parameters.maturation.growthVelocity).toEqual({
      minIntervalDays: 60,
      maxIntervalDays: 400,
    });
  });

  it.each([
    [],
    'x',
    { loads: {} },
    { load: { acuteWindowDays: 0 } },
    { wellnessBaseline: { windowDays: 1 } },
    { wellnessBaseline: { minSamples: 1 } },
    { wellnessBaseline: { windowDays: 7, minSamples: 8 } },
    { wellnessBaseline: { window: 7 } },
    { maturation: { maturityOffsetEquation: 'sherar' } },
    { maturation: { khamisRocheAgeMode: 'spline' } },
    { maturation: { khamisRocheTableCode: 'Bad Code' } },
    { maturation: { growthVelocity: { minIntervalDays: 100, maxIntervalDays: 50 } } },
    { maturation: { equation: 'moore_2015' } },
  ])('rejects %o', (settings) => {
    expectInvalid(() => resolveDerivedParameters(settings));
  });
});

describe('wellnessBaselineSeries', () => {
  const start = d('2026-03-02');
  const day = (offset: number, meanScore: number) => ({
    date: addDays(start, offset),
    meanScore,
    itemCount: 5,
  });

  it('compares each day with the previous window, excluding the day', () => {
    const days = [...Array.from({ length: 10 }, (_, i) => day(i, i % 2 === 0 ? 4 : 3)), day(10, 2)];
    const series = wellnessBaselineSeries([...days].reverse());
    expect(series.map((s) => s.date)).toEqual(days.map((s) => s.date));
    expect(series[0]).toMatchObject({
      baselineSamples: 0,
      baselineMeanScore: null,
      baselineSdScore: null,
      zScore: null,
    });
    expect(series[1]).toMatchObject({
      baselineSamples: 1,
      baselineMeanScore: 4,
      baselineSdScore: null,
    });
    // Nine samples: below the default minimum of 10, no z-score yet.
    expect(series[9]?.baselineSamples).toBe(9);
    expect(series[9]?.zScore).toBeNull();
    const last = series[10];
    const sd = Math.sqrt((10 * 0.25) / 9);
    expect(last?.baselineSamples).toBe(10);
    expect(last?.baselineMeanScore).toBeCloseTo(3.5, 12);
    expect(last?.baselineSdScore).toBeCloseTo(sd, 12);
    expect(last?.zScore).toBeCloseTo((2 - 3.5) / sd, 12);
  });

  it('drops entries older than the window', () => {
    const series = wellnessBaselineSeries([day(0, 5), day(10, 4), day(12, 3)], {
      windowDays: 5,
      minSamples: 2,
    });
    expect(series[1]?.baselineSamples).toBe(0);
    expect(series[2]).toMatchObject({ baselineSamples: 1, baselineMeanScore: 4 });
  });

  it('reports no z-score without variation', () => {
    const series = wellnessBaselineSeries([day(0, 3), day(1, 3), day(2, 1)], {
      windowDays: 28,
      minSamples: 2,
    });
    expect(series[2]).toMatchObject({ baselineSdScore: 0, zScore: null });
  });

  it('rejects duplicate days and scores out of range', () => {
    expectInvalid(() => wellnessBaselineSeries([day(0, 3), day(0, 4)]));
    expectInvalid(() => wellnessBaselineSeries([day(0, 0.5)]));
    expectInvalid(() => wellnessBaselineSeries([day(0, Number.NaN)]));
  });
});

describe('maturityOffsetEquationChain', () => {
  it('falls back to equations that need fewer measurements', () => {
    expect(maturityOffsetEquationChain('mirwald_2002', 'male')).toEqual([
      'mirwald_2002',
      'moore_2015',
      'moore_2015_height',
    ]);
    expect(maturityOffsetEquationChain('moore_2015', 'female')).toEqual(['moore_2015']);
    expect(maturityOffsetEquationChain('moore_2015_height', 'female')).toEqual(['moore_2015']);
  });
});

describe('deriveMaturation', () => {
  const birthDate = d('2012-05-10');
  const m = (
    id: string,
    date: string,
    values: Partial<Omit<AnthropometryInput, 'id' | 'date'>>,
  ): AnthropometryInput => ({
    id,
    date: d(date),
    heightCm: null,
    sittingHeightCm: null,
    weightKg: null,
    ...values,
  });

  it('computes offset, Khamis-Roche and growth velocity for a full measurement', () => {
    const [first, second] = deriveMaturation({
      sex: 'male',
      birthDate,
      motherHeightCm: 165,
      fatherHeightCm: 180,
      khamisRocheTable: KHAMIS_ROCHE_1994_TABLE,
      measurements: [
        m('a', '2026-01-10', { heightCm: 160, sittingHeightCm: 82, weightKg: 50 }),
        m('b', '2026-05-10', { heightCm: 163, sittingHeightCm: 83.5, weightKg: 52 }),
      ],
    });
    const age = decimalAgeYears(birthDate, d('2026-05-10'));
    const expectedOffset = maturityOffset({
      sex: 'male',
      ageYears: age,
      heightCm: 163,
      sittingHeightCm: 83.5,
      weightKg: 52,
    });
    const expectedHeight = predictAdultHeight({
      sex: 'male',
      ageYears: age,
      heightCm: 163,
      weightKg: 52,
      motherHeightCm: 165,
      fatherHeightCm: 180,
    });
    expect(second).toEqual({
      id: 'b',
      phvOffsetYears: expectedOffset.maturityOffsetYears,
      maturityOffsetEquation: 'moore_2015',
      predictedAdultHeightCm: expectedHeight.predictedAdultHeightCm,
      adultHeightPct: expectedHeight.adultHeightPct,
      khamisRocheTableCode: 'khamis_roche_1994',
      growthVelocityCmYear: 3 / (120 / 365.25),
    });
    // The first measurement has no earlier height: no velocity.
    expect(first?.growthVelocityCmYear).toBeNull();
    expect(first?.maturityOffsetEquation).toBe('moore_2015');
  });

  it('uses the height-only equation for boys without sitting height', () => {
    const [result] = deriveMaturation({
      sex: 'male',
      birthDate,
      motherHeightCm: null,
      fatherHeightCm: null,
      khamisRocheTable: KHAMIS_ROCHE_1994_TABLE,
      measurements: [m('a', '2026-01-10', { heightCm: 160 })],
    });
    expect(result?.maturityOffsetEquation).toBe('moore_2015_height');
    expect(result?.phvOffsetYears).toEqual(expect.any(Number));
    // No parents' heights, no weight: no Khamis-Roche.
    expect(result).toMatchObject({ adultHeightPct: null, khamisRocheTableCode: null });
  });

  it('leaves everything empty without height, before birth or without a table', () => {
    const results = deriveMaturation({
      sex: 'female',
      birthDate,
      motherHeightCm: 165,
      fatherHeightCm: 180,
      khamisRocheTable: null,
      measurements: [
        m('weight-only', '2026-01-10', { weightKg: 45 }),
        m('before-birth', '2011-01-10', { heightCm: 50 }),
        m('no-table', '2026-02-10', { heightCm: 155, weightKg: 45 }),
      ],
    });
    expect(results[0]).toMatchObject({ phvOffsetYears: null, growthVelocityCmYear: null });
    expect(results[1]).toMatchObject({ phvOffsetYears: null, maturityOffsetEquation: null });
    expect(results[2]).toMatchObject({
      maturityOffsetEquation: 'moore_2015',
      adultHeightPct: null,
      predictedAdultHeightCm: null,
    });
  });

  it('does not extrapolate Khamis-Roche outside the table ages', () => {
    const [result] = deriveMaturation({
      sex: 'male',
      birthDate: d('2000-01-01'),
      motherHeightCm: 165,
      fatherHeightCm: 180,
      khamisRocheTable: KHAMIS_ROCHE_1994_TABLE,
      measurements: [m('adult', '2026-01-10', { heightCm: 180, weightKg: 80 })],
    });
    expect(result?.adultHeightPct).toBeNull();
  });

  it('uses the latest measurement of a day for the velocity of later days', () => {
    const results = deriveMaturation({
      sex: 'male',
      birthDate,
      motherHeightCm: null,
      fatherHeightCm: null,
      khamisRocheTable: null,
      measurements: [
        m('typo', '2026-01-10', { heightCm: 150 }),
        m('fixed', '2026-01-10', { heightCm: 160 }),
        m('later', '2026-05-10', { heightCm: 163 }),
      ],
    });
    expect(results[2]?.growthVelocityCmYear).toBeCloseTo(3 / (120 / 365.25), 12);
  });
});

describe('maturationGaps', () => {
  const birthDate = d('2012-05-10');
  const parents = { motherHeightCm: 165, fatherHeightCm: 180 };
  const measurement = (
    values: Partial<Omit<AnthropometryInput, 'id' | 'date'>>,
    date = '2026-05-10',
  ): AnthropometryInput => ({
    id: 'x',
    date: d(date),
    heightCm: null,
    sittingHeightCm: null,
    weightKg: null,
    ...values,
  });

  function gapsOf(
    player: { motherHeightCm: number | null; fatherHeightCm: number | null; table?: null },
    m: AnthropometryInput,
    sex: 'male' | 'female' = 'male',
    bornOn: LocalDate = birthDate,
  ) {
    const input = {
      sex,
      birthDate: bornOn,
      motherHeightCm: player.motherHeightCm,
      fatherHeightCm: player.fatherHeightCm,
      khamisRocheTable: player.table === null ? null : KHAMIS_ROCHE_1994_TABLE,
    };
    const [result] = deriveMaturation({ ...input, measurements: [m] });
    if (result === undefined) throw new Error('no result');
    return { result, gaps: maturationGaps(input, m, result) };
  }

  it('is empty when every value is computed', () => {
    const { result, gaps } = gapsOf(parents, measurement({ heightCm: 163, weightKg: 52 }));
    expect(result.phvOffsetYears).not.toBeNull();
    expect(result.adultHeightPct).not.toBeNull();
    expect(gaps).toEqual({ phvOffset: [], adultHeight: [] });
  });

  it('lists every missing input of the day at once', () => {
    const { gaps } = gapsOf(
      { motherHeightCm: 165, fatherHeightCm: null },
      measurement({ weightKg: 52 }),
    );
    expect(gaps.phvOffset).toEqual(['height_missing']);
    expect(gaps.adultHeight).toEqual(['height_missing', 'parent_heights_missing']);
  });

  it('names the weight and the parents for Khamis-Roche, never the offset', () => {
    const { result, gaps } = gapsOf(
      { motherHeightCm: null, fatherHeightCm: null },
      measurement({ heightCm: 163 }),
      'female',
    );
    expect(result.phvOffsetYears).not.toBeNull();
    expect(gaps.phvOffset).toEqual([]);
    expect(gaps.adultHeight).toEqual(['weight_missing', 'parent_heights_missing']);
  });

  it('tells a club without table and an age outside it apart', () => {
    expect(
      gapsOf({ ...parents, table: null }, measurement({ heightCm: 163, weightKg: 52 })).gaps
        .adultHeight,
    ).toEqual(['no_reference_table']);
    expect(
      gapsOf(parents, measurement({ heightCm: 180, weightKg: 80 }), 'male', d('2000-01-01')).gaps
        .adultHeight,
    ).toEqual(['age_outside_reference']);
  });

  it('flags a measurement before the birth date', () => {
    const { gaps } = gapsOf(parents, measurement({ heightCm: 163, weightKg: 52 }, '2012-05-01'));
    expect(gaps.phvOffset).toEqual(['invalid_age']);
    expect(gaps.adultHeight).toEqual(['invalid_age']);
  });

  it('names the sitting height when no equation of the chain is height-only', () => {
    const input = {
      sex: 'male' as const,
      birthDate,
      ...parents,
      khamisRocheTable: KHAMIS_ROCHE_1994_TABLE,
    };
    const m = measurement({ heightCm: 163 });
    const missing = { phvOffsetYears: null, adultHeightPct: null };
    expect(maturationGaps(input, m, missing, ['mirwald_2002']).phvOffset).toEqual([
      'sitting_height_missing',
      'weight_missing',
    ]);
    expect(maturationGaps(input, m, missing, ['moore_2015']).phvOffset).toEqual([
      'sitting_height_missing',
    ]);
    // Every input there and still no value: rejected, never an empty reason.
    const full = measurement({ heightCm: 163, sittingHeightCm: 85, weightKg: 52 });
    expect(maturationGaps(input, full, missing, ['mirwald_2002']).phvOffset).toEqual([
      'prediction_rejected',
    ]);
  });
});
