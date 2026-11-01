import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  STANDARD_GRAVITY_MS2,
  UNITS,
  UNIT_CODES,
  cmToM,
  isUnitCode,
  kmhToMs,
  mToCm,
  minutesToSeconds,
  msToKmh,
  msecToSeconds,
  parseUnitCode,
  ratioToPct,
  secondsToMinutes,
  secondsToMsec,
} from './index.js';

describe('unit catalog', () => {
  it('keys every unit by its own code', () => {
    for (const code of UNIT_CODES) expect(UNITS[code].code).toBe(code);
  });

  it('uses snake_case codes usable as name suffixes', () => {
    for (const code of UNIT_CODES) expect(code).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
  });

  it('reserves ms for metres per second and n for counts', () => {
    expect(UNITS.ms.dimension).toBe('speed');
    expect(UNITS.msec.dimension).toBe('time');
    expect(UNITS.n.dimension).toBe('count');
    expect(UNITS.newton.dimension).toBe('force');
  });

  it('keeps UI text out of the domain: symbols are international or null', () => {
    const withoutSymbol = UNIT_CODES.filter((code) => UNITS[code].symbol === null);
    expect(withoutSymbol).toEqual(['years', 'cm_year', 'bpm', 'au', 'score', 'n']);
    for (const code of UNIT_CODES) {
      const { symbol } = UNITS[code];
      if (symbol !== null) expect(symbol).toMatch(/^(?:[A-Za-z]+(?:\/[A-Za-z]+)?²?|%|°)$/);
    }
  });

  it('parses unit codes', () => {
    expect(isUnitCode('kmh')).toBe(true);
    expect(parseUnitCode('cm')).toBe('cm');
    expect(isUnitCode('toString')).toBe(false);
    expect(() => parseUnitCode('km/h')).toThrow(DomainValidationError);
  });
});

describe('conversions', () => {
  it('converts speed', () => {
    expect(kmhToMs(36)).toBe(10);
    expect(msToKmh(5.5)).toBeCloseTo(19.8, 10);
    expect(msToKmh(kmhToMs(18.5))).toBeCloseTo(18.5, 10);
  });

  it('converts time', () => {
    expect(secondsToMsec(1.25)).toBe(1250);
    expect(msecToSeconds(250)).toBe(0.25);
    expect(minutesToSeconds(1.5)).toBe(90);
    expect(secondsToMinutes(90)).toBe(1.5);
  });

  it('converts length', () => {
    expect(cmToM(175)).toBe(1.75);
    expect(mToCm(0.5)).toBe(50);
  });

  it('computes percentages and refuses a zero whole', () => {
    expect(ratioToPct(1, 4)).toBe(25);
    expect(() => ratioToPct(1, 0)).toThrow(DomainValidationError);
  });

  it('exposes standard gravity for the CMJ formula', () => {
    expect(STANDARD_GRAVITY_MS2).toBe(9.81);
  });
});
