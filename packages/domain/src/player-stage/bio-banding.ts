import { isWellFormedCode } from '../codes.js';
import { DomainValidationError, describeValue } from '../errors.js';
import { memberGuard, memberParser } from '../enum.js';

/**
 * Maturity indicator a bio-banding scheme groups by: years from PHV
 * (Mirwald 2002 / Moore 2015) or percentage of predicted adult height
 * (Khamis-Roche 1994), both from B-203.
 */
export const BIO_BAND_INDICATORS = ['phv_offset_years', 'pct_adult_height'] as const;
export type BioBandIndicator = (typeof BIO_BAND_INDICATORS)[number];

export const isBioBandIndicator = memberGuard(BIO_BAND_INDICATORS);
export const parseBioBandIndicator = memberParser(
  BIO_BAND_INDICATORS,
  'invalid_argument',
  'bio-band indicator',
);

/**
 * One band: values in `[minInclusive, maxExclusive)`. The first band has no
 * `minInclusive` and the last no `maxExclusive`, so every value has a band.
 */
export interface BioBand {
  /** English `snake_case` code (`circa_phv`); UI labels live in `packages/i18n`. */
  readonly code: string;
  readonly minInclusive?: number;
  readonly maxExclusive?: number;
}

/** A bio-banding scheme: bands ordered from least to most mature. */
export interface BioBandScheme {
  /** English `snake_case` code of the scheme. */
  readonly code: string;
  readonly indicator: BioBandIndicator;
  readonly bands: readonly BioBand[];
}

/**
 * Default scheme by years from PHV: pre-PHV (< −1), circa-PHV (−1 to < +1)
 * and post-PHV (≥ +1), the usual split in youth athletic development
 * (Lloyd & Oliver; Moore et al. 2015).
 */
export const DEFAULT_PHV_OFFSET_BIO_BANDING = {
  code: 'phv_offset',
  indicator: 'phv_offset_years',
  bands: [
    { code: 'pre_phv', maxExclusive: -1 },
    { code: 'circa_phv', minInclusive: -1, maxExclusive: 1 },
    { code: 'post_phv', minInclusive: 1 },
  ],
} as const satisfies BioBandScheme;

/**
 * Default scheme by % of predicted adult height (Cumming et al. 2017, the
 * Premier League bio-banding bands): pre-pubertal (< 85), early pubertal
 * (85–< 90), mid pubertal (90–< 95) and late pubertal (≥ 95).
 */
export const DEFAULT_PCT_ADULT_HEIGHT_BIO_BANDING = {
  code: 'pct_adult_height',
  indicator: 'pct_adult_height',
  bands: [
    { code: 'pre_pubertal', maxExclusive: 85 },
    { code: 'early_pubertal', minInclusive: 85, maxExclusive: 90 },
    { code: 'mid_pubertal', minInclusive: 90, maxExclusive: 95 },
    { code: 'late_pubertal', minInclusive: 95 },
  ],
} as const satisfies BioBandScheme;

export const DEFAULT_BIO_BANDING_SCHEMES = [
  DEFAULT_PHV_OFFSET_BIO_BANDING,
  DEFAULT_PCT_ADULT_HEIGHT_BIO_BANDING,
] as const satisfies readonly BioBandScheme[];

/**
 * Validates a scheme and returns it unchanged: well-formed unique codes, at
 * least one band, open first and last bands, and contiguous finite
 * boundaries in increasing order (no gaps, no overlaps). Throws
 * {@link DomainValidationError} (`invalid_argument`).
 */
export function parseBioBandScheme<S extends BioBandScheme>(scheme: S): S {
  if (!isWellFormedCode(scheme.code)) {
    throw invalid(
      `Bio-band scheme code ${describeValue(scheme.code)} is not a snake_case code.`,
      scheme,
    );
  }
  parseBioBandIndicator(scheme.indicator);
  const { bands } = scheme;
  if (bands.length === 0) throw invalid(`Bio-band scheme "${scheme.code}" has no bands.`, scheme);
  const codes = new Set<string>();
  bands.forEach((band, index) => {
    if (!isWellFormedCode(band.code)) {
      throw invalid(`Bio-band code ${describeValue(band.code)} is not a snake_case code.`, scheme);
    }
    if (codes.has(band.code)) throw invalid(`Duplicate bio-band code "${band.code}".`, scheme);
    codes.add(band.code);

    const isFirst = index === 0;
    const isLast = index === bands.length - 1;
    if (isFirst !== (band.minInclusive === undefined)) {
      throw invalid(`Bio-band "${band.code}": only the first band has no minInclusive.`, scheme);
    }
    if (isLast !== (band.maxExclusive === undefined)) {
      throw invalid(`Bio-band "${band.code}": only the last band has no maxExclusive.`, scheme);
    }
    for (const bound of [band.minInclusive, band.maxExclusive]) {
      if (bound !== undefined && !Number.isFinite(bound)) {
        throw invalid(`Bio-band "${band.code}" has a non-finite boundary.`, scheme);
      }
    }
    if (
      band.minInclusive !== undefined &&
      band.maxExclusive !== undefined &&
      band.maxExclusive <= band.minInclusive
    ) {
      throw invalid(`Bio-band "${band.code}" is empty or reversed.`, scheme);
    }
    const previous = isFirst ? undefined : bands[index - 1];
    if (previous !== undefined && previous.maxExclusive !== band.minInclusive) {
      throw invalid(`Bio-bands "${previous.code}" and "${band.code}" are not contiguous.`, scheme);
    }
  });
  return scheme;
}

