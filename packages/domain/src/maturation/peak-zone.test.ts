import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PEAK_ZONE_PARAMS,
  DomainValidationError,
  peakHeightVelocityZone,
} from '../index.js';

describe('peakHeightVelocityZone', () => {
  it('defaults to an offset window of −1 to +1 years and no velocity threshold', () => {
    expect(DEFAULT_PEAK_ZONE_PARAMS).toEqual({
      offsetWindowYears: { minYears: -1, maxYears: 1 },
      minGrowthVelocityCmYear: null,
    });
  });

  it.each([
    [-1, true],
    [0, true],
    [1, true],
    [-1.01, false],
    [1.2, false],
  ])('offset %d → in zone %s', (maturityOffsetYears, inZone) => {
    const r = peakHeightVelocityZone({ maturityOffsetYears });
    expect(r.inZone).toBe(inZone);
    expect(r.evaluable).toBe(true);
    expect(r.offset).toBe(inZone ? 'met' : 'not_met');
    expect(r.growthVelocity).toBe('disabled');
  });

  it('is not evaluable without data', () => {
    expect(peakHeightVelocityZone({})).toEqual({
      inZone: false,
      evaluable: false,
      offset: 'unknown',
      growthVelocity: 'disabled',
    });
    expect(peakHeightVelocityZone({ maturityOffsetYears: null }).evaluable).toBe(false);
  });

  it('is in zone if any configured criterion is met', () => {
    const params = { minGrowthVelocityCmYear: 7 };
    expect(
      peakHeightVelocityZone({ maturityOffsetYears: -1.8, growthVelocityCmYear: 7.5 }, params),
    ).toEqual({
      inZone: true,
      evaluable: true,
      offset: 'not_met',
      growthVelocity: 'met',
    });
    expect(peakHeightVelocityZone({ growthVelocityCmYear: 6.9 }, params)).toEqual({
      inZone: false,
      evaluable: true,
      offset: 'unknown',
      growthVelocity: 'not_met',
    });
    expect(
      peakHeightVelocityZone({ maturityOffsetYears: 0 }, { ...params, offsetWindowYears: null }),
    ).toEqual({ inZone: false, evaluable: false, offset: 'disabled', growthVelocity: 'unknown' });
  });

  it('rejects invalid parameters and inputs', () => {
    expect(() =>
      peakHeightVelocityZone({}, { offsetWindowYears: { minYears: 1, maxYears: -1 } }),
    ).toThrow(DomainValidationError);
    expect(() => peakHeightVelocityZone({}, { minGrowthVelocityCmYear: Number.NaN })).toThrow(
      DomainValidationError,
    );
    expect(() => peakHeightVelocityZone({ maturityOffsetYears: Number.NaN })).toThrow(
      DomainValidationError,
    );
  });
});
