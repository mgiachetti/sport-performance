import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INJURY_INCIDENCE_PARAMS,
  DomainValidationError,
  EXPOSURE_CONTEXTS,
  INJURY_CONTEXTS,
  exposureHours,
  exposureHoursByPlayer,
  incidencePer1000H,
  injuryIncidence,
  injuryTimeLoss,
  isExposureContext,
  isInjuryContext,
  parseExposureContext,
  parseInjuryContext,
  parseInjuryDefinition,
  parseLocalDate,
  parsePlayerId,
  poissonMeanConfidenceInterval,
  poissonRateConfidenceInterval,
  ratePerExposureHours,
  type ExposureContext,
  type ExposureEntry,
  type InjuryContext,
  type InjuryRecord,
  type LocalDate,
} from '../index.js';

const ana = parsePlayerId('0b6f4f5e-8c1a-4f3e-9a51-2d3c4b5a6f70');
const beto = parsePlayerId('1c7f4f5e-8c1a-4f3e-9a51-2d3c4b5a6f71');
const d = (value: string): LocalDate => parseLocalDate(value);

function entry(
  date: string,
  context: ExposureContext,
  durationMin: number,
  playerId = ana,
): ExposureEntry {
  return { playerId, date: d(date), context, durationMin };
}

function injury(
  onset: string,
  context: InjuryContext,
  returnDate: string | null = null,
  playerId = ana,
): InjuryRecord {
  return {
    playerId,
    onsetDate: d(onset),
    context,
    returnDate: returnDate === null ? null : d(returnDate),
  };
}

const invalidArgument: unknown = expect.objectContaining({ code: 'invalid_argument' });

describe('contexts', () => {
  it('are closed enumerations', () => {
    expect(EXPOSURE_CONTEXTS).toEqual(['training', 'match']);
    expect(INJURY_CONTEXTS).toEqual(['training', 'match', 'other']);
    expect(isExposureContext('match')).toBe(true);
    expect(isExposureContext('other')).toBe(false);
    expect(isInjuryContext('other')).toBe(true);
    expect(parseExposureContext('training')).toBe('training');
    expect(parseInjuryContext('other')).toBe('other');
    expect(() => parseExposureContext('gym')).toThrow(invalidArgument);
    expect(() => parseInjuryContext(undefined)).toThrow(DomainValidationError);
    expect(parseInjuryDefinition('time_loss')).toBe('time_loss');
    expect(() => parseInjuryDefinition('any')).toThrow(invalidArgument);
  });
});

describe('exposureHours', () => {
  const entries = [
    entry('2026-03-02', 'training', 90),
    entry('2026-03-04', 'training', 75, beto),
    entry('2026-03-07', 'match', 70),
    entry('2026-03-07', 'match', 35, beto),
    entry('2026-03-09', 'training', 0, beto),
    entry('2026-03-14', 'match', 70),
  ];

  it('sums minutes by context and converts to hours', () => {
    expect(exposureHours(entries)).toEqual({ trainingH: 2.75, matchH: 175 / 60, totalH: 340 / 60 });
  });

  it('is zero without entries', () => {
    expect(exposureHours([])).toEqual({ trainingH: 0, matchH: 0, totalH: 0 });
  });

  it('filters by an inclusive period, open at either end', () => {
    expect(exposureHours(entries, { from: d('2026-03-04'), to: d('2026-03-07') })).toEqual({
      trainingH: 1.25,
      matchH: 1.75,
      totalH: 3,
    });
    expect(exposureHours(entries, { from: d('2026-03-08') }).totalH).toBeCloseTo(70 / 60);
    expect(exposureHours(entries, { to: d('2026-03-02') }).totalH).toBe(1.5);
  });

  it('breaks exposure down per player', () => {
    const byPlayer = exposureHoursByPlayer(entries, { to: d('2026-03-09') });
    expect(byPlayer.get(ana)).toEqual({ trainingH: 1.5, matchH: 70 / 60, totalH: 160 / 60 });
    expect(byPlayer.get(beto)).toEqual({ trainingH: 1.25, matchH: 35 / 60, totalH: 110 / 60 });
    expect(exposureHoursByPlayer(entries, { from: d('2026-03-10') }).has(beto)).toBe(false);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1441, '90' as unknown as number])(
    'rejects durationMin %j',
    (durationMin) => {
      expect(() => exposureHours([entry('2026-03-02', 'training', durationMin)])).toThrow(
        invalidArgument,
      );
    },
  );

  it('accepts a full day', () => {
    expect(exposureHours([entry('2026-03-02', 'training', 1440)]).totalH).toBe(24);
  });

  it('validates entries outside the period too', () => {
    const bad = { ...entry('2026-01-01', 'training', 60), context: 'gym' as ExposureContext };
    expect(() => exposureHours([bad], { from: d('2026-03-01') })).toThrow(invalidArgument);
    const badDate = { ...entry('2026-01-01', 'training', 60), date: '2026-13-01' as LocalDate };
    expect(() => exposureHoursByPlayer([badDate])).toThrow(invalidArgument);
  });

  it('rejects an inverted or malformed period', () => {
    expect(() => exposureHours(entries, { from: d('2026-03-10'), to: d('2026-03-01') })).toThrow(
      invalidArgument,
    );
    expect(() => exposureHours(entries, { from: '01/03/2026' as LocalDate })).toThrow(
      invalidArgument,
    );
  });
});

