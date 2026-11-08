import { assertUint } from './bytes.js';
import { fail } from './errors.js';

const LOW_MODULUS = 0x1_0000;
const HALF_WINDOW = 0x8000;
export const MAX_BOOT_COUNTER = 0xffff_ffff;
export const MAX_FRAME_NUMBER = 0xffff;

/**
 * Rebuilds the 32-bit boot counter from the 16 low bits in the clear header,
 * following the last value seen for the pod (ADR 0106): the candidate nearest
 * to `reference` within ±32 768 boots. Boot counters only go up, so a
 * candidate below the reference is an old packet and anti-replay rejects it.
 *
 * Without a reference (first contact, nothing persisted) the high bits are
 * taken as `0`; the server should hand the tablet the last boot counter it
 * saw at the base so that case does not happen in practice. A wrong guess only
 * fails the MIC (the nonce carries the full 32 bits), it never decodes garbage.
 */
export function reconstructBootCounter(
  bootCounterLow16: number,
  reference: number | undefined,
): number {
  assertUint('bootCounterLow16', bootCounterLow16, 16);
  if (reference === undefined) {
    return bootCounterLow16;
  }
  assertUint('reference', reference, 32);
  const base = reference - (reference % LOW_MODULUS);
  let candidate = base + bootCounterLow16;
  if (candidate + HALF_WINDOW < reference) {
    candidate += LOW_MODULUS;
  } else if (candidate > reference + HALF_WINDOW) {
    candidate -= LOW_MODULUS;
  }
  if (candidate < 0) {
    candidate += LOW_MODULUS;
  }
  if (candidate > MAX_BOOT_COUNTER) {
    fail('boot_counter_exhausted', 'reconstructed boot counter past 2^32 − 1');
  }
  return candidate;
}

export function bootCounterLow16(bootCounter: number): number {
  assertUint('bootCounter', bootCounter, 32);
  return bootCounter % LOW_MODULUS;
}

export interface LinkCounter {
  bootCounter: number;
  frameNumber: number;
}

export interface NextLinkCounter extends LinkCounter {
  /** The boot counter moved: the pod must persist it (NVS/ZMS) **before** transmitting. */
  persistBootCounter: boolean;
}

/**
 * Reference implementation of the pod's counter rule (the firmware mirrors it):
 * the frame number goes up by one per uplink; before it would wrap (after
 * 0xFFFF, about 36 h at one uplink every 2 s) the pod increments and persists
 * the boot counter and starts again at frame 0. If the boot counter itself
 * would wrap inside an epoch the pod stops transmitting until the base rotates
 * the key (`boot_counter_exhausted`).
 */
export function nextLinkCounter(current: LinkCounter): NextLinkCounter {
  assertUint('bootCounter', current.bootCounter, 32);
  assertUint('frameNumber', current.frameNumber, 16);
  if (current.frameNumber < MAX_FRAME_NUMBER) {
    return {
      bootCounter: current.bootCounter,
      frameNumber: current.frameNumber + 1,
      persistBootCounter: false,
    };
  }
  if (current.bootCounter >= MAX_BOOT_COUNTER) {
    fail(
      'boot_counter_exhausted',
      'boot counter would wrap inside the key epoch: rotate keys at the base',
    );
  }
  return { bootCounter: current.bootCounter + 1, frameNumber: 0, persistBootCounter: true };
}

/** Strict order of (boot counter, frame number): the only one anti-replay accepts. */
export function isAfter(candidate: LinkCounter, last: LinkCounter): boolean {
  return (
    candidate.bootCounter > last.bootCounter ||
    (candidate.bootCounter === last.bootCounter && candidate.frameNumber > last.frameNumber)
  );
}
