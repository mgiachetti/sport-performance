import type { UnitCode } from '@sport-performance/domain';
import { NBSP, type NumberFormatOptions, PLACEHOLDER, formatNumber } from './number.js';

/**
 * Message key of the label shown next to a value in a unit (`unit.years`).
 * One key per domain `UnitCode`, so adding a unit to the domain catalog fails
 * to compile here until it has a label.
 */
export type UnitMessageKey = `unit.${UnitCode}`;

export function unitMessageKey(code: UnitCode): UnitMessageKey {
  return `unit.${code}`;
}

/**
 * es-AR unit labels. SI symbols stay as they are (`m/s`, `km/h`, `N`); units
 * without an international symbol get their rioplatense wording. Counts and
 * scores have no label (empty string): the value is shown alone.
 *
 * Kept apart from the ICU catalog on purpose: these are plain labels, not
 * messages (some are empty), and they are not overridable per club.
 */
export const UNIT_MESSAGES_ES_AR = {
  'unit.mm': 'mm',
  'unit.cm': 'cm',
  'unit.m': 'm',
  'unit.km': 'km',
  'unit.kg': 'kg',
  'unit.msec': 'ms',
  'unit.s': 's',
  'unit.min': 'min',
  'unit.h': 'h',
  'unit.years': 'años',
  'unit.ms': 'm/s',
  'unit.kmh': 'km/h',
  'unit.m_min': 'm/min',
  'unit.cm_year': 'cm/año',
  'unit.ms2': 'm/s²',
  'unit.newton': 'N',
  'unit.deg': '°',
  'unit.bpm': 'lpm',
  'unit.kg_kg': 'kg/kg',
  'unit.pct': '%',
  'unit.au': 'UA',
  'unit.score': '',
  'unit.n': '',
} as const satisfies Readonly<Record<UnitMessageKey, string>>;

/** es-AR label of a unit, as shown next to a value (`m/s`, `años`; empty for counts). */
export function unitLabelEsAr(code: UnitCode): string {
  return UNIT_MESSAGES_ES_AR[unitMessageKey(code)];
}

/**
 * Decimals shown by default for each domain unit, matching the measurement
 * resolution (sprint times to the hundredth, distances to the metre). Callers
 * can override them. Typed against every `UnitCode`, like the labels.
 */
export const UNIT_DEFAULT_DECIMALS = {
  mm: 0,
  cm: 1,
  m: 0,
  km: 2,
  kg: 1,
  msec: 0,
  s: 2,
  min: 0,
  h: 1,
  years: 1,
  ms: 2,
  kmh: 1,
  m_min: 0,
  cm_year: 1,
  ms2: 2,
  newton: 0,
  deg: 0,
  bpm: 0,
  kg_kg: 2,
  pct: 1,
  au: 0,
  score: 1,
  n: 0,
} as const satisfies Readonly<Record<UnitCode, number>>;

/** Units written right after the number, without space (SI: `12°`). */
const UNSPACED_UNITS: ReadonlySet<UnitCode> = new Set<UnitCode>(['deg']);

/**
 * Formats a measured value with its es-AR unit label: `1,85 s`, `5,20 m/s`,
 * `12,5 %`, `450 UA`. The number and the label are joined by a no-break space
 * (SI style, also for `%`), except for degrees (`12°`); units without label
 * (`n`, `score`) show the number alone.
 *
 * `pct` takes percentage points (`12.5` → `12,5 %`), not a ratio.
 * Decimals default to {@link UNIT_DEFAULT_DECIMALS} and can be overridden.
 * Missing or non-finite values render as {@link PLACEHOLDER} without unit.
 */
export function formatUnit(
  value: number | null | undefined,
  unit: UnitCode,
  options: NumberFormatOptions = {},
): string {
  const number = formatNumber(value, {
    ...(options.minDecimals === undefined && options.maxDecimals === undefined
      ? { decimals: UNIT_DEFAULT_DECIMALS[unit] }
      : {}),
    ...options,
  });
  if (number === PLACEHOLDER) return PLACEHOLDER;
  const label = unitLabelEsAr(unit);
  if (label === '') return number;
  return UNSPACED_UNITS.has(unit) ? `${number}${label}` : `${number}${NBSP}${label}`;
}