describe('Poisson confidence intervals (exact, Garwood)', () => {
  // Reference values: exact 95% limits for a Poisson count (chi-square tables).
  it.each([
    [0, 0, 3.688879],
    [1, 0.025318, 5.571643],
    [10, 4.795389, 18.390356],
    [100, 81.364, 121.627],
  ])('count %i → [%f, %f]', (count, lower, upper) => {
    const ci = poissonMeanConfidenceInterval(count, 0.95);
    // Tables give 3 decimals for large counts, 6 for small ones.
    const digits = count >= 100 ? 3 : 5;
    expect(ci.lower).toBeCloseTo(lower, digits);
    expect(ci.upper).toBeCloseTo(upper, digits);
  });

  it('narrows with a lower confidence level', () => {
    const ci90 = poissonMeanConfidenceInterval(10, 0.9);
    expect(ci90.lower).toBeCloseTo(5.425406, 5);
    expect(ci90.upper).toBeCloseTo(16.962219, 5);
  });

  it('handles large counts without underflow', () => {
    const ci = poissonMeanConfidenceInterval(5000, 0.95);
    expect(ci.lower).toBeGreaterThan(4860);
    expect(ci.lower).toBeLessThan(4865);
    expect(ci.upper).toBeGreaterThan(5136);
    expect(ci.upper).toBeLessThan(5141);
  });

  it('scales to a rate', () => {
    const ci = poissonRateConfidenceInterval(10, 500, 0.95, 1000);
    expect(ci.lower).toBeCloseTo(9.590778, 5);
    expect(ci.upper).toBeCloseTo(36.780712, 5);
  });

  it.each([
    () => poissonMeanConfidenceInterval(-1, 0.95),
    () => poissonMeanConfidenceInterval(1.5, 0.95),
    () => poissonMeanConfidenceInterval(1, 0),
    () => poissonMeanConfidenceInterval(1, 1),
    () => poissonMeanConfidenceInterval(1, Number.NaN),
    () => poissonRateConfidenceInterval(1, 0, 0.95),
    () => poissonRateConfidenceInterval(1, 10, 0.95, -1000),
  ])('rejects invalid input %#', (call) => {
    expect(call).toThrow(invalidArgument);
  });
});

describe('rates', () => {
  it('computes injuries per 1000 h', () => {
    expect(incidencePer1000H(3, 1500)).toBe(2);
    expect(ratePerExposureHours(3, 1500, 100)).toBeCloseTo(0.2);
  });

  it('has no rate without exposure', () => {
    expect(incidencePer1000H(0, 0)).toBeNull();
    expect(incidencePer1000H(2, 0)).toBeNull();
  });

  it.each([
    [-1, 10],
    [Number.NaN, 10],
    [1, -10],
    [1, Number.POSITIVE_INFINITY],
  ])('rejects count %j with exposure %j', (count, exposureH) => {
    expect(() => incidencePer1000H(count, exposureH)).toThrow(invalidArgument);
  });
});

