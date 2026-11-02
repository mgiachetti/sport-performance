import { describe, expect, it } from 'vitest';
import {
  CHANGE_OPERATIONS,
  CHANGE_REASON_MAX_LENGTH,
  CHANGE_SOURCES,
  CHANGE_TRACKED_TABLES,
  DomainValidationError,
  isChangeOperation,
  isChangeSource,
  isChangeTrackedTable,
  parseChangeOperation,
  parseChangeReason,
  parseChangeSource,
  parseChangeTrackedTable,
} from './index.js';

const cases = [
  {
    name: 'tracked table',
    values: CHANGE_TRACKED_TABLES,
    is: isChangeTrackedTable,
    parse: parseChangeTrackedTable,
  },
  {
    name: 'operation',
    values: CHANGE_OPERATIONS,
    is: isChangeOperation,
    parse: parseChangeOperation,
  },
  { name: 'source', values: CHANGE_SOURCES, is: isChangeSource, parse: parseChangeSource },
] as const;

describe.each(cases)('change history $name', ({ values, is, parse }) => {
  it('accepts every member', () => {
    for (const value of values) {
      expect(is(value)).toBe(true);
      expect(parse(value)).toBe(value);
    }
  });

  it('rejects non-members', () => {
    for (const value of ['', 'unknown', 42, null, undefined]) {
      expect(is(value)).toBe(false);
      expect(() => parse(value)).toThrow(DomainValidationError);
    }
  });
});

describe('tracked tables', () => {
  it('cover results, sessions and measurements, never the medical schema', () => {
    expect(CHANGE_TRACKED_TABLES).toEqual(
      expect.arrayContaining([
        'test_result',
        'test_result_value',
        'test_session',
        'training_session',
        'participation',
        'anthro_measurement',
        'wellness',
      ]),
    );
    expect(CHANGE_TRACKED_TABLES.some((table) => table.startsWith('medical'))).toBe(false);
  });
});

describe('parseChangeReason', () => {
  it('trims the reason', () => {
    expect(parseChangeReason('  Error de tipeo en el t20 \n')).toBe('Error de tipeo en el t20');
  });

  it('accepts up to the maximum length, counting characters (not UTF-16 units)', () => {
    expect(parseChangeReason('ñ'.repeat(CHANGE_REASON_MAX_LENGTH))).toHaveLength(
      CHANGE_REASON_MAX_LENGTH,
    );
    const emoji = '🏉'.repeat(CHANGE_REASON_MAX_LENGTH);
    expect(parseChangeReason(emoji)).toBe(emoji);
  });

  it.each(['', '   ', '\n\t', 'x'.repeat(CHANGE_REASON_MAX_LENGTH + 1), 42, null, undefined])(
    'rejects %j',
    (value) => {
      expect(() => parseChangeReason(value)).toThrow(DomainValidationError);
    },
  );
});
