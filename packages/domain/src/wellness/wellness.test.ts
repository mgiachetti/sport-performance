import { describe, expect, it } from 'vitest';
import { WELLNESS_ITEMS } from '../measurement.js';
import { STAGES, STAGE_PROFILES } from '../stage.js';
import { parseLocalDate } from '../time.js';
import {
  WELLNESS_ITEM_SETS,
  isWellnessItemCount,
  isWithinWellnessWindow,
  wellnessItemSetForStage,
  wellnessMeanScore,
  wellnessScoreIssues,
  wellnessStageOn,
} from './index.js';

const day = parseLocalDate;

describe('wellness item sets', () => {
  it('asks 3 items in foundation and all 5 later, as the stage profiles say', () => {
    expect(wellnessItemSetForStage('foundation')).toEqual({
      itemCount: 3,
      items: ['sleep', 'fatigue', 'soreness'],
    });
    expect(wellnessItemSetForStage('development').items).toEqual(WELLNESS_ITEMS);
    expect(wellnessItemSetForStage('performance').items).toEqual(WELLNESS_ITEMS);
    for (const stage of STAGES) {
      const set = wellnessItemSetForStage(stage);
      expect(set.itemCount).toBe(STAGE_PROFILES[stage].wellnessItemCount);
      expect(set.items).toHaveLength(set.itemCount);
    }
  });

  it('sets are subsets of the items, without repeats', () => {
    for (const items of Object.values(WELLNESS_ITEM_SETS)) {
      expect(new Set(items).size).toBe(items.length);
      for (const item of items) expect(WELLNESS_ITEMS).toContain(item);
    }
  });

  it('recognises only the stored counts', () => {
    expect(isWellnessItemCount(3)).toBe(true);
    expect(isWellnessItemCount(5)).toBe(true);
    for (const value of [0, 4, '3', null, undefined])
      expect(isWellnessItemCount(value)).toBe(false);
  });
});

describe('wellnessScoreIssues', () => {
  it('accepts exactly the items of the set, 1 to 5', () => {
    expect(wellnessScoreIssues(3, { sleep: 1, fatigue: 5, soreness: 3 })).toEqual([]);
    expect(
      wellnessScoreIssues(5, { sleep: 1, fatigue: 2, soreness: 3, stress: 4, mood: 5 }),
    ).toEqual([]);
    // Explicit nulls outside the set are not answers.
    expect(wellnessScoreIssues(3, { sleep: 1, fatigue: 5, soreness: 3, mood: null })).toEqual([]);
  });

  it('reports missing items, items outside the set and out-of-range scores', () => {
    expect(wellnessScoreIssues(5, { sleep: 3, fatigue: 3, soreness: 3 })).toEqual([
      { item: 'stress', problem: 'missing' },
      { item: 'mood', problem: 'missing' },
    ]);
    expect(wellnessScoreIssues(3, { sleep: 3, fatigue: 3, soreness: 3, mood: 4 })).toEqual([
      { item: 'mood', problem: 'not_in_set' },
    ]);
    expect(wellnessScoreIssues(3, { sleep: 0, fatigue: 6, soreness: 2.5 })).toEqual([
      { item: 'sleep', problem: 'out_of_range' },
      { item: 'fatigue', problem: 'out_of_range' },
      { item: 'soreness', problem: 'out_of_range' },
    ]);
  });
});

describe('wellnessMeanScore', () => {
  it('averages the answered items only', () => {
    expect(wellnessMeanScore({ sleep: 4, fatigue: 3, soreness: 2 })).toBe(3);
    expect(wellnessMeanScore({ sleep: 5, fatigue: 4, soreness: 4, stress: 3, mood: null })).toBe(4);
  });
});

describe('isWithinWellnessWindow', () => {
  const today = day('2026-03-10');

  it('accepts today and yesterday', () => {
    expect(isWithinWellnessWindow(today, today)).toBe(true);
    expect(isWithinWellnessWindow(day('2026-03-09'), today)).toBe(true);
  });

  it('rejects the future and earlier days, also across months', () => {
    expect(isWithinWellnessWindow(day('2026-03-11'), today)).toBe(false);
    expect(isWithinWellnessWindow(day('2026-03-08'), today)).toBe(false);
    expect(isWithinWellnessWindow(day('2026-02-28'), day('2026-03-01'))).toBe(true);
  });
});

describe('wellnessStageOn', () => {
  it('prefers the stage assignment of the day', () => {
    expect(
      wellnessStageOn({ assignedStage: 'performance', categoryDefaultStages: ['foundation'] }),
    ).toBe('performance');
  });

  it('falls back to the youngest default stage of the categories', () => {
    expect(
      wellnessStageOn({
        assignedStage: null,
        categoryDefaultStages: ['performance', 'development'],
      }),
    ).toBe('development');
    expect(wellnessStageOn({ assignedStage: null, categoryDefaultStages: [] })).toBeNull();
  });
});
