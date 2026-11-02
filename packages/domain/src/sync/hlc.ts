import { DomainValidationError, describeValue } from '../errors.js';

/**
 * Hybrid logical clock (ADR 0015, B-323). Every offline mutation carries
 * one: the physical time of the device in milliseconds, a logical counter
 * and the id of the node (device) that stamped it. The clock never goes
 * back, also when the device's time does, and it advances with every clock
 * it receives from the server, so it gives a total order across devices.
 *
 * Text form: `PPPPPPPPPPPPPPP-CCCCCC-NODE`, physical time and counter
 * zero-padded to a fixed width, so comparing two clocks as text (binary
 * order, `COLLATE "C"` in Postgres) is the same as {@link compareHlc}. The
 * database stores and compares them in that form.
 */

/** Width of the physical part: milliseconds since the epoch, up to year 33658. */
const PHYSICAL_DIGITS = 15;
/** Width of the counter. */
const COUNTER_DIGITS = 6;
export const HLC_PHYSICAL_MAX = 10 ** PHYSICAL_DIGITS - 1;
export const HLC_COUNTER_MAX = 10 ** COUNTER_DIGITS - 1;

/** The node of the clocks the server stamps. No device can use it (devices are hex). */
export const SERVER_HLC_NODE = 'server';

/** Node id of a device: 16 to 32 lowercase hex characters (random, per install). */
export const HLC_NODE_PATTERN = /^[0-9a-f]{16,32}$/;

/** Whole text form, device or server node. */
export const HLC_PATTERN = /^\d{15}-\d{6}-(?:[0-9a-f]{16,32}|server)$/;

/** Longest text form of a clock (32-character node). */
export const HLC_MAX_LENGTH = PHYSICAL_DIGITS + 1 + COUNTER_DIGITS + 1 + 32;

/** A parsed clock. */
export interface Hlc {
  /** Milliseconds since the epoch. */
  readonly physicalMs: number;
  readonly counter: number;
  readonly node: string;
}

function invalid(value: unknown, why: string): never {
  throw new DomainValidationError(
    'invalid_argument',
    `Invalid HLC ${describeValue(value)}: ${why}`,
    value,
  );
}

function checkParts(hlc: Hlc): Hlc {
  if (
    !Number.isSafeInteger(hlc.physicalMs) ||
    hlc.physicalMs < 0 ||
    hlc.physicalMs > HLC_PHYSICAL_MAX
  ) {
    invalid(hlc.physicalMs, 'physical time out of range');
  }
  if (!Number.isSafeInteger(hlc.counter) || hlc.counter < 0 || hlc.counter > HLC_COUNTER_MAX) {
    invalid(hlc.counter, 'counter out of range');
  }
  if (hlc.node !== SERVER_HLC_NODE && !HLC_NODE_PATTERN.test(hlc.node)) {
    invalid(hlc.node, 'node must be 16 to 32 lowercase hex characters');
  }
  return hlc;
}

/** Whether `value` is the text form of a clock. */
export function isHlc(value: unknown): value is string {
  return typeof value === 'string' && HLC_PATTERN.test(value);
}

/** Parses the text form; throws `DomainValidationError` (`invalid_argument`). */
export function parseHlc(text: unknown): Hlc {
  if (!isHlc(text)) invalid(text, 'expected PPPPPPPPPPPPPPP-CCCCCC-node');
  const [physical = '', counter = '', node = ''] = text.split('-');
  return checkParts({ physicalMs: Number(physical), counter: Number(counter), node });
}

/** The text form of a clock. */
export function formatHlc(hlc: Hlc): string {
  checkParts(hlc);
  const physical = String(hlc.physicalMs).padStart(PHYSICAL_DIGITS, '0');
  const counter = String(hlc.counter).padStart(COUNTER_DIGITS, '0');
  return `${physical}-${counter}-${hlc.node}`;
}

/** Total order: physical time, then counter, then node (binary order of the text). */
export function compareHlc(a: Hlc | string, b: Hlc | string): -1 | 0 | 1 {
  const x = typeof a === 'string' ? parseHlc(a) : a;
  const y = typeof b === 'string' ? parseHlc(b) : b;
  if (x.physicalMs !== y.physicalMs) return x.physicalMs < y.physicalMs ? -1 : 1;
  if (x.counter !== y.counter) return x.counter < y.counter ? -1 : 1;
  if (x.node === y.node) return 0;
  return x.node < y.node ? -1 : 1;
}

/** The `(physicalMs, counter)` right after the given one, carrying into the next ms. */
function next(physicalMs: number, counter: number): { physicalMs: number; counter: number } {
  if (counter < HLC_COUNTER_MAX) return { physicalMs, counter: counter + 1 };
  return { physicalMs: physicalMs + 1, counter: 0 };
}

/**
 * The clock of a local event (a mutation the device records): later than
 * `last` (the device's previous clock, or `null` for the first one) and not
 * earlier than the device's time `nowMs`.
 */
export function tickHlc(last: Hlc | null, nowMs: number, node: string): Hlc {
  const now = Math.floor(nowMs);
  if (last === null || now > last.physicalMs) {
    return checkParts({ physicalMs: now, counter: 0, node });
  }
  return checkParts({ ...next(last.physicalMs, last.counter), node });
}

/**
 * The clock after receiving `remote` (the `serverHlc` of a sync response):
 * later than both the local clock and the remote one, so the next local
 * event orders after everything the device has seen.
 */
export function receiveHlc(local: Hlc | null, remote: Hlc, nowMs: number, node: string): Hlc {
  const now = Math.floor(nowMs);
  const localPhysical = local?.physicalMs ?? -1;
  const physicalMs = Math.max(localPhysical, remote.physicalMs, now);
  if (physicalMs === now && now > localPhysical && now > remote.physicalMs) {
    return checkParts({ physicalMs, counter: 0, node });
  }
  const counter = Math.max(
    physicalMs === localPhysical ? (local?.counter ?? 0) : -1,
    physicalMs === remote.physicalMs ? remote.counter : -1,
  );
  return checkParts({ ...next(physicalMs, counter), node });
}

/**
 * The server never lets a clock ahead of its own time win: a device whose
 * time runs fast would otherwise win every conflict until its clock is
 * fixed. A clock later than `nowMs` is brought back to `nowMs`, keeping its
 * counter and node: the mutation is applied as if made now, never dropped.
 */
export function clampHlc(hlc: Hlc, nowMs: number): { hlc: Hlc; clamped: boolean } {
  const now = Math.floor(nowMs);
  if (hlc.physicalMs <= now) return { hlc, clamped: false };
  return { hlc: checkParts({ ...hlc, physicalMs: now }), clamped: true };
}

/**
 * When a mutation counts as recorded, in ms: the time of its clock (already
 * clamped to the server's), but not more than `maxAgeDays` before `nowMs`.
 */
export function recordedAtMs(hlc: Hlc, nowMs: number, maxAgeDays: number): number {
  return Math.max(hlc.physicalMs, Math.floor(nowMs) - maxAgeDays * 86_400_000);
}

/** The clock the server stamps on its own writes and returns to devices. */
export function serverHlc(nowMs: number): Hlc {
  return checkParts({ physicalMs: Math.floor(nowMs), counter: 0, node: SERVER_HLC_NODE });
}
