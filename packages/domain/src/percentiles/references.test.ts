import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POSITION_LINES,
  HOCKEY_LINE_CODES,
  DomainValidationError,
  RUGBY_LINE_CODES,
  canonicalMetricCode,
  compareToFirstTeamReference,
  isWellFormedCode,
  lineForPosition,
  parseLocalDate,
  referenceScope,
  selectFirstTeamReference,
  type FirstTeamReference,
  type FirstTeamReferenceQuery,
} from '../index.js';

const CMJ = canonicalMetricCode('cmj_height_cm');
const T40 = canonicalMetricCode('sprint_40_s');

function ref(overrides: Partial<FirstTeamReference> = {}): FirstTeamReference {
  return {
    metricCode: CMJ,
    sport: 'rugby',
    sex: 'male',
    value: 45,
    unit: 'cm',
    validFrom: parseLocalDate('2026-01-01'),
    source: 'Primera 2026',
    ...overrides,
  };
}

const query: FirstTeamReferenceQuery = {
  metricCode: CMJ,
  sport: 'rugby',
  sex: 'male',
  positionCode: 'wing',
  lineCode: 'backs',
  asOf: parseLocalDate('2026-06-01'),
};

describe('selectFirstTeamReference', () => {
  const squad = ref({ source: 'squad' });
  const backs = ref({ lineCode: 'backs', source: 'backs' });
  const forwards = ref({ lineCode: 'forwards', source: 'forwards' });
  const wing = ref({ positionCode: 'wing', lineCode: 'backs', source: 'wing' });
  const prop = ref({ positionCode: 'prop', source: 'prop' });

  it('prefers position over line over squad', () => {
    expect(selectFirstTeamReference([squad, backs, wing, prop, forwards], query)).toBe(wing);
    expect(selectFirstTeamReference([squad, backs, prop, forwards], query)).toBe(backs);
    expect(selectFirstTeamReference([squad, prop, forwards], query)).toBe(squad);
  });

  it('never applies a reference of another position or line', () => {
    expect(selectFirstTeamReference([prop, forwards], query)).toBeUndefined();
    const noPosition = omit(query, 'positionCode', 'lineCode');
    expect(selectFirstTeamReference([prop, backs, squad], noPosition)).toBe(squad);
  });

  it('matches metric, sport and sex', () => {
    expect(selectFirstTeamReference([ref({ metricCode: T40 })], query)).toBeUndefined();
    expect(selectFirstTeamReference([ref({ sport: 'hockey' })], query)).toBeUndefined();
    expect(selectFirstTeamReference([ref({ sex: 'female' })], query)).toBeUndefined();
  });

  it('takes the latest reference valid on the date, ignoring future ones', () => {
    const old = ref({ validFrom: parseLocalDate('2025-01-01'), source: 'old' });
    const current = ref({ validFrom: parseLocalDate('2026-03-01'), source: 'current' });
    const future = ref({ validFrom: parseLocalDate('2026-07-01'), source: 'future' });
    expect(selectFirstTeamReference([old, future, current], query)).toBe(current);
    expect(
      selectFirstTeamReference([old, current, future], {
        ...query,
        asOf: parseLocalDate('2026-03-01'),
      }),
    ).toBe(current);
    expect(
      selectFirstTeamReference([old, current, future], {
        ...query,
        asOf: parseLocalDate('2024-12-31'),
      }),
    ).toBeUndefined();
  });

  it('prefers a more specific scope even when older', () => {
    const oldWing = ref({ positionCode: 'wing', validFrom: parseLocalDate('2024-01-01') });
    const newSquad = ref({ validFrom: parseLocalDate('2026-05-01') });
    expect(selectFirstTeamReference([newSquad, oldWing], query)).toBe(oldWing);
  });
});

describe('referenceScope', () => {
  it('classifies by the most specific field', () => {
    expect(referenceScope(ref())).toBe('squad');
    expect(referenceScope(ref({ lineCode: 'backs' }))).toBe('line');
    expect(referenceScope(ref({ positionCode: 'wing', lineCode: 'backs' }))).toBe('position');
  });
});

