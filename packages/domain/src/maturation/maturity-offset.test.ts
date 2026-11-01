import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATURITY_OFFSET_EQUATION,
  DomainValidationError,
  MATURITY_OFFSET_EQUATIONS,
  MATURITY_OFFSET_MODELS,
  SEXES,
  isCoefficientVerificationStatus,
  isMaturityOffsetEquation,
  maturityOffset,
  maturityOffsetModel,
  maturityOffsetRequiredInputs,
  parseMaturityOffsetEquation,
  predictMaturityOffset,
  type MaturityOffsetModel,
} from '../index.js';

// Expected values are computed by hand from the published equations (see the
// package README), independently of the model data, so a typo in a coefficient
// fails the test. Neither paper has an accessible worked example.

const boy = { ageYears: 13, heightCm: 160, sittingHeightCm: 82, weightKg: 48 } as const;
const girl = { ageYears: 12, heightCm: 152, sittingHeightCm: 79, weightKg: 42 } as const;

describe('Mirwald 2002', () => {
  it('boys: -9.236 + 0.0002708·LL·SH − 0.001663·E·LL + 0.007216·E·SH + 0.02292·W/H·100', () => {
    // LL = 78; LL·SH = 6396; E·LL = 1014; E·SH = 1066; W/H·100 = 30
    const r = maturityOffset({ sex: 'male', equation: 'mirwald_2002', ...boy });
    expect(r.maturityOffsetYears).toBeCloseTo(-0.8103892, 9);
    expect(r.ageAtPhvYears).toBeCloseTo(13.8103892, 9);
    expect(r.seeYears).toBe(0.49);
    expect(r.warnings).toEqual([]);
  });

  it('girls: −9.376 + 0.0001882·LL·SH + 0.0022·E·LL + 0.005841·E·SH − 0.002658·E·W + 0.07693·W/H·100', () => {
    const r = maturityOffset({ sex: 'female', equation: 'mirwald_2002', ...girl });
    expect(r.maturityOffsetYears).toBeCloseTo(-0.0401172316, 9);
    expect(r.ageAtPhvYears).toBeCloseTo(12.0401172316, 9);
    expect(r.seeYears).toBe(0.5);
  });

  it('needs sitting height and weight', () => {
    expect(maturityOffsetRequiredInputs(maturityOffsetModel('mirwald_2002', 'male'))).toEqual([
      'sittingHeightCm',
      'weightKg',
    ]);
    expect(() =>
      maturityOffset({ sex: 'male', equation: 'mirwald_2002', ageYears: 13, heightCm: 160 }),
    ).toThrow(DomainValidationError);
    expect(() =>
      maturityOffset({
        sex: 'female',
        equation: 'mirwald_2002',
        ageYears: 12,
        heightCm: 152,
        sittingHeightCm: 79,
      }),
    ).toThrow(/weightKg/);
  });
});

describe('Moore 2015', () => {
  it('boys: −8.128741 + 0.0070346·E·SH', () => {
    const r = maturityOffset({ sex: 'male', equation: 'moore_2015', ...boy });
    expect(r.maturityOffsetYears).toBeCloseTo(-0.6298574, 9);
    expect(r.seeYears).toBe(0.51);
  });

  it('girls: −7.709133 + 0.0042232·E·T, without sitting height or weight', () => {
    const r = maturityOffset({
      sex: 'female',
      equation: 'moore_2015',
      ageYears: 12,
      heightCm: 152,
    });
    expect(r.maturityOffsetYears).toBeCloseTo(-0.0060162, 9);
    expect(r.seeYears).toBe(0.52);
  });

  it('boys without sitting height: −7.999994 + 0.0036124·E·T', () => {
    const r = maturityOffset({
      sex: 'male',
      equation: 'moore_2015_height',
      ageYears: 13,
      heightCm: 160,
    });
    expect(r.maturityOffsetYears).toBeCloseTo(-0.486202, 9);
    expect(r.seeYears).toBeNull();
  });

  it('has no age × height alternative for girls', () => {
    expect(() =>
      maturityOffset({ sex: 'female', equation: 'moore_2015_height', ageYears: 12, heightCm: 152 }),
    ).toThrow(DomainValidationError);
  });

  it('is the default equation', () => {
    expect(DEFAULT_MATURITY_OFFSET_EQUATION).toBe('moore_2015');
    expect(maturityOffset({ sex: 'male', ...boy }).equation).toBe('moore_2015');
  });

  it('does not need weight for boys', () => {
    expect(
      maturityOffset({ sex: 'male', ageYears: 13, heightCm: 160, sittingHeightCm: 82 })
        .maturityOffsetYears,
    ).toBeCloseTo(-0.6298574, 9);
  });
});

