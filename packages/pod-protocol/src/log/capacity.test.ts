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

  it('sessions of 3 h per chip: 9 without raw GNSS and 5 with it on the 2 Gbit of the v0', () => {
    expect(usableBlocks(W25N02KV)).toBe(2000);
    expect(usableBlocks()).toBe(2000);
    expect(segmentBlocks(2500, THREE_HOURS_S)).toBe(212);
    expect(segmentBlocks(4500, THREE_HOURS_S)).toBe(381);
    expect(sessionsPerChip({ streamRateBps: 2500, sessionDurationS: THREE_HOURS_S })).toBe(9);
    expect(sessionsPerChip({ streamRateBps: 4500, sessionDurationS: THREE_HOURS_S })).toBe(5);
    expect(hoursPerChip(2500)).toBeCloseTo(28.38, 2);
    expect(hoursPerChip(4500)).toBeCloseTo(15.77, 2);
    // 4 Gbit (higher-capacity variant): about twice.
    expect(usableBlocks(W25N04KV)).toBe(4008);
    expect(
      sessionsPerChip({ streamRateBps: 2500, sessionDurationS: THREE_HOURS_S, geometry: W25N04KV }),
    ).toBe(18);
    expect(
      sessionsPerChip({ streamRateBps: 4500, sessionDurationS: THREE_HOURS_S, geometry: W25N04KV }),
    ).toBe(10);
  });

  it('the v1 records add ≈ 14 % to the sensor data (headers and timestamps)', () => {
    const plain = profileStreamRateBps(DEFAULT_STREAM_PROFILE);
    const raw = profileStreamRateBps(RAW_GNSS_STREAM_PROFILE);
    expect(plain).toBeCloseTo(2859.9, 1);
    expect(raw).toBeCloseTo(4875.9, 1);
    expect(pagesPerHour(plain)).toBe(5159);
    expect(pagesPerHour(raw)).toBe(8795);
    expect(segmentBlocks(plain, THREE_HOURS_S)).toBe(242);
    expect(segmentBlocks(raw, THREE_HOURS_S)).toBe(413);
    // The decision of 2026-11-09: the W25N02KV holds 8 sessions of 3 h (4 with raw GNSS).
    expect(sessionsPerChip({ streamRateBps: plain, sessionDurationS: THREE_HOURS_S })).toBe(8);
    expect(sessionsPerChip({ streamRateBps: raw, sessionDurationS: THREE_HOURS_S })).toBe(4);
    expect(hoursPerChip(plain)).toBeCloseTo(24.81, 2);
    expect(hoursPerChip(raw)).toBeCloseTo(14.55, 2);
    const big = { sessionDurationS: THREE_HOURS_S, geometry: W25N04KV };
    expect(sessionsPerChip({ streamRateBps: plain, ...big })).toBe(16);
    expect(sessionsPerChip({ streamRateBps: raw, ...big })).toBe(9);
  });
});