describe('injuryTimeLoss', () => {
  it('counts days from onset (day 0) to return', () => {
    expect(injuryTimeLoss(injury('2026-03-07', 'match', '2026-03-07'), d('2026-04-01'))).toEqual({
      daysLost: 0,
      ongoing: false,
    });
    expect(injuryTimeLoss(injury('2026-03-07', 'match', '2026-03-08'), d('2026-04-01'))).toEqual({
      daysLost: 1,
      ongoing: false,
    });
    expect(injuryTimeLoss(injury('2026-03-07', 'match', '2026-04-04'), d('2026-04-04'))).toEqual({
      daysLost: 28,
      ongoing: false,
    });
  });

  it('counts open injuries up to asOfDate', () => {
    expect(injuryTimeLoss(injury('2026-03-07', 'match'), d('2026-03-17'))).toEqual({
      daysLost: 10,
      ongoing: true,
    });
    const withoutField: InjuryRecord = {
      playerId: ana,
      onsetDate: d('2026-03-07'),
      context: 'training',
    };
    expect(injuryTimeLoss(withoutField, d('2026-03-07'))).toEqual({ daysLost: 0, ongoing: true });
  });

  it('treats a return after asOfDate as still open', () => {
    expect(injuryTimeLoss(injury('2026-03-07', 'match', '2026-04-04'), d('2026-03-10'))).toEqual({
      daysLost: 3,
      ongoing: true,
    });
  });

  it('rejects inconsistent dates', () => {
    expect(() =>
      injuryTimeLoss(injury('2026-03-07', 'match', '2026-03-06'), d('2026-04-01')),
    ).toThrow(invalidArgument);
    expect(() => injuryTimeLoss(injury('2026-03-07', 'match'), d('2026-03-06'))).toThrow(
      invalidArgument,
    );
    expect(() =>
      injuryTimeLoss(injury('2026-03-07', 'match', '2026-03-08'), d('2026-03-06')),
    ).toThrow(invalidArgument);
    expect(() => injuryTimeLoss(injury('2026-03-07', 'match'), '2026-3-6' as LocalDate)).toThrow(
      invalidArgument,
    );
  });
});

