/**
 * Deterministic randomness of the demo data (B-307, ADR 0055).
 *
 * Every value of the demo dataset is a pure function of the seed and the
 * natural key of what it describes (a player, a player's wellness of one
 * day, an attempt of a test). Nothing depends on iteration order or on how
 * far the dataset reaches (`asOf`), so generating the same day twice, a year
 * apart, yields the same row: that is what makes re-running the seed a
 * no-op and extending it to a later day append-only.
 */

/** A seeded generator: `sfc32` seeded with a 128-bit hash of the key. */
export interface Random {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  float(min: number, max: number): number;
  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** Normal with the given mean and standard deviation (Box-Muller). */
  normal(mean: number, sd: number): number;
  /** `true` with probability `p`. */
  chance(p: number): boolean;
  /** A uniformly chosen element. Throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** A new permutation of `items` (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[];
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * 128-bit hash of a key (`cyrb128`, four mixed 32-bit lanes). Not
 * cryptographic and it does not need to be: it only spreads keys of demo
 * data, and it is fast enough for the hundreds of thousands of ids and
 * generators a dataset needs (SHA-256 took most of the generation time).
 * Stable across platforms: plain 32-bit integer arithmetic.
 */
function hash128(key: readonly (string | number)[]): [number, number, number, number] {
  const text = key.map(String).join('\u001f');
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function hex32(n: number): string {
  return n.toString(16).padStart(8, '0');
}

/** The generator of one key: same key, same sequence, on every platform. */
export function randomFor(...key: readonly (string | number)[]): Random {
  const [a, b, c, d] = hash128(key);
  const next = sfc32(a, b, c, d);
  // Warm up: the first outputs of sfc32 are correlated with the state.
  for (let i = 0; i < 12; i++) next();
  const random: Random = {
    next,
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    normal: (mean, sd) => {
      const u = 1 - next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick() of an empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j] as (typeof copy)[number], copy[i] as (typeof copy)[number]];
      }
      return copy;
    },
  };
  return random;
}

/**
 * A stable UUID for a key, formatted as a version 8 (custom) RFC 9562 UUID.
 * The demo uses it for ids and `client_uuid`s, so a row generated twice has
 * the same id and the second insert is a no-op.
 */
export function stableUuid(...key: readonly (string | number)[]): string {
  const [a, b, c, d] = hash128(key);
  const hex = hex32(a) + hex32(b) + hex32(c) + hex32(d);
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Short stable tag of a key (8 hex characters), for readable demo emails. */
export function shortTag(...key: readonly (string | number)[]): string {
  return hex32(hash128(['tag', ...key])[0]);
}

/** Rounds to `decimals` places (the precision a staff member would type). */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
