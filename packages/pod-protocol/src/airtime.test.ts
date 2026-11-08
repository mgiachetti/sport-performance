import { describe, expect, it } from 'vitest';

import { holdoverS, loraTimeOnAirMs, slotStartMs, tdmaCapacity } from './airtime.js';
import { FRAME_MS, GUARD_MS, LIVE_PACKET_LENGTH, LIVE_RADIO, SLOT_MS } from './constants.js';

/** The numbers ADR 0105 and ADR 0106 rely on. */
describe('airtime and capacity (ADR 0106)', () => {
  it('a 51 B live packet at SF7 / 125 kHz / CR 4/5 is ≈ 102,7 ms', () => {
    expect(LIVE_PACKET_LENGTH).toBe(51);
    expect(loraTimeOnAirMs(51)).toBeCloseTo(102.656, 3);
  });

  it('a 48 B beacon is ≈ 97,5 ms and the 40 B packet of ADR 0105 ≈ 82 ms', () => {
    expect(loraTimeOnAirMs(48)).toBeCloseTo(97.536, 3);
    expect(loraTimeOnAirMs(40)).toBeCloseTo(82.176, 3);
  });

  it('the live packet fits a 115 ms slot with ±3 ms of guard and switching margin', () => {
    const switchingMs = SLOT_MS - loraTimeOnAirMs(LIVE_PACKET_LENGTH) - 2 * GUARD_MS;
    expect(switchingMs).toBeGreaterThan(5);
  });

  it('16 slots per channel after the 120 ms beacon window, 15 granted: 120 pods in 8 channels', () => {
    expect(tdmaCapacity()).toEqual({ slotsPerChannel: 16, uplinkSlotsPerChannel: 15, pods: 120 });
    expect(slotStartMs(0)).toBe(120);
    expect(slotStartMs(15) + SLOT_MS).toBeLessThanOrEqual(FRAME_MS);
    expect(() => slotStartMs(16)).toThrow();
  });

  it('holdover with ±3 ms of guard and a ±20 ppm clock is 150 s (≈ 2,5 min)', () => {
    expect(holdoverS()).toBeCloseTo(150, 6);
  });

  it('the 500 kHz branch (if ENACOM asks for hopping) is ≈ 25 ms for the same packet', () => {
    expect(loraTimeOnAirMs(51, { ...LIVE_RADIO, bandwidthHz: 500_000 })).toBeCloseTo(25.664, 3);
  });

  it('turns low data rate optimisation on by itself at SF12 / 125 kHz', () => {
    const auto = loraTimeOnAirMs(20, { ...LIVE_RADIO, spreadingFactor: 12 });
    const forced = loraTimeOnAirMs(20, {
      ...LIVE_RADIO,
      spreadingFactor: 12,
      lowDataRateOptimize: true,
    });
    expect(auto).toBe(forced);
    // Tsym = 32,768 ms; preamble 12,25 symbols; payload 8 + ceil(156 / 40)·5 = 28 symbols.
    expect(auto).toBeCloseTo((12.25 + 28) * 32.768, 6);
    // 30 B: with LDRO ceil(236 / 40) = 6 blocks, without ceil(236 / 48) = 5.
    const sf12 = { ...LIVE_RADIO, spreadingFactor: 12 };
    expect(loraTimeOnAirMs(30, sf12)).toBeCloseTo((12.25 + 38) * 32.768, 6);
    expect(loraTimeOnAirMs(30, { ...sf12, lowDataRateOptimize: false })).toBeCloseTo(
      (12.25 + 33) * 32.768,
      6,
    );
  });
});
