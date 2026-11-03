/** A point in chart pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Pixel coordinate rounded to 2 decimals: short, stable SVG paths. */
export function px(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * SVG path through the points. A `null` (missing value) breaks the line: the gap stays visible
 * instead of joining across it. An isolated point yields a bare `M` (drawn by its marker).
 */
export function linePath(points: readonly (Point | null)[]): string {
  const parts: string[] = [];
  let penDown = false;
  for (const point of points) {
    if (point === null) {
      penDown = false;
      continue;
    }
    parts.push(`${penDown ? 'L' : 'M'}${px(point.x)} ${px(point.y)}`);
    penDown = true;
  }
  return parts.join('');
}

/** Corner radius of the data end of a bar (the baseline end stays square). */
export const BAR_RADIUS_PX = 4;
/** Bars never get thicker than this; the rest of the slot stays as air. */
export const BAR_MAX_WIDTH_PX = 24;

export interface BarShape {
  /** Left edge. */
  readonly x: number;
  readonly width: number;
  /** Pixel of the zero line. */
  readonly baselineY: number;
  /** Pixel of the value (above the baseline for positives, below for negatives). */
  readonly valueY: number;
  readonly radius?: number;
}

/**
 * Column grown from the baseline with a rounded data end and a square base, for positive and
 * negative values. Zero-height bars produce an empty path.
 */
export function barPath({ x, width, baselineY, valueY, radius = BAR_RADIUS_PX }: BarShape): string {
  const height = Math.abs(baselineY - valueY);
  if (height === 0 || width <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  const right = x + width;
  if (valueY < baselineY) {
    // Positive: rounded top.
    return (
      `M${px(x)} ${px(baselineY)}V${px(valueY + r)}` +
      `Q${px(x)} ${px(valueY)} ${px(x + r)} ${px(valueY)}` +
      `H${px(right - r)}Q${px(right)} ${px(valueY)} ${px(right)} ${px(valueY + r)}` +
      `V${px(baselineY)}Z`
    );
  }
  // Negative: rounded bottom.
  return (
    `M${px(x)} ${px(baselineY)}V${px(valueY - r)}` +
    `Q${px(x)} ${px(valueY)} ${px(x + r)} ${px(valueY)}` +
    `H${px(right - r)}Q${px(right)} ${px(valueY)} ${px(right)} ${px(valueY - r)}` +
    `V${px(baselineY)}Z`
  );
}

/**
 * Index of the position closest to `x` (positions sorted ascending). Used by the crosshair: the
 * reader aims at a date, never at a 2 px line.
 */
export function nearestIndex(positions: readonly number[], x: number): number {
  if (positions.length === 0) return -1;
  let lo = 0;
  let hi = positions.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((positions[mid] ?? 0) <= x) lo = mid;
    else hi = mid;
  }
  const dLo = Math.abs((positions[lo] ?? 0) - x);
  const dHi = Math.abs((positions[hi] ?? 0) - x);
  return dHi < dLo ? hi : lo;
}
