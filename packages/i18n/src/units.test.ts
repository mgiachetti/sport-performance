import { UNITS, UNIT_CODES } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { UNIT_MESSAGES_ES_AR, unitLabelEsAr, unitMessageKey } from './index.js';

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
    expect(unitLabelEsAr('n')).toBe('');
  });
});
