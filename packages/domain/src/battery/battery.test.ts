import { describe, expect, it } from 'vitest';
import { DEFAULT_AGE_BANDS } from '../category.js';
import type { CategoryId, ClubId } from '../ids.js';
import type { LocalDate } from '../time.js';
import {
  BatteryEntryValidationError,
  batteryEntrySpecificity,
  findBatteryEntryConflicts,
  resolveBattery,
  validateBatterySchedule,
  validateBatteryStage,
  validityRangesOverlap,
  type BatteryEntry,
  type BatteryQuery,
} from './battery.js';

const CLUB = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f' as ClubId;
const M15 = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e01' as CategoryId;
const M17 = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e02' as CategoryId;
const day = (value: string) => value as LocalDate;

function entry(overrides: Partial<BatteryEntry & { id: string }> = {}): BatteryEntry & {
  id: string;
} {
  return {
    id: 'club-wide',
    clubId: CLUB,
    sport: 'rugby',
    sex: null,
    stage: null,
    categoryId: null,
    testCode: 'cmj',
    windows: [1, 2, 3, 4],
    cadenceWeeks: null,
    validFrom: day('2026-01-01'),
    validTo: null,
    ...overrides,
  };
}

const query: BatteryQuery = {
  clubId: CLUB,
  sport: 'rugby',
  sex: 'male',
  stage: 'development',
  categoryId: M15,
  onDate: day('2026-04-10'),
};

function fieldOf(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof BatteryEntryValidationError) return error.field;
    throw error;
  }
  return undefined;
}

describe('validateBatterySchedule', () => {
  it('accepts windows, a cadence or both', () => {
    expect(() => {
      validateBatterySchedule([1, 3], null);
    }).not.toThrow();
    expect(() => {
      validateBatterySchedule([], { min: 4, max: 6 });
    }).not.toThrow();
    expect(() => {
      validateBatterySchedule([1, 2, 3, 4], { min: 1, max: 1 });
    }).not.toThrow();
  });

  it('rejects unknown or repeated windows and an empty schedule', () => {
    expect(
      fieldOf(() => {
        validateBatterySchedule([0], null);
      }),
    ).toBe('windows');
    expect(
      fieldOf(() => {
        validateBatterySchedule([5], null);
      }),
    ).toBe('windows');
    expect(
      fieldOf(() => {
        validateBatterySchedule([1, 1], null);
      }),
    ).toBe('windows');
    expect(
      fieldOf(() => {
        validateBatterySchedule([], null);
      }),
    ).toBe('windows');
  });

  it('rejects a cadence that is not whole weeks between 1 and 52 with min <= max', () => {
    expect(
      fieldOf(() => {
        validateBatterySchedule([], { min: 0, max: 2 });
      }),
    ).toBe('cadenceWeeks');
    expect(
      fieldOf(() => {
        validateBatterySchedule([], { min: 1.5, max: 2 });
      }),
    ).toBe('cadenceWeeks');
    expect(
      fieldOf(() => {
        validateBatterySchedule([], { min: 6, max: 4 });
      }),
    ).toBe('cadenceWeeks');
    expect(
      fieldOf(() => {
        validateBatterySchedule([], { min: 1, max: 53 });
      }),
    ).toBe('cadenceWeeks');
  });
});

describe('validateBatteryStage', () => {
  const m13 = DEFAULT_AGE_BANDS[0];
  const m17 = DEFAULT_AGE_BANDS[4];

  it('lets any stage do a test without maximal loads', () => {
    for (const stage of [null, 'foundation', 'development', 'performance'] as const) {
      expect(() => {
        validateBatteryStage({ stage, maximalLoad: false, ageBand: m13 });
      }).not.toThrow();
    }
  });

  it('keeps maximal loads to the performance stage and the bands that allow them', () => {
    expect(
      fieldOf(() => {
        validateBatteryStage({ stage: null, maximalLoad: true, ageBand: null });
      }),
    ).toBe('stage');
    expect(
      fieldOf(() => {
        validateBatteryStage({ stage: 'foundation', maximalLoad: true, ageBand: null });
      }),
    ).toBe('stage');
    expect(
      fieldOf(() => {
        validateBatteryStage({ stage: 'development', maximalLoad: true, ageBand: null });
      }),
    ).toBe('stage');
    expect(
      fieldOf(() => {
        validateBatteryStage({ stage: 'performance', maximalLoad: true, ageBand: m13 });
      }),
    ).toBe('categoryId');
    expect(() => {
      validateBatteryStage({ stage: 'performance', maximalLoad: true, ageBand: m17 });
    }).not.toThrow();
    expect(() => {
      validateBatteryStage({ stage: 'performance', maximalLoad: true, ageBand: null });
    }).not.toThrow();
  });
});

