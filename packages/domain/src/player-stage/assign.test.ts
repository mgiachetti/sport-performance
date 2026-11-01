import { describe, expect, it } from 'vitest';
import {
  AUTOMATIC_STAGE_REASONS,
  DEFAULT_AGE_BANDS,
  DEFAULT_FEMALE_STAGE_ASSIGNMENT_PARAMS,
  DEFAULT_MALE_STAGE_ASSIGNMENT_PARAMS,
  DEFAULT_STAGE_ASSIGNMENT_PARAMS_BY_SEX,
  DomainValidationError,
  activeStagePin,
  addDays,
  assignPlayerStage,
  automaticPlayerStage,
  maturationStageForPhvOffset,
  parseStageAssignmentParams,
  projectPhvOffsetYears,
  type LocalDate,
  type Stage,
  type StageAssignmentParams,
  type StagePin,
} from '../index.js';

const day = (s: string): LocalDate => s as LocalDate;
const ON = day('2026-04-15');
const MALE = DEFAULT_MALE_STAGE_ASSIGNMENT_PARAMS;

function auto(categoryStage: Stage, phvOffsetYears: number, params: StageAssignmentParams = MALE) {
  return automaticPlayerStage({
    onDate: ON,
    categoryStage,
    phvOffset: { phvOffsetYears, measuredOn: ON },
    params,
  });
}

describe('maturationStageForPhvOffset', () => {
  it.each([
    [-2, 'foundation'],
    [0.49, 'foundation'],
    [0.5, 'development'],
    [2.49, 'development'],
    [2.5, 'performance'],
    [5, 'performance'],
  ] as const)('offset %d → %s (male defaults)', (offset, stage) => {
    expect(maturationStageForPhvOffset(offset, MALE)).toBe(stage);
  });
});

describe('projectPhvOffsetYears', () => {
  it('adds the years elapsed since the measurement', () => {
    expect(
      projectPhvOffsetYears({ phvOffsetYears: -0.5, measuredOn: day('2025-04-15') }, ON),
    ).toBeCloseTo(-0.5 + 365 / 365.25, 10);
  });

  it('is the measured offset on the measurement day', () => {
    expect(projectPhvOffsetYears({ phvOffsetYears: 1.2, measuredOn: ON }, ON)).toBe(1.2);
  });
});

