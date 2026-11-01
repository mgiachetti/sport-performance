import { DEFAULT_LOCALE, type Locale } from '../locale.js';

/** Shown instead of a value that is missing or not a finite number (for example ACWR 0/0). */
export const PLACEHOLDER = '—';

/** No-break space between a number and its unit, so they never wrap apart. */
export const NBSP = String.fromCharCode(0xa0);

export interface NumberFormatOptions {
  readonly locale?: Locale;
  /** Exact number of decimals (sets both minimum and maximum). */
  readonly decimals?: number;
  /** Minimum decimals when `decimals` is not set. Default 0. */
  readonly minDecimals?: number;
  /** Maximum decimals when `decimals` is not set. Default 2. */
  readonly maxDecimals?: number;
  /** `always` prefixes positives with `+` (for deltas); zero never gets a sign. Default `auto`. */
  readonly sign?: 'auto' | 'always';
  /** Thousands separator. Default `true` (`1.234`). */
  readonly grouping?: boolean;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function getNumberFormat(
  locale: Locale,
  minDecimals: number,
  maxDecimals: number,
  grouping: boolean,
): Intl.NumberFormat {
  const cacheKey = `${locale}|${String(minDecimals)}|${String(maxDecimals)}|${String(grouping)}`;
  let format = numberFormats.get(cacheKey);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
      useGrouping: grouping,
    });
    numberFormats.set(cacheKey, format);
  }
  return format;
}

function checkDecimals(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 20) {
    throw new RangeError(`${name} must be an integer between 0 and 20, got ${String(value)}`);
  }
  return value;
}

/**
 * Formats a number in es-AR: decimal comma and dot thousands separator (`1.234,5`).
 *
 * Never renders `-0`: values that round to zero lose their sign. Returns {@link PLACEHOLDER} for
 * `null`, `undefined`, `NaN` and infinities.
 */
export function formatNumber(
  value: number | null | undefined,
  options: NumberFormatOptions = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return PLACEHOLDER;

  const locale = options.locale ?? DEFAULT_LOCALE;
  const minDecimals = checkDecimals('minDecimals', options.decimals ?? options.minDecimals ?? 0);
  const maxDecimals = checkDecimals(
    'maxDecimals',
    options.decimals ?? options.maxDecimals ?? Math.max(2, minDecimals),
  );
  if (minDecimals > maxDecimals) {
    throw new RangeError(
      `minDecimals (${String(minDecimals)}) is greater than maxDecimals (${String(maxDecimals)})`,
    );
  }

  const magnitude = getNumberFormat(
    locale,
    minDecimals,
    maxDecimals,
    options.grouping ?? true,
  ).format(Math.abs(value));
  const isZero = !/[1-9]/.test(magnitude);
  if (isZero) return magnitude;
  if (value < 0) return `-${magnitude}`;
  return options.sign === 'always' ? `+${magnitude}` : magnitude;
}

/** Decimal and grouping separators of a locale, as `Intl` renders them. */
export function getSeparators(locale: Locale = DEFAULT_LOCALE): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(12345.6);
  return {
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? ',',
    group: parts.find((part) => part.type === 'group')?.value ?? '.',
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ParseNumberOptions {
  readonly locale?: Locale;
  /** Accept thousands separators (`1.234,5`). Default `true`; turn off for short measures. */
  readonly allowGrouping?: boolean;
}

/**
 * Parses a number typed by a user in es-AR format: `1,85`, `-0,5`, `1.234,5`, `1234`.
 *
 * Strict on purpose: returns `null` instead of guessing. A dot is never a decimal separator in
 * es-AR, so `1.85` (wrong grouping) is rejected rather than read as 1,85 or 185. Grouping must be
 * well formed (groups of three digits). Surrounding spaces and a leading `+`, `-` or `−` are
 * accepted. Range checks belong to the caller (domain validation).
 */
export function parseNumber(input: string, options: ParseNumberOptions = {}): number | null {
  const { decimal, group } = getSeparators(options.locale ?? DEFAULT_LOCALE);
  const allowGrouping = options.allowGrouping ?? true;
  const text = input.trim().replace(/−/g, '-');

  const d = escapeRegExp(decimal);
  const g = escapeRegExp(group);
  const integer = allowGrouping ? `(?:\\d{1,3}(?:${g}\\d{3})+|\\d+)` : '\\d+';
  const pattern = new RegExp(`^([+-])?(${integer})?(?:${d}(\\d+))?$`);
  const match = pattern.exec(text);
  if (match === null) return null;

  const [, signPart, integerPart, fractionPart] = match;
  if (integerPart === undefined && fractionPart === undefined) return null;

  const normalized = `${signPart === '-' ? '-' : ''}${(integerPart ?? '0').split(group).join('')}.${fractionPart ?? '0'}`;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return value === 0 ? 0 : value;
}
