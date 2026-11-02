import { describe, expect, it } from 'vitest';
import { DomainValidationError } from '../errors.js';
import {
  HLC_COUNTER_MAX,
  HLC_MAX_LENGTH,
  SERVER_HLC_NODE,
  clampHlc,
  compareHlc,
  formatHlc,
  isHlc,
  parseHlc,
  receiveHlc,
  recordedAtMs,
  serverHlc,
  tickHlc,
  type Hlc,
} from './hlc.js';

const NODE_A = '0123456789abcdef';
const NODE_B = 'fedcba9876543210';
const T = Date.UTC(2026, 10, 2, 12, 0, 0);

describe('hlc text form', () => {
  it('round-trips with fixed width', () => {
    const hlc: Hlc = { physicalMs: T, counter: 7, node: NODE_A };
    const text = formatHlc(hlc);
    expect(text).toBe(`00${String(T)}-000007-${NODE_A}`);
    expect(parseHlc(text)).toEqual(hlc);
    expect(isHlc(text)).toBe(true);
  });

  it('accepts the server node and the longest device node', () => {
    expect(parseHlc(formatHlc(serverHlc(T))).node).toBe(SERVER_HLC_NODE);
    const long = formatHlc({ physicalMs: T, counter: 0, node: 'a'.repeat(32) });
    expect(long).toHaveLength(HLC_MAX_LENGTH);
  });

  it.each([
    '',
    'nope',
    `${String(T)}-000000-${NODE_A}`, // physical not padded
    `00${String(T)}-0-${NODE_A}`, // counter not padded
    `00${String(T)}-000000-ABCDEF0123456789`, // uppercase node
    `00${String(T)}-000000-0123`, // node too short
    `00${String(T)}-000000-${'a'.repeat(33)}`, // node too long
    `00${String(T)}-000000-servers`,
  ])('rejects %j', (text) => {
    expect(isHlc(text)).toBe(false);
    expect(() => parseHlc(text)).toThrow(DomainValidationError);
  });

  it('rejects malformed parts when formatting', () => {
    expect(() => formatHlc({ physicalMs: -1, counter: 0, node: NODE_A })).toThrow();
    expect(() =>
      formatHlc({ physicalMs: T, counter: HLC_COUNTER_MAX + 1, node: NODE_A }),
    ).toThrow();
    expect(() => formatHlc({ physicalMs: T, counter: 0, node: 'phone' })).toThrow();
  });
});

describe('compareHlc', () => {
  const at = (physicalMs: number, counter: number, node = NODE_A) =>
    formatHlc({ physicalMs, counter, node });

  it('orders by physical time, counter and node', () => {
    expect(compareHlc(at(T, 5), at(T + 1, 0))).toBe(-1);
    expect(compareHlc(at(T, 2), at(T, 1))).toBe(1);
    expect(compareHlc(at(T, 1, NODE_A), at(T, 1, NODE_B))).toBe(-1);
    expect(compareHlc(at(T, 1), at(T, 1))).toBe(0);
  });

  it('is the binary order of the text (what Postgres compares with COLLATE "C")', () => {
    const clocks = [
      at(T + 1000, 0),
      at(T, 999_999),
      at(T, 10),
      at(T, 9, NODE_B),
      at(T, 9, NODE_A),
      formatHlc(serverHlc(T)),
      at(1, 0),
    ];
    const byCompare = [...clocks].sort((a, b) => compareHlc(a, b));
    const byText = [...clocks].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(byText).toEqual(byCompare);
  });
});