describe('injuryIncidence', () => {
  // 20 training sessions × 20 players × 90 min = 600 h; 5 matches × 20 players × 60 min = 100 h.
  const squad = Array.from({ length: 20 }, (_, i) =>
    parsePlayerId(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
  );
  const day = (n: number): string => `2026-03-${String(n).padStart(2, '0')}`;
  const exposures: ExposureEntry[] = squad.flatMap((playerId) => [
    ...Array.from({ length: 20 }, (_, i) => entry(day(i + 1), 'training', 90, playerId)),
    ...Array.from({ length: 5 }, (_, i) => entry(day(i * 7 + 1), 'match', 60, playerId)),
  ]);
  const injuries = [
    injury('2026-03-03', 'training', '2026-03-10'), // 7 days
    injury('2026-03-08', 'match', '2026-03-29'), // 21 days
    injury('2026-03-15', 'match', '2026-03-15'), // 0 days: medical attention only
    injury('2026-03-22', 'match', null, beto), // open
    injury('2026-03-10', 'other', '2026-03-20'), // outside the club
    injury('2026-02-20', 'training', '2026-03-05'), // before the period
  ];
  const period = { from: d('2026-03-01'), to: d('2026-03-31') };

  it('computes incidence, intervals and burden per context with the defaults', () => {
    const result = injuryIncidence({ exposures, injuries, asOfDate: d('2026-03-31'), period });

    expect(result.params).toEqual(DEFAULT_INJURY_INCIDENCE_PARAMS);
    expect(result.excludedByDefinitionCount).toBe(1);
    expect(result.otherContextInjuryCount).toBe(1);

    expect(result.training).toMatchObject({
      injuryCount: 1,
      ongoingInjuryCount: 0,
      exposureH: 600,
      daysLost: 7,
    });
    expect(result.training.incidence).toBeCloseTo(1000 / 600);
    expect(result.training.burden).toBeCloseTo(7000 / 600);
    expect(result.training.incidenceConfidenceInterval?.lower).toBeCloseTo(0.025318 / 0.6, 4);
    expect(result.training.incidenceConfidenceInterval?.upper).toBeCloseTo(5.571643 / 0.6, 4);

    // Open injury: 9 days (22 → 31) so far.
    expect(result.match).toMatchObject({
      injuryCount: 2,
      ongoingInjuryCount: 1,
      exposureH: 100,
      incidence: 20,
      daysLost: 30,
      burden: 300,
    });

    expect(result.overall).toMatchObject({
      injuryCount: 3,
      ongoingInjuryCount: 1,
      exposureH: 700,
      daysLost: 37,
    });
    expect(result.overall.incidence).toBeCloseTo(3000 / 700);
  });

  it('counts every injury with the medical attention definition', () => {
    const result = injuryIncidence({
      exposures,
      injuries,
      asOfDate: d('2026-03-31'),
      period,
      params: { definition: 'medical_attention' },
    });
    expect(result.match.injuryCount).toBe(3);
    expect(result.excludedByDefinitionCount).toBe(0);
    expect(result.params).toEqual({
      ...DEFAULT_INJURY_INCIDENCE_PARAMS,
      definition: 'medical_attention',
    });
  });

  it('applies a stricter time-loss threshold but always counts open injuries', () => {
    const result = injuryIncidence({
      exposures,
      injuries,
      asOfDate: d('2026-03-22'),
      period,
      params: { minTimeLossDays: 8 },
    });
    expect(result.training.injuryCount).toBe(0);
    // 03-08 returns on 03-29, after asOfDate: open as of 03-22 (14 days so far).
    expect(result.match).toMatchObject({ injuryCount: 2, ongoingInjuryCount: 2, daysLost: 14 });
    expect(result.excludedByDefinitionCount).toBe(2);
    // `other` cases also follow the definition.
    expect(result.otherContextInjuryCount).toBe(1);
  });

  it('uses the configured rate base and confidence level', () => {
    const result = injuryIncidence({
      exposures,
      injuries,
      asOfDate: d('2026-03-31'),
      period,
      params: { ratePerHours: 100, confidenceLevel: 0.9 },
    });
    expect(result.match.incidence).toBe(2);
    expect(result.match.burden).toBe(30);
    const ci = poissonRateConfidenceInterval(2, 100, 0.9, 100);
    expect(result.match.incidenceConfidenceInterval).toEqual(ci);
  });

  it('gives an upper bound with zero injuries and no rate without exposure', () => {
    const result = injuryIncidence({
      exposures: exposures.filter((e) => e.context === 'training'),
      injuries: [],
      asOfDate: d('2026-03-31'),
    });
    expect(result.training.incidence).toBe(0);
    expect(result.training.incidenceConfidenceInterval?.lower).toBe(0);
    expect(result.training.incidenceConfidenceInterval?.upper).toBeCloseTo(3688.879 / 600, 3);
    expect(result.match).toEqual({
      injuryCount: 0,
      ongoingInjuryCount: 0,
      exposureH: 0,
      incidence: null,
      incidenceConfidenceInterval: null,
      daysLost: 0,
      burden: null,
    });
  });

  it('assigns injuries to the period by onset date, without a period all count', () => {
    const result = injuryIncidence({ exposures, injuries, asOfDate: d('2026-03-31') });
    expect(result.training.injuryCount).toBe(2);
    expect(result.training.daysLost).toBe(7 + 13);
  });

  it.each([
    [{ definition: 'any' }],
    [{ minTimeLossDays: -1 }],
    [{ minTimeLossDays: 1.5 }],
    [{ ratePerHours: 0 }],
    [{ confidenceLevel: 1 }],
  ])('rejects params %j', (params) => {
    expect(() =>
      injuryIncidence({
        exposures,
        injuries,
        asOfDate: d('2026-03-31'),
        params: params as never,
      }),
    ).toThrow(invalidArgument);
  });

  it('validates every injury, also those outside the period', () => {
    const base = { exposures, asOfDate: d('2026-03-31'), period };
    expect(() =>
      injuryIncidence({ ...base, injuries: [injury('2026-01-10', 'training', '2026-01-09')] }),
    ).toThrow(invalidArgument);
    expect(() =>
      injuryIncidence({
        ...base,
        injuries: [{ ...injury('2026-03-10', 'training'), context: 'gym' as InjuryContext }],
      }),
    ).toThrow(invalidArgument);
    expect(() =>
      injuryIncidence({
        ...base,
        injuries: [injury('2026-03-10', 'training')],
        asOfDate: d('2026-03-09'),
      }),
    ).toThrow(invalidArgument);
  });

  it('defaults are frozen data', () => {
    expect(Object.isFrozen(DEFAULT_INJURY_INCIDENCE_PARAMS)).toBe(true);
    expect(DEFAULT_INJURY_INCIDENCE_PARAMS).toEqual({
      definition: 'time_loss',
      minTimeLossDays: 1,
      ratePerHours: 1000,
      confidenceLevel: 0.95,
    });
  });
});
