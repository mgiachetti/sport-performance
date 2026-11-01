import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOAD_PARAMETERS,
  DomainValidationError,
  acuteChronicWorkloadRatio,
  addDays,
  computeLoadSeries,
  dailyLoadsFromSessions,
  ewmaLambda,
  ewmaSeriesAu,
  fillDailyLoads,
  fosterMonotony,
  isoWeekLoadSummaries,
  localDateRange,
  parseLocalDate,
  resolveLoadParameters,
  sessionRpeLoadAu,
  type DatedLoad,
  type LocalDate,
} from '../index.js';

const d = (value: string): LocalDate => parseLocalDate(value);
const START = d('2026-03-02'); // a Monday

/** `count` consecutive days from `from`, each with `loadAu`. */
function constantLoads(from: LocalDate, count: number, loadAu: number): DatedLoad[] {
  return localDateRange(from, addDays(from, count - 1)).map((date) => ({ date, loadAu }));
}

function expectInvalid(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).code).toMatch(/^invalid_/);
    return;
  }
  expect.unreachable('expected a DomainValidationError');
}

describe('sessionRpeLoadAu', () => {
  it('is RPE × minutes', () => {
    expect(sessionRpeLoadAu({ rpe: 7, durationMin: 60 })).toBe(420);
    expect(sessionRpeLoadAu({ rpe: 0.5, durationMin: 30 })).toBe(15);
    expect(sessionRpeLoadAu({ rpe: 0, durationMin: 90 })).toBe(0);
    expect(sessionRpeLoadAu({ rpe: 10, durationMin: 0 })).toBe(0);
  });

  it.each([
    { rpe: -1, durationMin: 60 },
    { rpe: 10.5, durationMin: 60 },
    { rpe: Number.NaN, durationMin: 60 },
    { rpe: 5, durationMin: -1 },
    { rpe: 5, durationMin: 1441 },
    { rpe: 5, durationMin: Number.POSITIVE_INFINITY },
  ])('rejects %o', (input) => {
    expectInvalid(() => sessionRpeLoadAu(input));
  });
});

describe('EWMA', () => {
  it('uses λ = 2/(N+1)', () => {
    expect(ewmaLambda(7)).toBe(0.25);
    expect(ewmaLambda(28)).toBeCloseTo(2 / 29, 15);
    expectInvalid(() => ewmaLambda(0));
    expectInvalid(() => ewmaLambda(7.5));
  });

  it('seeds with the first day by default', () => {
    expect(ewmaSeriesAu([100, 0, 200], 7)).toEqual([100, 75, 106.25]);
  });

  it('can seed with 0', () => {
    expect(ewmaSeriesAu([100, 0, 200], 7, 'zero')).toEqual([25, 18.75, 64.0625]);
  });

  it('rejects negative or non-finite loads', () => {
    expectInvalid(() => ewmaSeriesAu([100, -1], 7));
    expectInvalid(() => ewmaSeriesAu([Number.NaN], 7));
  });

  it('ACWR is acute / chronic and undefined with no chronic load', () => {
    expect(acuteChronicWorkloadRatio(150, 100)).toBe(1.5);
    expect(acuteChronicWorkloadRatio(0, 0)).toBeNull();
    expect(acuteChronicWorkloadRatio(10, 0)).toBeNull();
  });
});

