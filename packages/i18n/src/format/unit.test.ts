import { UNITS, UNIT_CODES, type UnitCode } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { NBSP, PLACEHOLDER } from './number.js';
import {
  UNIT_DEFAULT_DECIMALS,
  UNIT_MESSAGES_ES_AR,
  formatUnit,
  unitLabelEsAr,
  unitMessageKey,
} from './unit.js';

/** Writes expectations with plain spaces; the formatter uses no-break spaces. */
const nb = (text: string): string => text.replace(/ /g, NBSP);

describe('es-AR unit labels', () => {
  it('has exactly one key per domain unit', () => {
    expect(Object.keys(UNIT_MESSAGES_ES_AR).sort()).toEqual(UNIT_CODES.map(unitMessageKey).sort());
  });

  it('uses the international symbol whenever the domain has one', () => {
    for (const code of UNIT_CODES) {
      const { symbol } = UNITS[code];
      if (symbol !== null) expect(unitLabelEsAr(code)).toBe(symbol);
    }
  });

  it('words the units without an international symbol in rioplatense Spanish', () => {
    expect(unitLabelEsAr('years')).toBe('años');
    expect(unitLabelEsAr('cm_year')).toBe('cm/año');
    expect(unitLabelEsAr('bpm')).toBe('lpm');
    expect(unitLabelEsAr('au')).toBe('UA');
    expect(unitLabelEsAr('score')).toBe('');
    expect(unitLabelEsAr('n')).toBe('');
  });
});

describe('formatUnit', () => {
  it('formats each domain unit with its label and default resolution', () => {
    const cases: [number, UnitCode, string][] = [
      [3.4, 'mm', '3 mm'],
      [42.25, 'cm', '42,3 cm'],
      [5432.4, 'm', '5.432 m'],
      [6.789, 'km', '6,79 km'],
      [68.25, 'kg', '68,3 kg'],
      [243.4, 'msec', '243 ms'],
      [1.853, 's', '1,85 s'],
      [75, 'min', '75 min'],
      [1.25, 'h', '1,3 h'],
      [-0.84, 'years', '-0,8 años'],
      [8.2, 'ms', '8,20 m/s'],
      [19.5, 'kmh', '19,5 km/h'],
      [102.6, 'm_min', '103 m/min'],
      [7.84, 'cm_year', '7,8 cm/año'],
      [2.5, 'ms2', '2,50 m/s²'],
      [312.7, 'newton', '313 N'],
      [11.6, 'deg', '12°'],
      [182, 'bpm', '182 lpm'],
      [1.456, 'kg_kg', '1,46 kg/kg'],
      [12.5, 'pct', '12,5 %'],
      [450, 'au', '450 UA'],
      [3.25, 'score', '3,3'],
      [12, 'n', '12'],
    ];
    expect(cases.map(([, unit]) => unit).sort()).toEqual([...UNIT_CODES].sort());
    for (const [value, unit, expected] of cases) {
      expect(formatUnit(value, unit), unit).toBe(nb(expected));
    }
  });

  it('has default decimals for every domain unit', () => {
    expect(Object.keys(UNIT_DEFAULT_DECIMALS).sort()).toEqual([...UNIT_CODES].sort());
  });

  it('joins number and label with a no-break space', () => {
    expect(formatUnit(1.85, 's')).toBe(`1,85${NBSP}s`);
  });

  it('accepts decimal overrides and signs', () => {
    expect(formatUnit(1.853, 's', { decimals: 3 })).toBe(nb('1,853 s'));
    expect(formatUnit(12, 'pct', { maxDecimals: 1 })).toBe(nb('12 %'));
    expect(formatUnit(-7.25, 'pct', { sign: 'always' })).toBe(nb('-7,3 %'));
    expect(formatUnit(3.2, 'pct', { sign: 'always' })).toBe(nb('+3,2 %'));
    expect(formatUnit(12_345, 'au')).toBe(nb('12.345 UA'));
  });

  it('renders a bare placeholder for missing values', () => {
    expect(formatUnit(null, 's')).toBe(PLACEHOLDER);
    expect(formatUnit(Number.NaN, 'pct')).toBe(PLACEHOLDER);
  });
});