describe('resolveBattery', () => {
  it('picks, per test, the most specific entry in force', () => {
    const entries = [
      entry(),
      entry({ id: 'male', sex: 'male', windows: [1, 3] }),
      entry({ id: 'development', stage: 'development', windows: [2] }),
      entry({ id: 'm15', categoryId: M15, windows: [4] }),
      entry({ id: 'm17', categoryId: M17, windows: [3] }),
      entry({ id: 'sprint', testCode: 'sprint_40' }),
      entry({ id: 'hockey', sport: 'hockey', testCode: 'bronco' }),
      entry({ id: 'female', sex: 'female', testCode: 'neck' }),
      entry({ id: 'performance', stage: 'performance', testCode: 'bronco' }),
    ];
    expect(resolveBattery(entries, query).map((e) => e.id)).toEqual(['m15', 'sprint']);
    expect(resolveBattery(entries, { ...query, categoryId: null }).map((e) => e.id)).toEqual([
      'development',
      'sprint',
    ]);
    expect(
      resolveBattery(entries, { ...query, categoryId: null, stage: 'foundation' }).map((e) => e.id),
    ).toEqual(['male', 'sprint']);
  });

  it('only uses entries valid on the day, with an exclusive end', () => {
    const entries = [
      entry({ id: 'old', validTo: day('2026-04-10') }),
      entry({ id: 'new', validFrom: day('2026-04-10') }),
      entry({ id: 'future', testCode: 'neck', validFrom: day('2026-05-01') }),
    ];
    expect(resolveBattery(entries, query).map((e) => e.id)).toEqual(['new']);
    expect(
      resolveBattery(entries, { ...query, onDate: day('2026-04-09') }).map((e) => e.id),
    ).toEqual(['old']);
  });

  it('refuses to pick between two entries with the same scope', () => {
    expect(() => resolveBattery([entry(), entry({ id: 'twin' })], query)).toThrow(/Ambiguous/);
  });

  it('ranks category over stage over sex', () => {
    expect(batteryEntrySpecificity(entry({ categoryId: M15 }))).toBeGreaterThan(
      batteryEntrySpecificity(entry({ stage: 'performance', sex: 'male' })),
    );
    expect(batteryEntrySpecificity(entry({ stage: 'performance' }))).toBeGreaterThan(
      batteryEntrySpecificity(entry({ sex: 'male' })),
    );
  });
});

describe('findBatteryEntryConflicts', () => {
  it('reports overlapping entries of the same scope and test only', () => {
    const a = entry({ id: 'a', validTo: day('2026-06-01') });
    const contiguous = entry({ id: 'b', validFrom: day('2026-06-01') });
    const overlapping = entry({
      id: 'c',
      validFrom: day('2026-05-01'),
      validTo: day('2026-07-01'),
    });
    const otherTest = entry({ id: 'd', testCode: 'neck' });
    const otherScope = entry({ id: 'e', stage: 'performance' });
    const pairs = findBatteryEntryConflicts([a, contiguous, overlapping, otherTest, otherScope]);
    expect(pairs.map(([x, y]) => `${x.id}${y.id}`)).toEqual(['ac', 'bc']);
  });

  it('treats open-ended ranges as running forever', () => {
    expect(
      validityRangesOverlap(
        { validFrom: day('2026-01-01'), validTo: null },
        { validFrom: day('2030-01-01'), validTo: null },
      ),
    ).toBe(true);
    expect(
      validityRangesOverlap(
        { validFrom: day('2026-01-01'), validTo: day('2026-02-01') },
        { validFrom: day('2026-02-01'), validTo: null },
      ),
    ).toBe(false);
  });
});
