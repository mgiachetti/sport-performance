import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BIO_BANDING_SCHEMES,
  DEFAULT_PCT_ADULT_HEIGHT_BIO_BANDING,
  DEFAULT_PHV_OFFSET_BIO_BANDING,
  DomainValidationError,
  bioBandFor,
  groupByBioBand,
  isBioBandIndicator,
  parseBioBandIndicator,
  parseBioBandScheme,
  type BioBandScheme,
} from '../index.js';

describe('default schemes', () => {
  it.each(DEFAULT_BIO_BANDING_SCHEMES.map((s) => [s.code, s] as const))('%s is valid', (_, s) => {
    expect(parseBioBandScheme(s)).toBe(s);
  });

  it.each([
    [-3, 'pre_phv'],
    [-1.01, 'pre_phv'],
    [-1, 'circa_phv'],
    [0, 'circa_phv'],
    [0.99, 'circa_phv'],
    [1, 'post_phv'],
    [4, 'post_phv'],
  ] as const)('PHV offset %d → %s', (value, code) => {
    expect(bioBandFor(value, DEFAULT_PHV_OFFSET_BIO_BANDING).code).toBe(code);
  });

  it.each([
    [80, 'pre_pubertal'],
    [84.99, 'pre_pubertal'],
    [85, 'early_pubertal'],
    [89.99, 'early_pubertal'],
    [90, 'mid_pubertal'],
    [95, 'late_pubertal'],
    [100, 'late_pubertal'],
  ] as const)('%d %% of adult height → %s', (value, code) => {
    expect(bioBandFor(value, DEFAULT_PCT_ADULT_HEIGHT_BIO_BANDING).code).toBe(code);
  });
});

describe('bioBandFor', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY])('rejects %d', (value) => {
    expect(() => bioBandFor(value, DEFAULT_PHV_OFFSET_BIO_BANDING)).toThrow(DomainValidationError);
  });

  it('accepts a single open band', () => {
    const scheme: BioBandScheme = {
      code: 'all',
      indicator: 'phv_offset_years',
      bands: [{ code: 'everyone' }],
    };
    expect(bioBandFor(42, scheme).code).toBe('everyone');
  });
});

describe('parseBioBandScheme', () => {
  const base = DEFAULT_PHV_OFFSET_BIO_BANDING;
  it.each<[string, BioBandScheme]>([
    ['bad scheme code', { ...base, code: 'Phv Offset' }],
    ['bad indicator', { ...base, indicator: 'age' as never }],
    ['no bands', { ...base, bands: [] }],
    ['bad band code', { ...base, bands: [{ code: 'Pre' }] }],
    [
      'duplicate codes',
      {
        ...base,
        bands: [
          { code: 'a', maxExclusive: 0 },
          { code: 'a', minInclusive: 0 },
        ],
      },
    ],
    [
      'closed first band',
      {
        ...base,
        bands: [
          { code: 'a', minInclusive: -5, maxExclusive: 0 },
          { code: 'b', minInclusive: 0 },
        ],
      },
    ],
    [
      'closed last band',
      {
        ...base,
        bands: [
          { code: 'a', maxExclusive: 0 },
          { code: 'b', minInclusive: 0, maxExclusive: 5 },
        ],
      },
    ],
    [
      'open middle band',
      {
        ...base,
        bands: [{ code: 'a', maxExclusive: 0 }, { code: 'b' }, { code: 'c', minInclusive: 1 }],
      },
    ],
    [
      'gap',
      {
        ...base,
        bands: [
          { code: 'a', maxExclusive: 0 },
          { code: 'b', minInclusive: 1 },
        ],
      },
    ],
    [
      'overlap',
      {
        ...base,
        bands: [
          { code: 'a', maxExclusive: 1 },
          { code: 'b', minInclusive: 0 },
        ],
      },
    ],
    [
      'empty band',
      {
        ...base,
        bands: [
          { code: 'a', maxExclusive: 0 },
          { code: 'b', minInclusive: 0, maxExclusive: 0 },
          { code: 'c', minInclusive: 0 },
        ],
      },
    ],
    [
      'non-finite boundary',
      {
        ...base,
        bands: [
          { code: 'a', maxExclusive: Number.NaN },
          { code: 'b', minInclusive: Number.NaN },
        ],
      },
    ],
  ])('rejects %s', (_, scheme) => {
    expect(() => parseBioBandScheme(scheme)).toThrow(DomainValidationError);
  });
});

describe('indicators', () => {
  it('guards and parses', () => {
    expect(isBioBandIndicator('phv_offset_years')).toBe(true);
    expect(isBioBandIndicator('age')).toBe(false);
    expect(parseBioBandIndicator('pct_adult_height')).toBe('pct_adult_height');
    expect(() => parseBioBandIndicator('age')).toThrow(DomainValidationError);
  });
});

describe('groupByBioBand', () => {
  const players = [
    { id: 'a', phvOffsetYears: -1.5 },
    { id: 'b', phvOffsetYears: 0.2 },
    { id: 'c', phvOffsetYears: undefined },
    { id: 'd', phvOffsetYears: -0.4 },
    { id: 'e', phvOffsetYears: null },
  ];

  it('groups in scheme order, keeping input order and empty bands', () => {
    const { groups, unbanded } = groupByBioBand(
      players,
      DEFAULT_PHV_OFFSET_BIO_BANDING,
      (p) => p.phvOffsetYears,
    );
    expect(groups.map((g) => [g.band.code, g.items.map((p) => p.id)])).toEqual([
      ['pre_phv', ['a']],
      ['circa_phv', ['b', 'd']],
      ['post_phv', []],
    ]);
    expect(unbanded.map((p) => p.id)).toEqual(['c', 'e']);
  });

  it('handles no players', () => {
    const { groups, unbanded } = groupByBioBand([], DEFAULT_PHV_OFFSET_BIO_BANDING, () => 0);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.items.length === 0)).toBe(true);
    expect(unbanded).toEqual([]);
  });

  it('rejects a non-finite value and an invalid scheme', () => {
    expect(() => groupByBioBand([1], DEFAULT_PHV_OFFSET_BIO_BANDING, () => Number.NaN)).toThrow(
      DomainValidationError,
    );
    expect(() =>
      groupByBioBand([1], { ...DEFAULT_PHV_OFFSET_BIO_BANDING, bands: [] }, () => 0),
    ).toThrow(DomainValidationError);
  });
});
