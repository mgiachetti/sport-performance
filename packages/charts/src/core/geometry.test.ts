import { describe, expect, it } from 'vitest';
import { barPath, linePath, nearestIndex, px } from './geometry.js';
import { estimateTextWidth, visibleLabelIndexes } from './text.js';

describe('linePath', () => {
  it('joins consecutive points', () => {
    expect(
      linePath([
        { x: 0, y: 10 },
        { x: 5.555, y: 20 },
      ]),
    ).toBe('M0 10L5.56 20');
  });

  it('breaks the line at missing values instead of bridging them', () => {
    expect(linePath([{ x: 0, y: 0 }, null, { x: 2, y: 2 }, { x: 3, y: 3 }])).toBe('M0 0M2 2L3 3');
    expect(linePath([])).toBe('');
  });
});

describe('barPath', () => {
  it('rounds the data end and keeps the base square (positive)', () => {
    const d = barPath({ x: 10, width: 20, baselineY: 100, valueY: 40 });
    expect(d.startsWith('M10 100V44Q10 40 14 40')).toBe(true);
    expect(d.endsWith('V100Z')).toBe(true);
  });

  it('grows downwards for negative values with the rounding at the bottom', () => {
    const d = barPath({ x: 0, width: 10, baselineY: 50, valueY: 80 });
    expect(d).toBe('M0 50V76Q0 80 4 80H6Q10 80 10 76V50Z');
  });

  it('caps the radius on short and thin bars and draws nothing at zero', () => {
    expect(barPath({ x: 0, width: 4, baselineY: 10, valueY: 9 })).toContain('Q0 9 1 9');
    expect(barPath({ x: 0, width: 4, baselineY: 10, valueY: 10 })).toBe('');
  });
});

describe('nearestIndex', () => {
  it('snaps to the closest position', () => {
    const positions = [0, 10, 20, 30];
    expect(nearestIndex(positions, -5)).toBe(0);
    expect(nearestIndex(positions, 14)).toBe(1);
    expect(nearestIndex(positions, 16)).toBe(2);
    expect(nearestIndex(positions, 99)).toBe(3);
    expect(nearestIndex([], 3)).toBe(-1);
  });
});

describe('labels', () => {
  it('rounds pixels and never prints -0', () => {
    expect(px(-0.001)).toBe('0');
    expect(px(1.005)).toBe('1');
  });

  it('estimates wider text for more characters', () => {
    expect(estimateTextWidth('1.980')).toBeLessThan(estimateTextWidth('12 oct 2026'));
  });

  it('thins crowded labels counting back from the latest one', () => {
    const positions = Array.from({ length: 28 }, (_, i) => i * 10);
    const labels = positions.map((_, i) => `${String(i + 1)} oct`);
    const shown = visibleLabelIndexes(positions, labels);
    expect(shown.at(-1)).toBe(27);
    expect(shown.length).toBeLessThan(28);
    const gaps = shown.slice(1).map((index, i) => index - (shown[i] ?? 0));
    expect(new Set(gaps).size).toBe(1);
  });

  it('keeps every label when there is room', () => {
    expect(visibleLabelIndexes([0, 100, 200], ['V1', 'V2', 'V3'])).toEqual([0, 1, 2]);
  });
});
