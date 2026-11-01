import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  KHAMIS_ROCHE_1994_TABLE,
  SEXES,
  assertValidKhamisRocheTable,
  khamisRocheAgeRangeYears,
  khamisRocheCoefficients,
  khamisRocheSupportsAge,
  predictAdultHeight,
  type KhamisRocheTable,
} from '../index.js';

// Control cases published with the vilda-calc reproduction (erratum values):
// boy 10.0 y, 138 cm, 32 kg, parents 163/178 cm → 177.2 cm;
// girl 12.0 y, 150 cm, 42 kg, parents 165/179 cm → 165.4 cm.
// The worked example of the original article (p. 507) could not be retrieved.

describe('predictAdultHeight (Khamis-Roche)', () => {
  it('reproduces the boys control case', () => {
    const r = predictAdultHeight({
      sex: 'male',
      ageYears: 10,
      heightCm: 138,
      weightKg: 32,
      motherHeightCm: 163,
      fatherHeightCm: 178,
    });
    expect(r.predictedAdultHeightCm).toBeCloseTo(177.1595756, 6);
    expect(r.predictedAdultHeightCm.toFixed(1)).toBe('177.2');
    expect(r.adultHeightPct).toBeCloseTo((138 / 177.1595756) * 100, 5);
    expect(r.remainingGrowthCm).toBeCloseTo(39.1595756, 6);
    expect(r.midparentHeightCm).toBe(170.5);
    expect(r.predictionBelowCurrentHeight).toBe(false);
    expect(r.tableCode).toBe('khamis_roche_1994');
  });

  it('reproduces the girls control case', () => {
    const r = predictAdultHeight({
      sex: 'female',
      ageYears: 12,
      heightCm: 150,
      weightKg: 42,
      motherHeightCm: 165,
      fatherHeightCm: 179,
    });
    expect(r.predictedAdultHeightCm).toBeCloseTo(165.3935144, 6);
    expect(r.predictedAdultHeightCm.toFixed(1)).toBe('165.4');
  });

  const boy13 = {
    sex: 'male',
    heightCm: 160,
    weightKg: 48,
    motherHeightCm: 165,
    fatherHeightCm: 180,
  } as const;

  it('interpolates linearly between half-year rows by default', () => {
    expect(predictAdultHeight({ ...boy13, ageYears: 13 }).predictedAdultHeightCm).toBeCloseTo(
      181.2535434,
      6,
    );
    expect(predictAdultHeight({ ...boy13, ageYears: 13.5 }).predictedAdultHeightCm).toBeCloseTo(
      179.1794461,
      6,
    );
    expect(predictAdultHeight({ ...boy13, ageYears: 13.25 }).predictedAdultHeightCm).toBeCloseTo(
      180.2164947,
      6,
    );
  });

  it('can use the nearest row instead (ties go to the older row)', () => {
    const nearest = (ageYears: number): number =>
      predictAdultHeight({ ...boy13, ageYears }, { ageMode: 'nearest_row' }).predictedAdultHeightCm;
    expect(nearest(13.2)).toBeCloseTo(181.2535434, 6);
    expect(nearest(13.25)).toBeCloseTo(179.1794461, 6);
    expect(nearest(13.4)).toBeCloseTo(179.1794461, 6);
  });

  it('flags, without clamping, a prediction below the current height', () => {
    const r = predictAdultHeight({
      sex: 'male',
      ageYears: 17.5,
      heightCm: 185,
      weightKg: 80,
      motherHeightCm: 160,
      fatherHeightCm: 170,
    });
    expect(r.predictedAdultHeightCm).toBeCloseTo(184.5791012, 6);
    expect(r.predictionBelowCurrentHeight).toBe(true);
    expect(r.adultHeightPct).toBeGreaterThan(100);
    expect(r.remainingGrowthCm).toBeLessThan(0);
  });

  it.each([3.99, 17.51, Number.NaN])('rejects age %d outside the table', (ageYears) => {
    expect(() => predictAdultHeight({ ...boy13, ageYears })).toThrow(DomainValidationError);
  });

  it.each([
    { heightCm: 0 },
    { weightKg: -1 },
    { motherHeightCm: Number.NaN },
    { fatherHeightCm: 0 },
  ])('rejects invalid input %o', (patch) => {
    expect(() => predictAdultHeight({ ...boy13, ageYears: 13, ...patch })).toThrow(
      DomainValidationError,
    );
  });
});

