import { describe, expect, it } from 'vitest';
import { formatDuration } from './duration.js';
import { PLACEHOLDER } from './number.js';

describe('formatDuration', () => {
  it('formats m:ss below one hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(275)).toBe('4:35');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('formats h:mm:ss from one hour', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(5025)).toBe('1:23:45');
  });

  it('rounds to the nearest second, carrying over', () => {
    expect(formatDuration(274.6)).toBe('4:35');
    expect(formatDuration(59.5)).toBe('1:00');
    expect(formatDuration(3599.7)).toBe('1:00:00');
  });

  it('handles negatives without -0:00', () => {
    expect(formatDuration(-90)).toBe('-1:30');
    expect(formatDuration(-0.2)).toBe('0:00');
  });

  it('renders a placeholder for missing values', () => {
    expect(formatDuration(null)).toBe(PLACEHOLDER);
    expect(formatDuration(Number.NaN)).toBe(PLACEHOLDER);
  });
});
