import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGE_BANDS,
  DomainValidationError,
  ageBandForBirthYear,
  ageInSeasonYear,
  isStage,
  type AgeBand,
} from './index.js';

describe('ageInSeasonYear', () => {
  it('is the age reached during the season year', () => {
    expect(ageInSeasonYear(2011, 2026)).toBe(15);
  });

  it.each([2011.5, Number.NaN, 0, 10000])('rejects invalid year %d', (year) => {
    expect(() => ageInSeasonYear(year, 2026)).toThrow(DomainValidationError);
    expect(() => ageInSeasonYear(2011, year)).toThrow(DomainValidationError);
  });
});

describe('DEFAULT_AGE_BANDS', () => {
  it('lists M13 to M19 without M18', () => {
    expect(DEFAULT_AGE_BANDS.map((b) => b.label)).toEqual([
      'M13',
      'M14',
      'M15',
      'M16',
      'M17',
      'M19',
    ]);
  });

  it('covers ages 13 to 19 contiguously without overlaps', () => {
    let expectedMin = 13;
    for (const band of DEFAULT_AGE_BANDS) {
      expect(band.minAgeInSeasonYear).toBe(expectedMin);
      expect(band.maxAgeInSeasonYear).toBeGreaterThanOrEqual(band.minAgeInSeasonYear);
      expectedMin = band.maxAgeInSeasonYear + 1;
    }
    expect(expectedMin).toBe(20);
  });

  it('maps bands to the stage table and the percentile and named-rankings rules', () => {
    const byCode = Object.fromEntries(DEFAULT_AGE_BANDS.map((b) => [b.code, b]));
    expect(byCode.m13?.defaultStage).toBe('foundation');
    expect(byCode.m14?.defaultStage).toBe('foundation');
    expect(byCode.m15?.defaultStage).toBe('development');
    expect(byCode.m16?.defaultStage).toBe('development');
    expect(byCode.m17?.defaultStage).toBe('performance');
    expect(byCode.m19?.defaultStage).toBe('performance');
    for (const band of DEFAULT_AGE_BANDS) {
      expect(isStage(band.defaultStage)).toBe(true);
      expect(band.ownPercentilesForPlayers).toBe(band.minAgeInSeasonYear >= 15);
      expect(band.namedRankingsForPlayers).toBe(band.minAgeInSeasonYear >= 17);
      expect(band.code).toBe(band.label.toLowerCase());
    }
  });
});

describe('ageBandForBirthYear', () => {
  it.each([
    [2013, 'm13'],
    [2012, 'm14'],
    [2011, 'm15'],
    [2010, 'm16'],
    [2009, 'm17'],
    [2008, 'm19'],
    [2007, 'm19'],
  ])('born %d plays %s in 2026', (birthYear, code) => {
    expect(ageBandForBirthYear(birthYear, 2026, DEFAULT_AGE_BANDS)?.code).toBe(code);
  });

  it('returns undefined outside the youth bands', () => {
    expect(ageBandForBirthYear(2014, 2026, DEFAULT_AGE_BANDS)).toBeUndefined();
    expect(ageBandForBirthYear(2006, 2026, DEFAULT_AGE_BANDS)).toBeUndefined();
  });

  it('works with club-specific bands and keeps their type', () => {
    interface ClubBand extends AgeBand {
      readonly clubName: string;
    }
    const bands: ClubBand[] = [
      {
        code: 'sub_14',
        label: 'Sub 14',
        clubName: 'Quinta',
        minAgeInSeasonYear: 13,
        maxAgeInSeasonYear: 14,
        defaultStage: 'foundation',
        ownPercentilesForPlayers: false,
        namedRankingsForPlayers: false,
      },
    ];
    expect(ageBandForBirthYear(2012, 2026, bands)?.clubName).toBe('Quinta');
  });
});