describe('khamisRocheCoefficients', () => {
  it('returns the table row at a tabulated age', () => {
    expect(khamisRocheCoefficients('female', 4)).toEqual({
      ageYears: 4,
      interceptIn: -8.1325,
      heightInCoef: 1.24768,
      weightLbCoef: -0.19435,
      midparentHeightInCoef: 0.44774,
    });
    expect(khamisRocheCoefficients('male', 17.5).midparentHeightInCoef).toBe(-0.0095);
  });
});

describe('KHAMIS_ROCHE_1994_TABLE', () => {
  it('covers 4.0 to 17.5 years in half years for both sexes', () => {
    const ages = Array.from({ length: 28 }, (_, i) => 4 + i / 2);
    for (const sex of SEXES) {
      expect(KHAMIS_ROCHE_1994_TABLE.rows[sex].map((r) => r.ageYears)).toEqual(ages);
      expect(khamisRocheAgeRangeYears(sex)).toEqual({ minYears: 4, maxYears: 17.5 });
      expect(khamisRocheSupportsAge(sex, 4)).toBe(true);
      expect(khamisRocheSupportsAge(sex, 18)).toBe(false);
    }
  });

  it('uses the erratum weight coefficients (not the 1994 printing, ten times smaller)', () => {
    expect(khamisRocheCoefficients('male', 10).weightLbCoef).toBe(-0.039981);
    expect(khamisRocheCoefficients('female', 12).weightLbCoef).toBe(-0.04894);
  });

  it('is not marked as verified against the publication yet', () => {
    expect(KHAMIS_ROCHE_1994_TABLE.provenance.verification).toBe('cross_checked_secondary_sources');
    expect(KHAMIS_ROCHE_1994_TABLE.provenance.errata).toHaveLength(1);
  });
});

describe('assertValidKhamisRocheTable', () => {
  const base = KHAMIS_ROCHE_1994_TABLE;
  const row = {
    ageYears: 10,
    interceptIn: 0,
    heightInCoef: 1,
    weightLbCoef: 0,
    midparentHeightInCoef: 0,
  };

  it('accepts a custom table loaded as data', () => {
    const table: KhamisRocheTable = {
      ...base,
      code: 'custom',
      rows: { male: [row], female: [row] },
    };
    expect(() => {
      assertValidKhamisRocheTable(table);
    }).not.toThrow();
    const r = predictAdultHeight(
      {
        sex: 'male',
        ageYears: 10,
        heightCm: 140,
        weightKg: 30,
        motherHeightCm: 160,
        fatherHeightCm: 175,
      },
      { table },
    );
    expect(r.predictedAdultHeightCm).toBeCloseTo(140, 9);
    expect(r.tableCode).toBe('custom');
  });

  it.each<[string, KhamisRocheTable['rows']]>([
    ['empty sex', { male: [row], female: [] }],
    ['unsorted ages', { male: [row, { ...row, ageYears: 9 }], female: [row] }],
    ['duplicate ages', { male: [row, row], female: [row] }],
    ['non-finite value', { male: [{ ...row, weightLbCoef: Number.NaN }], female: [row] }],
  ])('rejects %s', (_, rows) => {
    expect(() => {
      assertValidKhamisRocheTable({ ...base, code: 'bad', rows });
    }).toThrow(DomainValidationError);
  });
});
