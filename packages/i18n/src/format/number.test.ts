import { describe, expect, it } from 'vitest';
import { PLACEHOLDER, formatNumber, getSeparators, parseNumber } from './number.js';

describe('formatNumber', () => {
  it('uses decimal comma and dot thousands separator', () => {
    expect(formatNumber(1234.5)).toBe('1.234,5');
    expect(formatNumber(1234)).toBe('1.234');
    expect(formatNumber(1234567.891)).toBe('1.234.567,89');
    expect(formatNumber(0.5)).toBe('0,5');
  });

  it('rounds to the requested decimals', () => {
    expect(formatNumber(1.005, { decimals: 2 })).toBe('1,01');
    expect(formatNumber(2, { decimals: 2 })).toBe('2,00');
    expect(formatNumber(1.23456, { maxDecimals: 3 })).toBe('1,235');
    expect(formatNumber(1.2, { minDecimals: 1, maxDecimals: 3 })).toBe('1,2');
    expect(formatNumber(1.5, { decimals: 0 })).toBe('2');
  });

  it('defaults maxDecimals to at least minDecimals', () => {
    expect(formatNumber(1.23456, { minDecimals: 4 })).toBe('1,2346');
  });

  it('formats negatives with a minus and never renders -0', () => {
    expect(formatNumber(-1234.5)).toBe('-1.234,5');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(-0.001)).toBe('0');
    expect(formatNumber(-0.004, { decimals: 2 })).toBe('0,00');
  });

  it('adds a plus sign for deltas, but not to zero', () => {
    expect(formatNumber(3.21, { sign: 'always', decimals: 1 })).toBe('+3,2');
    expect(formatNumber(-3.21, { sign: 'always', decimals: 1 })).toBe('-3,2');
    expect(formatNumber(0, { sign: 'always' })).toBe('0');
    expect(formatNumber(0.001, { sign: 'always', decimals: 1 })).toBe('0,0');
  });

  it('can disable grouping', () => {
    expect(formatNumber(2026, { grouping: false })).toBe('2026');
  });

  it('renders a placeholder for missing or non-finite values', () => {
    expect(formatNumber(null)).toBe(PLACEHOLDER);
    expect(formatNumber(undefined)).toBe(PLACEHOLDER);
    expect(formatNumber(Number.NaN)).toBe(PLACEHOLDER);
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe(PLACEHOLDER);
  });

  it('rejects invalid decimal options', () => {
    expect(() => formatNumber(1, { decimals: -1 })).toThrow(RangeError);
    expect(() => formatNumber(1, { decimals: 1.5 })).toThrow(RangeError);
    expect(() => formatNumber(1, { minDecimals: 3, maxDecimals: 1 })).toThrow(RangeError);
  });
});

describe('getSeparators', () => {
  it('returns es-AR separators', () => {
    expect(getSeparators()).toEqual({ decimal: ',', group: '.' });
  });
});

describe('parseNumber', () => {
  it('parses es-AR input', () => {
    expect(parseNumber('1,85')).toBe(1.85);
    expect(parseNumber('  42 ')).toBe(42);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('1.234.567')).toBe(1234567);
    expect(parseNumber(',5')).toBe(0.5);
    expect(parseNumber('-0,5')).toBe(-0.5);
    expect(parseNumber('−0,5')).toBe(-0.5);
    expect(parseNumber('+3')).toBe(3);
  });

  it('never returns -0', () => {
    expect(Object.is(parseNumber('-0'), 0)).toBe(true);
  });

  it('rejects ambiguous or malformed input instead of guessing', () => {
    for (const input of [
      '',
      ' ',
      '1.85',
      '1,2,3',
      '12.34',
      '1.2345',
      'abc',
      '1,',
      '-',
      '1 234',
      '1e3',
      '0x10',
      '1,5 s',
    ]) {
      expect(parseNumber(input), input).toBeNull();
    }
  });

  it('can reject grouping separators', () => {
    expect(parseNumber('1.234', { allowGrouping: false })).toBeNull();
    expect(parseNumber('1234,5', { allowGrouping: false })).toBe(1234.5);
  });

  it('round-trips formatted numbers', () => {
    for (const value of [0, 1.85, -12.5, 1234.56, 98765432.1]) {
      expect(parseNumber(formatNumber(value))).toBe(value);
    }
  });
});