describe('tickHlc', () => {
  it('follows the device time when it moves forward', () => {
    expect(tickHlc(null, T, NODE_A)).toEqual({ physicalMs: T, counter: 0, node: NODE_A });
    const last = { physicalMs: T, counter: 3, node: NODE_A };
    expect(tickHlc(last, T + 5, NODE_A)).toEqual({ physicalMs: T + 5, counter: 0, node: NODE_A });
  });

  it('never goes back when the device time stalls or goes back', () => {
    const last = { physicalMs: T, counter: 3, node: NODE_A };
    expect(tickHlc(last, T, NODE_A)).toEqual({ physicalMs: T, counter: 4, node: NODE_A });
    const back = tickHlc(last, T - 60_000, NODE_A);
    expect(compareHlc(back, last)).toBe(1);
    expect(back).toEqual({ physicalMs: T, counter: 4, node: NODE_A });
  });

  it('carries a full counter into the next millisecond', () => {
    const last = { physicalMs: T, counter: HLC_COUNTER_MAX, node: NODE_A };
    expect(tickHlc(last, T, NODE_A)).toEqual({ physicalMs: T + 1, counter: 0, node: NODE_A });
  });

  it('is strictly increasing over many events', () => {
    let clock: Hlc | null = null;
    let previous: Hlc | null = null;
    for (let i = 0; i < 50; i += 1) {
      clock = tickHlc(clock, T + (i % 3 === 0 ? -i : 0), NODE_A);
      if (previous !== null) expect(compareHlc(clock, previous)).toBe(1);
      previous = clock;
    }
  });
});

describe('receiveHlc', () => {
  it('jumps ahead of a remote clock later than the device', () => {
    const local = { physicalMs: T, counter: 2, node: NODE_A };
    const remote = { physicalMs: T + 10_000, counter: 4, node: SERVER_HLC_NODE };
    const after = receiveHlc(local, remote, T + 1, NODE_A);
    expect(after).toEqual({ physicalMs: T + 10_000, counter: 5, node: NODE_A });
    expect(compareHlc(tickHlc(after, T + 2, NODE_A), remote)).toBe(1);
  });

  it('keeps the local clock when it is later', () => {
    const local = { physicalMs: T + 50, counter: 2, node: NODE_A };
    const remote = { physicalMs: T, counter: 9, node: SERVER_HLC_NODE };
    expect(receiveHlc(local, remote, T, NODE_A)).toEqual({
      physicalMs: T + 50,
      counter: 3,
      node: NODE_A,
    });
  });

  it('uses the device time when it is the latest', () => {
    const remote = { physicalMs: T, counter: 9, node: SERVER_HLC_NODE };
    expect(receiveHlc(null, remote, T + 1, NODE_A)).toEqual({
      physicalMs: T + 1,
      counter: 0,
      node: NODE_A,
    });
  });

  it('takes the larger counter on a tie of the physical time', () => {
    const local = { physicalMs: T, counter: 2, node: NODE_A };
    const remote = { physicalMs: T, counter: 8, node: SERVER_HLC_NODE };
    expect(receiveHlc(local, remote, T, NODE_A).counter).toBe(9);
  });
});

describe('clampHlc', () => {
  it('brings a clock ahead of the server back to the server time', () => {
    const ahead = { physicalMs: T + 3_600_000, counter: 4, node: NODE_A };
    expect(clampHlc(ahead, T)).toEqual({
      hlc: { physicalMs: T, counter: 4, node: NODE_A },
      clamped: true,
    });
  });

  it('leaves a clock at or before the server time alone', () => {
    const ok = { physicalMs: T, counter: 4, node: NODE_A };
    expect(clampHlc(ok, T)).toEqual({ hlc: ok, clamped: false });
  });
});

describe('recordedAtMs', () => {
  const DAY = 86_400_000;
  it('is the time of the clock when it is recent', () => {
    expect(recordedAtMs({ physicalMs: T - 2 * DAY, counter: 0, node: NODE_A }, T, 7)).toBe(
      T - 2 * DAY,
    );
  });
  it('never goes further back than the limit', () => {
    expect(recordedAtMs({ physicalMs: T - 30 * DAY, counter: 3, node: NODE_A }, T, 7)).toBe(
      T - 7 * DAY,
    );
  });
});
