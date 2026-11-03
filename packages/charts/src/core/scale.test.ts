import { describe, expect, it } from 'vitest';
import { decimalsOf, extent, finiteValues, linearScale, niceTicks } from './scale.js';

describe('linearScale', () => {
  it('maps the domain onto the range and back', () => {
    const scale = linearScale([0, 100], [200, 0]);
    expect(scale(0)).toBe(200);
    expect(scale(50)).toBe(100);
    expect(scale(100)).toBe(0);
    expect(scale.invert(100)).toBe(50);
    expect(scale.domain).toEqual([0, 100]);
    expect(scale.range).toEqual([200, 0]);
  });

  it('puts every value in the middle of a degenerate domain', () => {
    const scale = linearScale([5, 5], [0, 100]);
    expect(scale(5)).toBe(50);
    expect(scale(9)).toBe(50);
  });
});

describe('niceTicks', () => {
  it('covers the values with round steps', () => {
    const ticks = niceTicks(1310, 2240, 5);
    expect(ticks.step).toBe(250);
    expect(ticks.min).toBeLessThanOrEqual(1310);
    expect(ticks.max).toBeGreaterThanOrEqual(2240);
    expect(ticks.ticks).toEqual([1250, 1500, 1750, 2000, 2250]);
    expect(ticks.decimals).toBe(0);
  });

  it('starts at zero when asked to cover it', () => {
    expect(niceTicks(0, 2600, 5).ticks).toEqual([0, 1000, 2000, 3000]);
  });

  it('keeps decimals of small steps without float noise', () => {
    const ticks = niceTicks(5.12, 5.68, 5);
    expect(ticks.step).toBe(0.2);
    expect(ticks.ticks).toEqual([5, 5.2, 5.4, 5.6, 5.8]);
    expect(ticks.decimals).toBe(1);
  });

  it('never exceeds the requested interval count', () => {
    for (const [min, max] of [
      [0, 7],
      [0.3, 0.92],
      [-12, 37],
      [41.2, 48.9],
      [0, 1],
    ] as const) {
      for (const maxTicks of [2, 3, 4, 5, 6]) {
        const ticks = niceTicks(min, max, maxTicks);
        expect(
          ticks.ticks.length - 1,
          `${String(min)}..${String(max)}/${String(maxTicks)}`,
        ).toBeLessThanOrEqual(maxTicks);
        expect(ticks.min).toBeLessThanOrEqual(min);
        expect(ticks.max).toBeGreaterThanOrEqual(max);
      }
    }
  });

  it('spreads a single value around itself, never below zero for positive data', () => {
    const ticks = niceTicks(45, 45, 4);
    expect(ticks.min).toBeLessThan(45);
    expect(ticks.max).toBeGreaterThan(45);
    expect(niceTicks(0, 0, 4).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('crosses zero for negative values and never writes -0', () => {
    const ticks = niceTicks(-7, 7, 4);
    expect(ticks.ticks).toContain(0);
    expect(ticks.ticks.some((tick) => Object.is(tick, -0))).toBe(false);
  });

  it('rejects non-finite bounds', () => {
    expect(() => niceTicks(Number.NaN, 1)).toThrow(RangeError);
    expect(() => niceTicks(0, 1, 0)).toThrow(RangeError);
  });
});

describe('helpers', () => {
  it('counts the decimals of a step', () => {
    expect(decimalsOf(50)).toBe(0);
    expect(decimalsOf(0.25)).toBe(2);
    expect(decimalsOf(0.1)).toBe(1);
  });

  it('skips missing values instead of treating them as zero', () => {
    expect(finiteValues([1, null, undefined, Number.NaN, 3])).toEqual([1, 3]);
    expect(extent([null, 4, 2, undefined])).toEqual([2, 4]);
    expect(extent([null])).toBeNull();
  });
});
