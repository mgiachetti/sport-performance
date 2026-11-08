import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STREAM_PROFILE,
  hoursPerChip,
  pagesForStreamBytes,
  pagesPerHour,
  profileStreamRateBps,
  RAW_GNSS_STREAM_PROFILE,
  segmentBlocks,
  sessionsPerChip,
  usableBlocks,
} from './capacity.js';
import { W25N02KV, W25N04KV } from './constants.js';

const THREE_HOURS_S = 3 * 3600;

describe('log size math', () => {
  it('a page carries 1996 B of stream (2,5 % of overhead)', () => {
    expect(pagesForStreamBytes(1996)).toBe(1);
    expect(pagesForStreamBytes(1997)).toBe(2);
    expect(1 - 1996 / 2048).toBeCloseTo(0.0254, 4);
  });

  it('pages per hour at the rates of pod-f3.md', () => {
    expect(pagesPerHour(2500)).toBe(4510);
    expect(pagesPerHour(4500)).toBe(8117);
  });

  it('sessions of 3 h per chip: ≈ 18 without raw GNSS and 10 with it on 4 Gbit', () => {
    expect(usableBlocks(W25N04KV)).toBe(4006);
    expect(segmentBlocks(2500, THREE_HOURS_S)).toBe(212);
    expect(segmentBlocks(4500, THREE_HOURS_S)).toBe(381);
    expect(sessionsPerChip({ streamRateBps: 2500, sessionDurationS: THREE_HOURS_S })).toBe(18);
    expect(sessionsPerChip({ streamRateBps: 4500, sessionDurationS: THREE_HOURS_S })).toBe(10);
    // 2 Gbit: about half.
    expect(
      sessionsPerChip({ streamRateBps: 4500, sessionDurationS: THREE_HOURS_S, geometry: W25N02KV }),
    ).toBe(5);
    expect(hoursPerChip(2500)).toBeCloseTo(56.85, 2);
    expect(hoursPerChip(4500)).toBeCloseTo(31.59, 2);
  });

  it('the v1 records add ≈ 14 % to the sensor data (headers and timestamps)', () => {
    const plain = profileStreamRateBps(DEFAULT_STREAM_PROFILE);
    const raw = profileStreamRateBps(RAW_GNSS_STREAM_PROFILE);
    expect(plain).toBeCloseTo(2859.9, 1);
    expect(raw).toBeCloseTo(4875.9, 1);
    expect(pagesPerHour(plain)).toBe(5159);
    expect(pagesPerHour(raw)).toBe(8795);
    expect(sessionsPerChip({ streamRateBps: plain, sessionDurationS: THREE_HOURS_S })).toBe(16);
    expect(sessionsPerChip({ streamRateBps: raw, sessionDurationS: THREE_HOURS_S })).toBe(9);
    expect(hoursPerChip(raw)).toBeCloseTo(29.15, 2);
  });
});