describe('compareToFirstTeamReference', () => {
  it('compares a higher-is-better value', () => {
    const c = compareToFirstTeamReference({ value: 40.5, unit: 'cm' }, ref(), 'higher_is_better');
    expect(c.referenceValue).toBe(45);
    expect(c.scope).toBe('squad');
    expect(c.differenceAbs).toBeCloseTo(-4.5);
    expect(c.differencePct).toBeCloseTo(-10);
    expect(c.valuePctOfReference).toBeCloseTo(90);
    expect(c.meetsReference).toBe(false);
    expect(c.methodMismatch).toBe(false);
  });

  it('keeps the differencePct sign aligned with differenceAbs for a negative reference', () => {
    const c = compareToFirstTeamReference(
      { value: -5, unit: 'cm' },
      ref({ value: -10 }),
      'higher_is_better',
    );
    expect(c.differenceAbs).toBe(5);
    expect(c.differencePct).toBeCloseTo(50);
    expect(c.valuePctOfReference).toBeCloseTo(50);
  });

  it('compares a lower-is-better value', () => {
    const reference = ref({ metricCode: T40, unit: 's', value: 5.0 });
    const faster = compareToFirstTeamReference(
      { value: 4.9, unit: 's' },
      reference,
      'lower_is_better',
    );
    expect(faster.meetsReference).toBe(true);
    expect(faster.differencePct).toBeCloseTo(-2);
    const equal = compareToFirstTeamReference(
      { value: 5.0, unit: 's' },
      reference,
      'lower_is_better',
    );
    expect(equal.meetsReference).toBe(true);
    const slower = compareToFirstTeamReference(
      { value: 5.3, unit: 's' },
      reference,
      'lower_is_better',
    );
    expect(slower.meetsReference).toBe(false);
  });

  it('does not judge neutral metrics', () => {
    const c = compareToFirstTeamReference(
      { value: 90, unit: 'kg' },
      ref({ unit: 'kg', value: 100 }),
      'neutral',
    );
    expect(c.meetsReference).toBeNull();
  });

  it('returns null percentages for a zero reference', () => {
    const c = compareToFirstTeamReference({ value: 2, unit: 'cm' }, ref({ value: 0 }), 'neutral');
    expect(c.differenceAbs).toBe(2);
    expect(c.differencePct).toBeNull();
    expect(c.valuePctOfReference).toBeNull();
  });

  it('flags a method mismatch only when both methods are known', () => {
    const r = ref({ method: 'photocell' });
    expect(
      compareToFirstTeamReference({ value: 1, unit: 'cm', method: 'app' }, r, 'higher_is_better')
        .methodMismatch,
    ).toBe(true);
    expect(
      compareToFirstTeamReference(
        { value: 1, unit: 'cm', method: 'photocell' },
        r,
        'higher_is_better',
      ).methodMismatch,
    ).toBe(false);
    expect(
      compareToFirstTeamReference({ value: 1, unit: 'cm' }, r, 'higher_is_better').methodMismatch,
    ).toBe(false);
  });

  it('rejects different units and non-finite values', () => {
    expect(() =>
      compareToFirstTeamReference({ value: 0.4, unit: 'm' }, ref(), 'higher_is_better'),
    ).toThrow(DomainValidationError);
    expect(() =>
      compareToFirstTeamReference({ value: Number.NaN, unit: 'cm' }, ref(), 'higher_is_better'),
    ).toThrow(DomainValidationError);
  });
});

describe('lineForPosition', () => {
  it('maps rugby positions to forwards and backs', () => {
    expect(lineForPosition('rugby', 'prop')).toBe('forwards');
    expect(lineForPosition('rugby', 'number_eight')).toBe('forwards');
    expect(lineForPosition('rugby', 'fly_half')).toBe('backs');
    expect(lineForPosition('rugby', 'unknown')).toBeUndefined();
    expect(lineForPosition('hockey', 'prop')).toBeUndefined();
  });

  it('maps field hockey positions to their lines', () => {
    expect(lineForPosition('hockey', 'goalkeeper')).toBe('goalkeepers');
    expect(lineForPosition('hockey', 'midfielder')).toBe('midfielders');
    expect(lineForPosition('rugby', 'midfielder')).toBeUndefined();
  });

  it('accepts a club mapping', () => {
    const club = [
      { sport: 'hockey', positionCode: 'goalkeeper', lineCode: 'goalkeepers' },
    ] as const;
    expect(lineForPosition('hockey', 'goalkeeper', club)).toBe('goalkeepers');
  });

  it('default data uses well-formed codes and the sport lines, one entry per position', () => {
    const positions = new Set<string>();
    for (const p of DEFAULT_POSITION_LINES) {
      expect(isWellFormedCode(p.positionCode)).toBe(true);
      const lines: readonly string[] = p.sport === 'rugby' ? RUGBY_LINE_CODES : HOCKEY_LINE_CODES;
      expect(lines).toContain(p.lineCode);
      const key = `${p.sport}:${p.positionCode}`;
      expect(positions.has(key)).toBe(false);
      positions.add(key);
    }
    expect(new Set(DEFAULT_POSITION_LINES.map((p) => p.sport))).toEqual(
      new Set(['rugby', 'hockey']),
    );
  });
});

/** Test helper: a copy of `value` without `keys` (for optional fields). */
export function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy: Partial<T> = { ...value };
  for (const key of keys) Reflect.deleteProperty(copy, key);
  return copy as Omit<T, K>;
}
