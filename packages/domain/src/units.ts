import { memberGuard, memberParser } from './enum.js';
import { DomainValidationError } from './errors.js';

/**
 * Unit catalog. A unit's `code` is exactly the suffix used in metric codes
 * (`height_cm`, `vmax_ms`) and, in camelCase, in identifiers (`heightCm`,
 * `speedMs`). Two suffixes are reserved to avoid ambiguity:
 *
 * - `ms` always means metres per second; milliseconds are `msec`.
 * - `n` always means a count; newtons are `newton`.
 *
 * Values are stored and computed in these units. Nothing here is UI text:
 * `symbol` is the locale-independent international symbol, or `null` when the
 * unit has none (years, cm per year, beats per minute, arbitrary units, scores,
 * counts). What the user sees next to a value, and its es-AR formatting
 * (decimal comma), lives in `packages/i18n`, keyed by {@link UnitCode}.
 */
export const UNITS = {
  mm: { code: 'mm', symbol: 'mm', dimension: 'length' },
  cm: { code: 'cm', symbol: 'cm', dimension: 'length' },
  m: { code: 'm', symbol: 'm', dimension: 'length' },
  km: { code: 'km', symbol: 'km', dimension: 'length' },
  kg: { code: 'kg', symbol: 'kg', dimension: 'mass' },
  msec: { code: 'msec', symbol: 'ms', dimension: 'time' },
  s: { code: 's', symbol: 's', dimension: 'time' },
  min: { code: 'min', symbol: 'min', dimension: 'time' },
  h: { code: 'h', symbol: 'h', dimension: 'time' },
  years: { code: 'years', symbol: null, dimension: 'time' },
  ms: { code: 'ms', symbol: 'm/s', dimension: 'speed' },
  kmh: { code: 'kmh', symbol: 'km/h', dimension: 'speed' },
  m_min: { code: 'm_min', symbol: 'm/min', dimension: 'speed' },
  cm_year: { code: 'cm_year', symbol: null, dimension: 'growth_rate' },
  ms2: { code: 'ms2', symbol: 'm/s²', dimension: 'acceleration' },
  newton: { code: 'newton', symbol: 'N', dimension: 'force' },
  deg: { code: 'deg', symbol: '°', dimension: 'angle' },
  bpm: { code: 'bpm', symbol: null, dimension: 'frequency' },
  kg_kg: { code: 'kg_kg', symbol: 'kg/kg', dimension: 'ratio' },
  pct: { code: 'pct', symbol: '%', dimension: 'ratio' },
  au: { code: 'au', symbol: null, dimension: 'arbitrary' },
  score: { code: 'score', symbol: null, dimension: 'arbitrary' },
  n: { code: 'n', symbol: null, dimension: 'count' },
} as const satisfies Readonly<Record<string, UnitDefinition>>;

export type UnitCode = keyof typeof UNITS;

export type UnitDimension =
  | 'length'
  | 'mass'
  | 'time'
  | 'speed'
  | 'growth_rate'
  | 'acceleration'
  | 'force'
  | 'angle'
  | 'frequency'
  | 'ratio'
  | 'arbitrary'
  | 'count';

export interface UnitDefinition {
  readonly code: string;
  /**
   * International (SI or SI-accepted) symbol, identical in every locale
   * (`m/s`, `km/h`, `N`, `%`). `null` when there is none: the label comes
   * from `packages/i18n`.
   */
  readonly symbol: string | null;
  readonly dimension: UnitDimension;
}

export const UNIT_CODES = Object.keys(UNITS) as UnitCode[];

export const isUnitCode = memberGuard(UNIT_CODES);
export const parseUnitCode = memberParser(UNIT_CODES, 'invalid_unit', 'unit');

/** Standard gravity, m/s². Used by the CMJ flight-time formula. */
export const STANDARD_GRAVITY_MS2 = 9.81;

const SECONDS_PER_HOUR = 3600;
const METRES_PER_KM = 1000;

export function kmhToMs(speedKmh: number): number {
  return (speedKmh * METRES_PER_KM) / SECONDS_PER_HOUR;
}

export function msToKmh(speedMs: number): number {
  return (speedMs * SECONDS_PER_HOUR) / METRES_PER_KM;
}

export function secondsToMsec(timeS: number): number {
  return timeS * 1000;
}

export function msecToSeconds(timeMsec: number): number {
  return timeMsec / 1000;
}

export function minutesToSeconds(timeMin: number): number {
  return timeMin * 60;
}

export function secondsToMinutes(timeS: number): number {
  return timeS / 60;
}

export function cmToM(lengthCm: number): number {
  return lengthCm / 100;
}

export function mToCm(lengthM: number): number {
  return lengthM * 100;
}

/** `part / whole × 100`. Throws on a zero whole instead of returning Infinity. */
export function ratioToPct(part: number, whole: number): number {
  if (whole === 0) {
    throw new DomainValidationError('invalid_argument', 'ratioToPct: whole must not be 0.', whole);
  }
  return (part / whole) * 100;
}
