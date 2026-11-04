import { describe, expect, it } from 'vitest';
import {
  CATEGORY_REPORT_MIN_PLAYERS,
  groupAverage,
  pairedChange,
  responseRatePct,
} from './category-report.js';

const pairs = (values: [number, number][]) =>
  values.map(([previous, current]) => ({ previous, current }));

describe('category report (B-603)', () => {
  it('averages only from the minimum of players', () => {
    expect(CATEGORY_REPORT_MIN_PLAYERS).toBe(5);
    expect(groupAverage([1, 2, 3, 4])).toBeNull();
    expect(groupAverage([1, 2, 3, 4, 5])).toBe(3);
  });

  it('counts the changes by the direction of the metric, from the minimum of pairs', () => {
    expect(
      pairedChange(
        'higher_is_better',
        pairs([
          [30, 32],
          [30, 29],
          [30, 30],
          [31, 33],
        ]),
      ),
    ).toBeNull();
    expect(
      pairedChange(
        'higher_is_better',
        pairs([
          [30, 32],
          [30, 29],
          [30, 30],
          [31, 33],
          [28, 29],
        ]),
      ),
    ).toEqual({ paired: 5, improved: 3, worsened: 1, unchanged: 1 });
    expect(
      pairedChange(
        'lower_is_better',
        pairs([
          [3.2, 3.1],
          [3.2, 3.3],
          [3.2, 3.0],
          [3.2, 3.2],
          [3.2, 3.15],
        ]),
      ),
    ).toEqual({ paired: 5, improved: 3, worsened: 1, unchanged: 1 });
    expect(
      pairedChange(
        'neutral',
        pairs([
          [70, 72],
          [70, 69],
          [70, 70],
          [71, 73],
          [68, 69],
        ]),
      ),
    ).toEqual({ paired: 5, improved: 0, worsened: 0, unchanged: 5 });
  });

  it('gives a response rate only when something was expected', () => {
    expect(responseRatePct(3, 4)).toBe(75);
    expect(responseRatePct(0, 0)).toBeNull();
    expect(responseRatePct(5, 4)).toBe(100);
    expect(responseRatePct(-1, 4)).toBeNull();
  });
});