describe('automaticPlayerStage', () => {
  it('uses the category without an estimate', () => {
    expect(
      automaticPlayerStage({ onDate: ON, categoryStage: 'development', params: MALE }),
    ).toEqual({
      stage: 'development',
      basis: 'category',
      reason: 'no_maturation_estimate',
      categoryStage: 'development',
    });
  });

  it('keeps the category when maturation agrees', () => {
    expect(auto('foundation', -0.8)).toMatchObject({
      stage: 'foundation',
      basis: 'category',
      reason: 'maturation_matches_category',
      maturationStage: 'foundation',
      phvOffsetYearsOnDate: -0.8,
    });
  });

  it('moves an early-maturing M14 up to development', () => {
    expect(auto('foundation', 1.2)).toMatchObject({
      stage: 'development',
      basis: 'maturation',
      reason: 'maturation_shift',
      categoryStage: 'foundation',
      maturationStage: 'development',
    });
  });

  it('moves a late-maturing M15 down to foundation', () => {
    expect(auto('development', -0.3)).toMatchObject({
      stage: 'foundation',
      basis: 'maturation',
      reason: 'maturation_shift',
    });
  });

  it('moves an early-maturing M16 up and a late-maturing M17 down', () => {
    expect(auto('development', 3.2).stage).toBe('performance');
    expect(auto('performance', 1.5).stage).toBe('development');
  });

  describe('uncertainty margin', () => {
    it.each([0.5, 0.99])('keeps foundation at offset %d (below threshold + margin)', (offset) => {
      expect(auto('foundation', offset)).toMatchObject({
        stage: 'foundation',
        basis: 'category',
        reason: 'within_uncertainty_margin',
        maturationStage: 'development',
      });
    });

    it('moves up exactly at threshold + margin', () => {
      expect(auto('foundation', 1).stage).toBe('development');
    });

    it.each([0.49, 0])(
      'keeps development at offset %d (not below threshold − margin)',
      (offset) => {
        expect(auto('development', offset)).toMatchObject({
          stage: 'development',
          reason: 'within_uncertainty_margin',
          maturationStage: 'foundation',
        });
      },
    );

    it('moves down just below threshold − margin', () => {
      expect(auto('development', -0.01).stage).toBe('foundation');
    });

    it('with a zero margin, the threshold alone decides', () => {
      const params = { ...MALE, uncertaintyMarginYears: 0 };
      expect(auto('foundation', 0.5, params).stage).toBe('development');
      expect(auto('development', 0.49, params).stage).toBe('foundation');
    });

    it('a two-stage jump within the margin of the far threshold moves one stage', () => {
      // 2.8 is past performance (2.5) but within its margin; past development + margin.
      const params = { ...MALE, maxStageStepsFromCategory: 2 };
      expect(auto('foundation', 2.8, params)).toMatchObject({
        stage: 'development',
        reason: 'maturation_shift',
        maturationStage: 'performance',
      });
    });
  });

  describe('step cap', () => {
    it('never takes an M13/M14 to performance with the defaults', () => {
      expect(auto('foundation', 4)).toMatchObject({
        stage: 'development',
        basis: 'maturation',
        reason: 'maturation_shift_capped',
        maturationStage: 'performance',
      });
    });

    it('never takes an M17/M19 down to foundation with the defaults', () => {
      expect(auto('performance', -2)).toMatchObject({
        stage: 'development',
        reason: 'maturation_shift_capped',
      });
    });

    it('allows two steps when configured', () => {
      const params = { ...MALE, maxStageStepsFromCategory: 2 };
      expect(auto('foundation', 4, params)).toMatchObject({
        stage: 'performance',
        reason: 'maturation_shift',
      });
    });

    it('disables maturation with a cap of 0', () => {
      const params = { ...MALE, maxStageStepsFromCategory: 0 };
      expect(auto('foundation', 4, params)).toMatchObject({
        stage: 'foundation',
        basis: 'category',
        reason: 'maturation_shift_capped',
      });
    });
  });

  describe('estimate age', () => {
    it('projects an older estimate to the day', () => {
      // 0.6 measured 200 days before → ≈ 1.15 on the day: past threshold + margin.
      const result = automaticPlayerStage({
        onDate: ON,
        categoryStage: 'foundation',
        phvOffset: { phvOffsetYears: 0.6, measuredOn: addDays(ON, -200) },
        params: MALE,
      });
      expect(result.stage).toBe('development');
      expect(result.phvOffsetYearsOnDate).toBeCloseTo(0.6 + 200 / 365.25, 10);
    });

    it('accepts an estimate exactly maxPhvOffsetEstimateAgeDays old', () => {
      const result = automaticPlayerStage({
        onDate: ON,
        categoryStage: 'foundation',
        phvOffset: { phvOffsetYears: -1, measuredOn: addDays(ON, -365) },
        params: MALE,
      });
      expect(result.reason).toBe('maturation_matches_category');
    });

    it('ignores a stale estimate', () => {
      expect(
        automaticPlayerStage({
          onDate: ON,
          categoryStage: 'foundation',
          phvOffset: { phvOffsetYears: 3, measuredOn: addDays(ON, -366) },
          params: MALE,
        }),
      ).toEqual({
        stage: 'foundation',
        basis: 'category',
        reason: 'maturation_estimate_stale',
        categoryStage: 'foundation',
      });
    });

    it('ignores an estimate measured after the day', () => {
      expect(
        automaticPlayerStage({
          onDate: ON,
          categoryStage: 'foundation',
          phvOffset: { phvOffsetYears: 3, measuredOn: addDays(ON, 1) },
          params: MALE,
        }).reason,
      ).toBe('maturation_estimate_after_date');
    });
  });

  describe('validation', () => {
    it.each([Number.NaN, Number.POSITIVE_INFINITY, -6.01, 8.01])('rejects offset %d', (offset) => {
      expect(() => auto('foundation', offset)).toThrow(DomainValidationError);
    });

    it('rejects an invalid category stage and dates', () => {
      expect(() =>
        automaticPlayerStage({ onDate: ON, categoryStage: 'elite' as Stage, params: MALE }),
      ).toThrow(DomainValidationError);
      expect(() =>
        automaticPlayerStage({
          onDate: day('2026-02-30'),
          categoryStage: 'foundation',
          params: MALE,
        }),
      ).toThrow(DomainValidationError);
    });

    it('rejects invalid params', () => {
      expect(() => auto('foundation', 0, { ...MALE, uncertaintyMarginYears: -0.1 })).toThrow(
        DomainValidationError,
      );
    });
  });
});

