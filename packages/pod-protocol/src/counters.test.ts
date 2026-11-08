import { describe, expect, it } from 'vitest';

import { toHex } from './bytes.js';
import { nextLinkCounter, reconstructBootCounter } from './counters.js';
import { PodProtocolError } from './errors.js';
import { linkNonce } from './nonce.js';
import {
  bootCounterReference,
  emptyReplayState,
  forgetEpochs,
  isFresh,
  parseReplayState,
  recordAccepted,
  serializeReplayState,
} from './replay.js';

describe('link nonce', () => {
  it('is boot counter (4 B) ‖ frame (2 B) ‖ direction (1 B), zero-padded to 13 B, little-endian', () => {
    expect(
      toHex(linkNonce({ bootCounter: 0x01020304, frameNumber: 0x0506, direction: 'uplink' })),
    ).toBe('04030201060500000000000000');
    expect(
      toHex(linkNonce({ bootCounter: 0xffffffff, frameNumber: 0xffff, direction: 'downlink' })),
    ).toBe('ffffffffffff01000000000000');
  });
});

describe('reconstructBootCounter', () => {
  it.each([
    { low16: 5, reference: undefined, expected: 5 },
    { low16: 0x1234, reference: 0x1234, expected: 0x1234 },
    { low16: 0x1235, reference: 0x5_1234, expected: 0x5_1235 },
    { low16: 0x0001, reference: 0x5_fffe, expected: 0x6_0001 },
    { low16: 0xfffe, reference: 0x6_0001, expected: 0x5_fffe },
    { low16: 0x9000, reference: 0x1000, expected: 0x9000 },
    { low16: 0x9001, reference: 0x1000, expected: 0x9001 },
    { low16: 0xffff, reference: 0x0000, expected: 0xffff },
  ])('$low16 against $reference → $expected', ({ low16, reference, expected }) => {
    expect(reconstructBootCounter(low16, reference)).toBe(expected);
  });

  it('never goes past 2^32 − 1', () => {
    expect(() => reconstructBootCounter(0x0001, 0xffff_fff0)).toThrow(PodProtocolError);
  });
});

describe('nextLinkCounter', () => {
  it('counts frames and, before the 16-bit frame wraps, moves to the next boot and asks to persist it', () => {
    expect(nextLinkCounter({ bootCounter: 7, frameNumber: 41 })).toEqual({
      bootCounter: 7,
      frameNumber: 42,
      persistBootCounter: false,
    });
    expect(nextLinkCounter({ bootCounter: 7, frameNumber: 0xffff })).toEqual({
      bootCounter: 8,
      frameNumber: 0,
      persistBootCounter: true,
    });
  });

  it('stops when the boot counter would wrap inside the epoch', () => {
    expect(() => nextLinkCounter({ bootCounter: 0xffff_ffff, frameNumber: 0xffff })).toThrow(
      expect.objectContaining({ code: 'boot_counter_exhausted' }),
    );
  });
});

describe('replay state', () => {
  it('orders by (boot, frame) per pod and epoch', () => {
    let state = recordAccepted(emptyReplayState(), 23, 2, { bootCounter: 10, frameNumber: 5 });
    expect(isFresh(state, 23, 2, { bootCounter: 10, frameNumber: 5 })).toBe(false);
    expect(isFresh(state, 23, 2, { bootCounter: 10, frameNumber: 6 })).toBe(true);
    expect(isFresh(state, 23, 2, { bootCounter: 9, frameNumber: 60_000 })).toBe(false);
    expect(isFresh(state, 23, 2, { bootCounter: 11, frameNumber: 0 })).toBe(true);
    // Another epoch and another pod are independent windows.
    expect(isFresh(state, 23, 3, { bootCounter: 1, frameNumber: 0 })).toBe(true);
    expect(isFresh(state, 24, 2, { bootCounter: 1, frameNumber: 0 })).toBe(true);
    expect(() => recordAccepted(state, 23, 2, { bootCounter: 10, frameNumber: 5 })).toThrow(
      expect.objectContaining({ code: 'replay' }),
    );
    state = recordAccepted(state, 23, 3, { bootCounter: 12, frameNumber: 0 });
    expect(bootCounterReference(state, 23)).toBe(12);
    expect(bootCounterReference(state, 23, 50)).toBe(50);
    expect(bootCounterReference(state, 99)).toBeUndefined();
  });

  it('serialises to JSON and parses strictly', () => {
    const state = recordAccepted(
      recordAccepted(emptyReplayState(), 23, 2, { bootCounter: 70_000, frameNumber: 9 }),
      41,
      2,
      {
        bootCounter: 3,
        frameNumber: 0,
      },
    );
    expect(parseReplayState(serializeReplayState(state))).toEqual(state);
    expect(() => parseReplayState('{"version":2,"entries":{}}')).toThrow(PodProtocolError);
    expect(() =>
      parseReplayState('{"version":1,"entries":{"x":{"bootCounter":1,"frameNumber":1}}}'),
    ).toThrow(PodProtocolError);
    expect(() =>
      parseReplayState('{"version":1,"entries":{"1/1":{"bootCounter":1,"frameNumber":70000}}}'),
    ).toThrow(PodProtocolError);
    expect(() => parseReplayState('null')).toThrow(PodProtocolError);
  });

  it('rejects non-canonical keys and arrays', () => {
    const entry = '{"bootCounter":1,"frameNumber":1}';
    for (const json of [
      `{"version":1,"entries":{"023/2":${entry}}}`,
      `{"version":1,"entries":{"23/02":${entry}}}`,
      '{"version":1,"entries":[]}',
      '[]',
      '{"version":1,"entries":{"23/2":[1,1]}}',
    ]) {
      expect(() => parseReplayState(json)).toThrow(PodProtocolError);
    }
  });

  it('a newer server hint moves the reference forward over the own entry', () => {
    const state = recordAccepted(emptyReplayState(), 23, 2, { bootCounter: 10, frameNumber: 5 });
    expect(bootCounterReference(state, 23)).toBe(10);
    expect(bootCounterReference(state, 23, 500)).toBe(500);
    expect(bootCounterReference(state, 23, 3)).toBe(10);
  });

  it('forgets old epochs', () => {
    const state = recordAccepted(
      recordAccepted(emptyReplayState(), 23, 1, { bootCounter: 1, frameNumber: 1 }),
      23,
      2,
      {
        bootCounter: 2,
        frameNumber: 1,
      },
    );
    expect(Object.keys(forgetEpochs(state, (_, keyId) => keyId >= 2).entries)).toEqual(['23/2']);
  });
});