/**
 * Band of a maturity value in a scheme. Validates the scheme on every call;
 * to band a whole squad use {@link createBioBandLookup} or
 * {@link groupByBioBand}, which validate it once. Throws for non-finite
 * values; the caller decides what a missing value means (see
 * {@link groupByBioBand}).
 */
export function bioBandFor<B extends BioBand>(
  value: number,
  scheme: {
    readonly code: string;
    readonly indicator: BioBandIndicator;
    readonly bands: readonly B[];
  },
): B {
  parseBioBandScheme(scheme);
  return findBand(value, scheme.bands);
}

/**
 * Validates a scheme once and returns a lookup from value to band that does
 * not re-validate the scheme. The lookup throws for non-finite values, like
 * {@link bioBandFor}.
 */
export function createBioBandLookup<B extends BioBand>(scheme: {
  readonly code: string;
  readonly indicator: BioBandIndicator;
  readonly bands: readonly B[];
}): (value: number) => B {
  parseBioBandScheme(scheme);
  const { bands } = scheme;
  return (value) => findBand(value, bands);
}

function findBand<B extends BioBand>(value: number, bands: readonly B[]): B {
  if (!Number.isFinite(value)) {
    throw invalid(`Bio-banding value must be a finite number, got ${describeValue(value)}.`, value);
  }
  const band = bands.find(
    (b) =>
      (b.minInclusive === undefined || value >= b.minInclusive) &&
      (b.maxExclusive === undefined || value < b.maxExclusive),
  );
  // Unreachable for a valid scheme: its bands cover the whole real line.
  if (band === undefined) throw invalid(`No bio-band for ${String(value)}.`, value);
  return band;
}

export interface BioBandGroup<T, B extends BioBand = BioBand> {
  readonly band: B;
  readonly items: readonly T[];
}

export interface BioBandGrouping<T, B extends BioBand = BioBand> {
  /** One group per band, in scheme order (least to most mature), empty ones included. */
  readonly groups: readonly BioBandGroup<T, B>[];
  /** Items without a value for the scheme's indicator. */
  readonly unbanded: readonly T[];
}

/**
 * Bio-banding: groups players by maturity instead of chronological age.
 * `getValue` returns the scheme's indicator for an item (`undefined` or
 * `null` when it is not available). Input order is kept within each group.
 * The scheme is validated once per call.
 *
 * Only `undefined` and `null` mean "no data" and go to `unbanded`. Any other
 * non-finite value (`NaN`, `±Infinity`) is a bug upstream, not a missing
 * measurement: it throws {@link DomainValidationError} (`invalid_argument`)
 * and aborts the whole grouping. Map such values to `undefined` in
 * `getValue` if they should be treated as missing.
 */
export function groupByBioBand<T, B extends BioBand>(
  items: readonly T[],
  scheme: {
    readonly code: string;
    readonly indicator: BioBandIndicator;
    readonly bands: readonly B[];
  },
  getValue: (item: T) => number | null | undefined,
): BioBandGrouping<T, B> {
  parseBioBandScheme(scheme);
  const buckets = new Map<string, T[]>(scheme.bands.map((b) => [b.code, []]));
  const unbanded: T[] = [];
  for (const item of items) {
    const value = getValue(item);
    if (value === undefined || value === null) {
      unbanded.push(item);
      continue;
    }
    buckets.get(findBand(value, scheme.bands).code)?.push(item);
  }
  return {
    groups: scheme.bands.map((band) => ({ band, items: buckets.get(band.code) ?? [] })),
    unbanded,
  };
}

function invalid(message: string, value: unknown): DomainValidationError {
  return new DomainValidationError('invalid_argument', message, value);
}
