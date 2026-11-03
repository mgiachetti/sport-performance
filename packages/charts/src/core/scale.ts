/** A linear mapping from data values to pixels. */
export interface LinearScale {
  (value: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  invert(pixel: number): number;
}

/**
 * Linear scale. A degenerate domain (`min === max`) maps every value to the middle of the range
 * instead of dividing by zero.
 */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const scale = ((value: number) =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
  Object.defineProperties(scale, {
    domain: { value: [d0, d1] as const },
    range: { value: [r0, r1] as const },
    invert: {
      value: (pixel: number) => (r1 === r0 ? d0 : d0 + ((pixel - r0) / (r1 - r0)) * span),
    },
  });
  return scale;
}

/** Decimals needed to write `step` exactly (0.25 → 2, 50 → 0). */
export function decimalsOf(step: number): number {
  for (let decimals = 0; decimals <= 10; decimals += 1) {
    if (Math.abs(Number(step.toFixed(decimals)) - step) < 1e-9 * Math.max(1, Math.abs(step))) {
      return decimals;
    }
  }
  return 10;
}

const NICE_FACTORS = [1, 2, 2.5, 5, 10] as const;

function niceStep(rawStep: number): number {
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const fraction = rawStep / magnitude;
  const factor = NICE_FACTORS.find((candidate) => fraction <= candidate + 1e-9) ?? 10;
  return Number((factor * magnitude).toPrecision(12));
}

export interface NiceTicks {
  /** Domain extended to whole steps: the axis starts and ends on a tick. */
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly ticks: readonly number[];
  /** Decimals to write every tick the same way. */
  readonly decimals: number;
}

/**
 * Round ticks (multiples of 1, 2, 2,5 or 5 × 10ⁿ) covering `[min, max]` with at most `maxTicks`
 * intervals. A single value gets a small span around it so it does not sit on the axis edge.
 */
export function niceTicks(min: number, max: number, maxTicks = 5): NiceTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new RangeError('niceTicks needs finite bounds');
  }
  if (!Number.isInteger(maxTicks) || maxTicks < 1) {
    throw new RangeError('maxTicks must be a positive integer');
  }
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
    if (min >= 0 && lo < 0) lo = 0;
  }

  let step = niceStep((hi - lo) / maxTicks);
  let start = Math.floor(lo / step + 1e-9) * step;
  let end = Math.ceil(hi / step - 1e-9) * step;
  while (Math.round((end - start) / step) > maxTicks) {
    step = niceStep(step * 1.01);
    start = Math.floor(lo / step + 1e-9) * step;
    end = Math.ceil(hi / step - 1e-9) * step;
  }

  const decimals = decimalsOf(step);
  const count = Math.round((end - start) / step);
  const ticks = Array.from({ length: count + 1 }, (_, i) =>
    Number((start + i * step).toFixed(decimals)),
  ).map((tick) => (Object.is(tick, -0) ? 0 : tick));
  return { min: ticks[0] ?? start, max: ticks.at(-1) ?? end, step, ticks, decimals };
}

/** Finite numbers of a list (missing values are skipped, never treated as zero). */
export function finiteValues(values: Iterable<number | null | undefined>): number[] {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** Min and max of the finite values, or `null` when there are none. */
export function extent(values: Iterable<number | null | undefined>): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of finiteValues(values)) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min === Infinity ? null : [min, max];
}