describe('parseStageAssignmentParams', () => {
  it('accepts the defaults', () => {
    for (const params of Object.values(DEFAULT_STAGE_ASSIGNMENT_PARAMS_BY_SEX)) {
      expect(parseStageAssignmentParams(params)).toBe(params);
    }
  });

  it.each<[string, Partial<StageAssignmentParams>]>([
    ['non-finite threshold', { developmentFromPhvOffsetYears: Number.NaN }],
    ['infinite threshold', { performanceFromPhvOffsetYears: Number.POSITIVE_INFINITY }],
    ['equal thresholds', { developmentFromPhvOffsetYears: 2.5 }],
    ['reversed thresholds', { performanceFromPhvOffsetYears: 0 }],
    ['negative margin', { uncertaintyMarginYears: -1 }],
    ['fractional cap', { maxStageStepsFromCategory: 0.5 }],
    ['negative cap', { maxStageStepsFromCategory: -1 }],
    ['cap above stage count', { maxStageStepsFromCategory: 3 }],
    ['zero estimate age', { maxPhvOffsetEstimateAgeDays: 0 }],
    ['fractional estimate age', { maxPhvOffsetEstimateAgeDays: 30.5 }],
  ])('rejects %s', (_, patch) => {
    const params = { ...MALE, ...patch };
    let error: unknown;
    try {
      parseStageAssignmentParams(params);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).code).toBe('invalid_argument');
  });
});

describe('default params', () => {
  it('female thresholds are the male ones shifted by 2 years', () => {
    expect(
      DEFAULT_FEMALE_STAGE_ASSIGNMENT_PARAMS.developmentFromPhvOffsetYears -
        MALE.developmentFromPhvOffsetYears,
    ).toBe(2);
    expect(
      DEFAULT_FEMALE_STAGE_ASSIGNMENT_PARAMS.performanceFromPhvOffsetYears -
        MALE.performanceFromPhvOffsetYears,
    ).toBe(2);
  });

  // Average boy: age at PHV ≈ 13.8. Mid-band chronological ages (age in
  // season year − 0.5) should land on the band's default stage.
  it.each(DEFAULT_AGE_BANDS.map((b) => [b.label, b] as const))(
    'an average-maturing %s boy keeps the stage of the band',
    (_, band) => {
      const midAge = (band.minAgeInSeasonYear + band.maxAgeInSeasonYear) / 2 - 0.5;
      const result = auto(band.defaultStage, midAge - 13.8);
      expect(result.stage).toBe(band.defaultStage);
      expect(result.basis).toBe('category');
    },
  );

  it.each(DEFAULT_AGE_BANDS.map((b) => [b.label, b] as const))(
    'an average-maturing %s girl keeps the stage of the band',
    (_, band) => {
      const midAge = (band.minAgeInSeasonYear + band.maxAgeInSeasonYear) / 2 - 0.5;
      const result = auto(
        band.defaultStage,
        midAge - 11.8,
        DEFAULT_STAGE_ASSIGNMENT_PARAMS_BY_SEX.female,
      );
      expect(result.stage).toBe(band.defaultStage);
    },
  );
});