describe('fosterMonotony', () => {
  const week = [100, 200, 300, 400, 500, 600, 700];

  it('uses the sample standard deviation by default', () => {
    const summary = fosterMonotony(week);
    const sd = Math.sqrt(280_000 / 6);
    expect(summary.totalLoadAu).toBe(2800);
    expect(summary.meanDailyLoadAu).toBe(400);
    expect(summary.sdDailyLoadAu).toBeCloseTo(sd, 10);
    expect(summary.monotony).toBeCloseTo(400 / sd, 10);
    expect(summary.strainAu).toBeCloseTo((2800 * 400) / sd, 8);
  });

  it('can use the population standard deviation', () => {
    const summary = fosterMonotony(week, 'population');
    expect(summary.sdDailyLoadAu).toBe(200);
    expect(summary.monotony).toBe(2);
    expect(summary.strainAu).toBe(5600);
  });

  it('counts rest days as 0', () => {
    const summary = fosterMonotony([300, 0, 300, 0, 300, 0, 0], 'population');
    expect(summary.meanDailyLoadAu).toBeCloseTo(900 / 7, 10);
    expect(summary.monotony).toBeCloseTo(Math.sqrt(3 / 4), 10);
  });

  it('is undefined (null) when every day has the same load', () => {
    for (const loads of [
      [0, 0, 0, 0, 0, 0, 0],
      [100, 100, 100, 100, 100, 100, 100],
      [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
    ]) {
      const summary = fosterMonotony(loads);
      expect(summary.sdDailyLoadAu).toBe(0);
      expect(summary.monotony).toBeNull();
      expect(summary.strainAu).toBeNull();
    }
  });

  it('needs two valid days', () => {
    expectInvalid(() => fosterMonotony([100]));
    expectInvalid(() => fosterMonotony([100, -5]));
  });
});

describe('daily loads', () => {
  it('sums sessions of the same day and sorts by date', () => {
    expect(
      dailyLoadsFromSessions([
        { date: d('2026-03-04'), loadAu: 200 },
        { date: d('2026-03-02'), loadAu: 300 },
        { date: d('2026-03-04'), loadAu: 150 },
      ]),
    ).toEqual([
      { date: '2026-03-02', loadAu: 300 },
      { date: '2026-03-04', loadAu: 350 },
    ]);
  });

  it('rejects invalid dates and loads', () => {
    expectInvalid(() => dailyLoadsFromSessions([{ date: '2026-02-30' as LocalDate, loadAu: 1 }]));
    expectInvalid(() => dailyLoadsFromSessions([{ date: START, loadAu: -1 }]));
  });

  it('fills days without data with 0 and tells them apart from rest days', () => {
    expect(
      fillDailyLoads({
        loads: [
          { date: d('2026-03-02'), loadAu: 300 },
          { date: d('2026-03-04'), loadAu: 0 },
          { date: d('2026-03-09'), loadAu: 999 },
        ],
        from: d('2026-03-02'),
        to: d('2026-03-04'),
      }),
    ).toEqual([
      { date: '2026-03-02', loadAu: 300, hasData: true },
      { date: '2026-03-03', loadAu: 0, hasData: false },
      { date: '2026-03-04', loadAu: 0, hasData: true },
    ]);
  });
});

describe('resolveLoadParameters', () => {
  it('defaults to acute 7, chronic 28, 28 days of history, weekly monotony', () => {
    expect(resolveLoadParameters()).toEqual(DEFAULT_LOAD_PARAMETERS);
    expect(DEFAULT_LOAD_PARAMETERS).toEqual({
      acuteWindowDays: 7,
      chronicWindowDays: 28,
      minHistoryDays: 28,
      ewmaSeed: 'first_day',
      monotonyWindowDays: 7,
      monotonyStandardDeviation: 'sample',
    });
    expect(Object.isFrozen(DEFAULT_LOAD_PARAMETERS)).toBe(true);
  });

  it('merges a partial club configuration (JSON) with the defaults', () => {
    const parameters = resolveLoadParameters(
      JSON.parse('{"acuteWindowDays":3,"chronicWindowDays":21,"minHistoryDays":21}'),
    );
    expect(parameters).toEqual({
      ...DEFAULT_LOAD_PARAMETERS,
      acuteWindowDays: 3,
      chronicWindowDays: 21,
      minHistoryDays: 21,
    });
    expect(Object.isFrozen(parameters)).toBe(true);
  });

  it.each([
    null,
    [],
    'x',
    { acuteWindowDays: 0 },
    { acuteWindowDays: 7.5 },
    { acuteWindowDays: 28 },
    { chronicWindowDays: 6 },
    { chronicWindowDays: 366 },
    { minHistoryDays: 0 },
    { ewmaSeed: 'last' },
    { monotonyWindowDays: 1 },
    { monotonyStandardDeviation: 'mad' },
    { acuteWindow: 7 },
  ])('rejects %o', (overrides) => {
    expectInvalid(() => resolveLoadParameters(overrides));
  });
});

describe('computeLoadSeries', () => {
  it('is empty-safe: no loads means insufficient history every day', () => {
    const series = computeLoadSeries({ loads: [], from: START, to: addDays(START, 2) });
    expect(series).toHaveLength(3);
    for (const day of series) {
      expect(day).toMatchObject({
        loadAu: 0,
        hasData: false,
        historyDays: 0,
        acwr: null,
        acwrStatus: 'insufficient_history',
        monotonyStatus: 'insufficient_history',
      });
    }
    expect(computeLoadSeries({ loads: [], to: START })).toHaveLength(1);
  });

  it('starts at the first load and seeds the EWMA with it', () => {
    const series = computeLoadSeries({
      loads: [
        { date: START, loadAu: 100 },
        { date: addDays(START, 2), loadAu: 200 },
      ],
      to: addDays(START, 2),
    });
    expect(series.map((day) => day.date)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
    expect(series.map((day) => day.acuteEwmaAu)).toEqual([100, 75, 106.25]);
    const lambda = 2 / 29;
    const chronic1 = (1 - lambda) * 100;
    expect(series[1]?.chronicEwmaAu).toBeCloseTo(chronic1, 10);
    expect(series[2]?.chronicEwmaAu).toBeCloseTo(200 * lambda + (1 - lambda) * chronic1, 10);
    expect(series.map((day) => day.historyDays)).toEqual([1, 2, 3]);
    expect(series.map((day) => day.hasData)).toEqual([true, false, true]);
  });

  it('reports insufficient history for 27 days and the ACWR from day 28', () => {
    const series = computeLoadSeries({
      loads: constantLoads(START, 40, 100),
      to: addDays(START, 39),
    });
    const day27 = series[26];
    const day28 = series[27];
    expect(day27).toMatchObject({
      historyDays: 27,
      acwr: null,
      acwrStatus: 'insufficient_history',
    });
    expect(day27?.acuteEwmaAu).toBe(100);
    expect(day28).toMatchObject({ historyDays: 28, acwr: 1, acwrStatus: 'ok' });
    expect(day28).toMatchObject({
      monotony: null,
      strainAu: null,
      monotonyStatus: 'zero_variance',
    });
    expect(day28?.windowLoadAu).toBe(700);
  });

  it('computes the ACWR of a load spike after a stable month', () => {
    const loads = [...constantLoads(START, 28, 100), ...constantLoads(addDays(START, 28), 7, 300)];
    const series = computeLoadSeries({ loads, to: addDays(START, 34) });
    const last = series.at(-1);
    const acute = 300 - 200 * 0.75 ** 7;
    const chronic = 300 - 200 * (1 - 2 / 29) ** 7;
    expect(last?.acuteEwmaAu).toBeCloseTo(acute, 9);
    expect(last?.chronicEwmaAu).toBeCloseTo(chronic, 9);
    expect(last?.acwr).toBeCloseTo(acute / chronic, 9);
    expect(last?.acwrStatus).toBe('ok');
    expect(last?.acwr).toBeGreaterThan(1.4);
  });

  it('counts days without data as 0 and per window', () => {
    // Monday, Wednesday and Friday sessions only.
    const loads = localDateRange(START, addDays(START, 34))
      .filter((_, i) => [0, 2, 4].includes(i % 7))
      .map((date) => ({ date, loadAu: 300 }));
    const series = computeLoadSeries({ loads, to: addDays(START, 34) });
    const last = series.at(-1);
    expect(last?.missingDaysInAcuteWindow).toBe(4);
    expect(last?.missingDaysInChronicWindow).toBe(16);
    expect(last?.windowLoadAu).toBe(900);
    // Last 7 days: Sat, Sun, Mon, Tue, Wed, Thu, Fri → 0, 0, 300, 0, 300, 0, 300.
    const expected = fosterMonotony([0, 0, 300, 0, 300, 0, 300]);
    expect(last?.monotony).toBeCloseTo(expected.monotony ?? Number.NaN, 12);
    expect(last?.strainAu).toBeCloseTo(expected.strainAu ?? Number.NaN, 9);
    expect(last?.monotonyStatus).toBe('ok');
    // Windows are clipped to the history.
    expect(series[1]?.missingDaysInAcuteWindow).toBe(1);
    expect(series[5]?.monotonyStatus).toBe('insufficient_history');
    expect(series[6]?.monotonyStatus).toBe('ok');
  });

  it('reports a zero chronic load when there is history but no load', () => {
    const series = computeLoadSeries({
      loads: [],
      historyStart: START,
      to: addDays(START, 29),
    });
    expect(series.at(-1)).toMatchObject({ acwr: null, acwrStatus: 'zero_chronic_load' });
    expect(series.at(-1)?.missingDaysInChronicWindow).toBe(28);
  });

  it('uses an explicit history start and returns only the days from `from`', () => {
    const series = computeLoadSeries({
      loads: [{ date: addDays(START, 2), loadAu: 400 }],
      historyStart: START,
      from: addDays(START, -1),
      to: addDays(START, 2),
    });
    expect(series.map((day) => [day.date, day.historyDays, day.acuteEwmaAu])).toEqual([
      ['2026-03-01', 0, 0],
      ['2026-03-02', 1, 0],
      ['2026-03-03', 2, 0],
      ['2026-03-04', 3, 100],
    ]);

    const tail = computeLoadSeries({
      loads: constantLoads(START, 10, 100),
      from: addDays(START, 8),
      to: addDays(START, 9),
    });
    expect(tail.map((day) => day.historyDays)).toEqual([9, 10]);
  });

  it('ignores loads after `to` and honours the club parameters', () => {
    const loads = [...constantLoads(START, 3, 100), { date: addDays(START, 10), loadAu: 5000 }];
    const series = computeLoadSeries({
      loads,
      to: addDays(START, 2),
      parameters: resolveLoadParameters({
        acuteWindowDays: 3,
        chronicWindowDays: 6,
        minHistoryDays: 3,
        ewmaSeed: 'zero',
        monotonyWindowDays: 3,
      }),
    });
    expect(series).toHaveLength(3);
    expect(series.map((day) => day.acuteEwmaAu)).toEqual([50, 75, 87.5]);
    expect(series[1]?.acwrStatus).toBe('insufficient_history');
    expect(series[2]?.acwrStatus).toBe('ok');
    expect(series[2]?.monotonyStatus).toBe('zero_variance');
  });

  it('rejects inconsistent ranges and loads before the history start', () => {
    expectInvalid(() => computeLoadSeries({ loads: [], from: addDays(START, 1), to: START }));
    expectInvalid(() =>
      computeLoadSeries({
        loads: [{ date: START, loadAu: 1 }],
        historyStart: addDays(START, 1),
        to: addDays(START, 2),
      }),
    );
    expectInvalid(() =>
      computeLoadSeries({
        loads: [],
        to: START,
        parameters: { ...DEFAULT_LOAD_PARAMETERS, acuteWindowDays: 0 },
      }),
    );
  });
});

describe('isoWeekLoadSummaries', () => {
  it('summarises full ISO weeks and flags incomplete ones', () => {
    // Wednesday to the next Wednesday; history starts on the first load.
    const loads = localDateRange(d('2026-03-04'), d('2026-03-15')).map((date, i) => ({
      date,
      loadAu: (i + 1) * 100,
    }));
    const weeks = isoWeekLoadSummaries({ loads, from: d('2026-03-04'), to: d('2026-03-18') });
    expect(weeks.map((week) => [week.weekStart, week.weekEnd, week.status])).toEqual([
      ['2026-03-02', '2026-03-08', 'incomplete_week'],
      ['2026-03-09', '2026-03-15', 'ok'],
      ['2026-03-16', '2026-03-22', 'incomplete_week'],
    ]);
    expect(weeks[0]).toMatchObject({ totalLoadAu: 1500, daysWithData: 5, missingDays: 0 });
    expect(weeks[0]?.meanDailyLoadAu).toBe(300);
    const full = fosterMonotony([600, 700, 800, 900, 1000, 1100, 1200]);
    expect(weeks[1]).toMatchObject({
      totalLoadAu: 6300,
      daysWithData: 7,
      missingDays: 0,
      meanDailyLoadAu: 900,
    });
    expect(weeks[1]?.monotony).toBeCloseTo(full.monotony ?? Number.NaN, 12);
    expect(weeks[1]?.strainAu).toBeCloseTo(full.strainAu ?? Number.NaN, 9);
    expect(weeks[2]).toMatchObject({ totalLoadAu: 0, daysWithData: 0, missingDays: 3 });
  });

  it('counts missing days inside the history as 0 and handles rest weeks', () => {
    const weeks = isoWeekLoadSummaries({
      loads: [{ date: d('2026-03-02'), loadAu: 700 }],
      from: d('2026-03-02'),
      to: d('2026-03-15'),
      standardDeviation: 'population',
    });
    expect(weeks[0]).toMatchObject({
      totalLoadAu: 700,
      daysWithData: 1,
      missingDays: 6,
      meanDailyLoadAu: 100,
      status: 'ok',
    });
    expect(weeks[0]?.monotony).toBeCloseTo(100 / Math.sqrt((600 ** 2 + 6 * 100 ** 2) / 7), 12);
    expect(weeks[1]).toMatchObject({ totalLoadAu: 0, monotony: null, status: 'zero_variance' });
  });

  it('has no known days without history', () => {
    const weeks = isoWeekLoadSummaries({ loads: [], from: START, to: START });
    expect(weeks).toEqual([
      {
        weekStart: '2026-03-02',
        weekEnd: '2026-03-08',
        totalLoadAu: 0,
        daysWithData: 0,
        missingDays: 0,
        meanDailyLoadAu: null,
        sdDailyLoadAu: null,
        monotony: null,
        strainAu: null,
        status: 'incomplete_week',
      },
    ]);
    expectInvalid(() => isoWeekLoadSummaries({ loads: [], from: addDays(START, 1), to: START }));
  });
});