describe('predictMaturityOffset', () => {
  it('warns outside the development sample age range without blocking', () => {
    const young = maturityOffset({ sex: 'male', ...boy, ageYears: 7.4 });
    expect(young.warnings).toEqual(['age_outside_development_sample']);
    const edge = maturityOffset({ sex: 'male', ...boy, ageYears: 17.5 });
    expect(edge.warnings).toEqual([]);
    const mirwaldOld = maturityOffset({
      sex: 'female',
      equation: 'mirwald_2002',
      ...girl,
      ageYears: 16.5,
    });
    expect(mirwaldOld.warnings).toEqual(['age_outside_development_sample']);
  });

  it.each([
    { ageYears: 0 },
    { ageYears: Number.NaN },
    { heightCm: -1 },
    { heightCm: Number.POSITIVE_INFINITY },
    { sittingHeightCm: 0 },
    { sittingHeightCm: 160 },
    { sittingHeightCm: 170 },
    { weightKg: 0 },
  ])('rejects invalid input %o', (patch) => {
    expect(() =>
      maturityOffset({ sex: 'male', equation: 'mirwald_2002', ...boy, ...patch }),
    ).toThrow(DomainValidationError);
  });

  it('evaluates a model supplied as data', () => {
    const custom: MaturityOffsetModel = {
      ...maturityOffsetModel('moore_2015', 'female'),
      interceptYears: -1,
      coefficients: { age_x_height: 0.001 },
    };
    expect(predictMaturityOffset(custom, { ageYears: 10, heightCm: 100 }).maturityOffsetYears).toBe(
      0,
    );
  });
});

describe('MATURITY_OFFSET_MODELS', () => {
  it('has Mirwald and Moore for both sexes and Moore age × height for boys', () => {
    const keys = MATURITY_OFFSET_MODELS.map((m) => `${m.equation}:${m.sex}`).sort();
    expect(keys).toEqual([
      'mirwald_2002:female',
      'mirwald_2002:male',
      'moore_2015:female',
      'moore_2015:male',
      'moore_2015_height:male',
    ]);
    for (const sex of SEXES) {
      expect(maturityOffsetModel('mirwald_2002', sex).sex).toBe(sex);
      expect(maturityOffsetModel('moore_2015', sex).sex).toBe(sex);
    }
  });

  it('records the provenance of every model', () => {
    for (const model of MATURITY_OFFSET_MODELS) {
      expect(model.provenance.citation).toMatch(/Med Sci Sports Exerc/);
      expect(model.provenance.doi).toMatch(/^10\./);
      expect(isCoefficientVerificationStatus(model.provenance.verification)).toBe(true);
      expect(model.provenance.verificationNotes).not.toBe('');
    }
  });

  it('parses equations', () => {
    for (const eq of MATURITY_OFFSET_EQUATIONS) expect(parseMaturityOffsetEquation(eq)).toBe(eq);
    expect(isMaturityOffsetEquation('mirwald')).toBe(false);
    expect(() => parseMaturityOffsetEquation('mirwald')).toThrow(DomainValidationError);
  });
});
