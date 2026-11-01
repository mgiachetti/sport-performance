import type { UnitCode } from '@sport-performance/domain';

/**
 * Message key of the label shown next to a value in a unit (`unit.years`).
 * One key per `UnitCode`, so adding a unit to the domain catalog fails to
 * compile here until it has a label.
 */
export type UnitMessageKey = `unit.${UnitCode}`;

export function unitMessageKey(code: UnitCode): UnitMessageKey {
  return `unit.${code}`;
}

/**
 * es-AR unit labels. SI symbols stay as they are (`m/s`, `km/h`, `N`); units
 * without an international symbol get their rioplatense wording. Counts and
 * scores have no label (empty string): the value is shown alone.
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

/** es-AR label of a unit, as shown next to a value. */
export function unitLabelEsAr(code: UnitCode): string {
  return UNIT_MESSAGES_ES_AR[unitMessageKey(code)];
}