describe('activeStagePin', () => {
  const pin = (stage: Stage, fromDate: string, untilDate?: string): StagePin => ({
    stage,
    fromDate: day(fromDate),
    ...(untilDate === undefined ? {} : { untilDate: day(untilDate) }),
  });

  it('applies from fromDate to untilDate, both inclusive', () => {
    const p = pin('development', '2026-04-01', '2026-04-15');
    expect(activeStagePin([p], day('2026-03-31'))).toBeUndefined();
    expect(activeStagePin([p], day('2026-04-01'))).toBe(p);
    expect(activeStagePin([p], day('2026-04-15'))).toBe(p);
    expect(activeStagePin([p], day('2026-04-16'))).toBeUndefined();
  });

  it('an open pin applies until replaced', () => {
    const p = pin('performance', '2025-01-01');
    expect(activeStagePin([p], day('2030-01-01'))).toBe(p);
  });

  it('the pin that started last wins, regardless of list order', () => {
    const older = pin('foundation', '2026-01-01');
    const newer = pin('performance', '2026-03-01');
    expect(activeStagePin([newer, older], ON)).toBe(newer);
    expect(activeStagePin([older, newer], ON)).toBe(newer);
  });

  it('on the same start day the later one in the list wins', () => {
    const a = pin('foundation', '2026-03-01');
    const b = pin('development', '2026-03-01');
    expect(activeStagePin([a, b], ON)).toBe(b);
  });

  it('an expired newer pin does not hide an open older one', () => {
    const older = pin('foundation', '2026-01-01');
    const expired = pin('performance', '2026-03-01', '2026-03-31');
    expect(activeStagePin([older, expired], ON)).toBe(older);
  });

  it('rejects a reversed pin and an invalid stage', () => {
    expect(() => activeStagePin([pin('foundation', '2026-04-10', '2026-04-01')], ON)).toThrow(
      DomainValidationError,
    );
    expect(() => activeStagePin([pin('elite' as Stage, '2026-04-10')], ON)).toThrow(
      DomainValidationError,
    );
  });
});

describe('assignPlayerStage', () => {
  const phvOffset = { phvOffsetYears: 1.5, measuredOn: ON };

  it('without pins returns the automatic stage', () => {
    const result = assignPlayerStage({
      onDate: ON,
      categoryStage: 'foundation',
      phvOffset,
      params: MALE,
    });
    expect(result.stage).toBe('development');
    expect(result.basis).toBe('maturation');
    expect(result.pin).toBeUndefined();
    expect(result.automatic.reason).toBe('maturation_shift');
  });

  it('a pin in force wins and the suggestion is kept', () => {
    const pin: StagePin = { stage: 'foundation', fromDate: day('2026-03-01') };
    const result = assignPlayerStage({
      onDate: ON,
      categoryStage: 'foundation',
      phvOffset,
      pins: [pin],
      params: MALE,
    });
    expect(result.stage).toBe('foundation');
    expect(result.basis).toBe('manual');
    expect(result.pin).toBe(pin);
    expect(result.automatic).toMatchObject({ stage: 'development', basis: 'maturation' });
  });

  it('staff may pin any stage, even beyond the step cap', () => {
    const result = assignPlayerStage({
      onDate: ON,
      categoryStage: 'foundation',
      pins: [{ stage: 'performance', fromDate: ON }],
      params: MALE,
    });
    expect(result.stage).toBe('performance');
    expect(result.basis).toBe('manual');
  });

  it('an expired pin falls back to the automatic stage', () => {
    const result = assignPlayerStage({
      onDate: ON,
      categoryStage: 'development',
      pins: [{ stage: 'foundation', fromDate: day('2026-01-01'), untilDate: day('2026-03-31') }],
      params: MALE,
    });
    expect(result).toMatchObject({ stage: 'development', basis: 'category' });
  });

  it('exposes every reason code', () => {
    expect(new Set(AUTOMATIC_STAGE_REASONS).size).toBe(AUTOMATIC_STAGE_REASONS.length);
  });
});
