import { assertIntRange } from './bytes.js';
import {
  BEACON_WINDOW_MS,
  CHANNELS_PER_NETWORK,
  FRAME_MS,
  GUARD_MS,
  LIVE_RADIO,
  SLOT_MS,
} from './constants.js';
import { fail } from './errors.js';

export interface LoraModulation {
  spreadingFactor: number;
  bandwidthHz: number;
  /** 5..8 for CR 4/5..4/8. */
  codingRateDenominator: number;
  preambleSymbols: number;
  explicitHeader: boolean;
  crc: boolean;
  /** Defaults to on when a symbol lasts 16 ms or more (SF11/SF12 at 125 kHz). */
  lowDataRateOptimize?: boolean;
}

/**
 * Time on air of a LoRa packet, Semtech's formula (SX1276 datasheet §4.1.1.7,
 * AN1200.13), valid for SF7..SF12:
 *
 * ```
 * Tsym = 2^SF / BW
 * Tpreamble = (n_preamble + 4,25) · Tsym
 * n_payload = 8 + max(ceil((8·PL − 4·SF + 28 + 16·CRC − 20·IH) / (4·(SF − 2·DE))) · CR, 0)
 * T = Tpreamble + n_payload · Tsym
 * ```
 */
export function loraTimeOnAirMs(
  payloadLengthB: number,
  modulation: LoraModulation = LIVE_RADIO,
): number {
  assertIntRange('payloadLengthB', payloadLengthB, 0, 255);
  assertIntRange('spreadingFactor', modulation.spreadingFactor, 7, 12);
  assertIntRange('codingRateDenominator', modulation.codingRateDenominator, 5, 8);
  assertIntRange('preambleSymbols', modulation.preambleSymbols, 6, 0xffff);
  if (modulation.bandwidthHz <= 0) {
    fail('field_out_of_range', 'bandwidthHz must be positive');
  }
  const sf = modulation.spreadingFactor;
  const symbolMs = (2 ** sf / modulation.bandwidthHz) * 1000;
  const lowDataRate = modulation.lowDataRateOptimize ?? symbolMs >= 16;
  const numerator =
    8 * payloadLengthB -
    4 * sf +
    28 +
    (modulation.crc ? 16 : 0) -
    (modulation.explicitHeader ? 0 : 20);
  const payloadSymbols =
    8 +
    Math.max(
      Math.ceil(numerator / (4 * (sf - (lowDataRate ? 2 : 0)))) * modulation.codingRateDenominator,
      0,
    );
  return (modulation.preambleSymbols + 4.25) * symbolMs + payloadSymbols * symbolMs;
}

export interface TdmaPlan {
  frameMs: number;
  beaconWindowMs: number;
  slotMs: number;
  channels: number;
  contentionSlotsPerChannel: number;
}

export const DEFAULT_TDMA_PLAN: TdmaPlan = {
  frameMs: FRAME_MS,
  beaconWindowMs: BEACON_WINDOW_MS,
  slotMs: SLOT_MS,
  channels: CHANNELS_PER_NETWORK,
  contentionSlotsPerChannel: 1,
};

/** Slots per channel after the beacon window, uplink slots without contention, and pods per gateway. */
export function tdmaCapacity(plan: TdmaPlan = DEFAULT_TDMA_PLAN): {
  slotsPerChannel: number;
  uplinkSlotsPerChannel: number;
  pods: number;
} {
  const slotsPerChannel = Math.floor((plan.frameMs - plan.beaconWindowMs) / plan.slotMs);
  const uplinkSlotsPerChannel = Math.max(slotsPerChannel - plan.contentionSlotsPerChannel, 0);
  return { slotsPerChannel, uplinkSlotsPerChannel, pods: uplinkSlotsPerChannel * plan.channels };
}

/** Offset of a slot from the start of the frame (slot 0 = contention). */
export function slotStartMs(slot: number, plan: TdmaPlan = DEFAULT_TDMA_PLAN): number {
  assertIntRange('slot', slot, 0, tdmaCapacity(plan).slotsPerChannel - 1);
  return plan.beaconWindowMs + slot * plan.slotMs;
}

/**
 * Holdover without PPS nor beacon: how long the 32,768 kHz clock (±ppm) stays
 * inside the guard. 3 ms at 20 ppm → 150 s (≈ 2,5 min).
 */
export function holdoverS(guardMs: number = GUARD_MS, clockPpm = 20): number {
  if (guardMs <= 0 || clockPpm <= 0) {
    fail('field_out_of_range', 'guard and clock tolerance must be positive');
  }
  return guardMs / 1000 / (clockPpm * 1e-6);
}
