/**
 * Small, dependency-free color utilities used to derive accessible tokens.
 *
 * Colors are handled as normalized `#rrggbb` strings (lowercase). Contrast
 * follows WCAG 2.x (relative luminance with the sRGB transfer function).
 */

/** Normalized `#rrggbb` color string. */
export type HexColor = `#${string}`;

export interface Rgb {
  /** Red channel, 0–255. */
  readonly r: number;
  /** Green channel, 0–255. */
  readonly g: number;
  /** Blue channel, 0–255. */
  readonly b: number;
}

/** WCAG 2.x minimum contrast ratios. */
export const CONTRAST = {
  /** Non-text UI (focus rings, functional borders, chart marks). */
  nonText: 3,
  /** AA normal text. */
  aa: 4.5,
  /** AAA normal text; the target of the high-contrast variant. */
  aaa: 7,
} as const;

export class InvalidColorError extends Error {
  override readonly name = 'InvalidColorError';
  constructor(readonly value: unknown) {
    super(`Invalid color ${JSON.stringify(value)}: expected #rgb or #rrggbb`);
  }
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Returns true when `value` is a `#rgb` / `#rrggbb` string (the `#` is optional). */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

/** Normalizes `#RGB`, `RGB`, `#RRGGBB` to lowercase `#rrggbb`. Throws {@link InvalidColorError}. */
export function normalizeHex(value: unknown): HexColor {
  if (typeof value !== 'string') throw new InvalidColorError(value);
  const match = HEX_RE.exec(value.trim());
  const digits = match?.[1];
  if (digits === undefined) throw new InvalidColorError(value);
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((d) => d + d)
          .join('')
      : digits;
  return `#${full.toLowerCase()}`;
}

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(normalizeHex(hex).slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function channelToHex(channel: number): string {
  const clamped = Math.min(255, Math.max(0, Math.round(channel)));
  return clamped.toString(16).padStart(2, '0');
}

export function rgbToHex({ r, g, b }: Rgb): HexColor {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio between two colors, 1–21. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Linear interpolation in sRGB between `from` (weight 0) and `to` (weight 1).
 * Used for tints such as subtle brand backgrounds.
 */
export function mix(from: string, to: string, weight: number): HexColor {
  const w = Math.min(1, Math.max(0, weight));
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex({
    r: a.r + (b.r - a.r) * w,
    g: a.g + (b.g - a.g) * w,
    b: a.b + (b.b - a.b) * w,
  });
}

/** CSS `rgb(r g b / a)` string; React Native also accepts `rgba(...)`, so both are offered. */
export function withAlpha(hex: string, alpha: number, format: 'css' | 'rgba' = 'rgba'): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.min(1, Math.max(0, alpha));
  const [rs, gs, bs, as] = [r, g, b, a].map(String) as [string, string, string, string];
  return format === 'css' ? `rgb(${rs} ${gs} ${bs} / ${as})` : `rgba(${rs}, ${gs}, ${bs}, ${as})`;
}

/** Picks whichever of `candidates` has the highest contrast against `background`. */
export function mostContrasting(background: string, candidates: readonly string[]): HexColor {
  let best: HexColor | undefined;
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, background);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = normalizeHex(candidate);
    }
  }
  if (best === undefined) throw new RangeError('mostContrasting needs at least one candidate');
  return best;
}

/**
 * Returns `color` unchanged if it already reaches `minRatio` against `background`;
 * otherwise mixes it toward white (on dark backgrounds) or black (on light
 * ones) by the smallest amount that reaches the ratio, falling back to the
 * other direction if the preferred one cannot. Keeps brand colors recognizable
 * while guaranteeing legibility.
 */
export function ensureContrast(color: string, background: string, minRatio: number): HexColor {
  const base = normalizeHex(color);
  if (contrastRatio(base, background) >= minRatio) return base;

  const bgIsDark = relativeLuminance(background) < 0.18;
  const preferred = bgIsDark ? '#ffffff' : '#000000';
  const fallback = bgIsDark ? '#000000' : '#ffffff';

  for (const target of [preferred, fallback]) {
    if (contrastRatio(target, background) < minRatio) continue;
    // Binary search the smallest mix weight that satisfies the ratio.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i += 1) {
      const midWeight = (lo + hi) / 2;
      if (contrastRatio(mix(base, target, midWeight), background) >= minRatio) hi = midWeight;
      else lo = midWeight;
    }
    // Rounding to 8-bit channels can land just under the ratio; nudge until it holds.
    let weight = hi;
    let candidate = mix(base, target, weight);
    while (contrastRatio(candidate, background) < minRatio && weight < 1) {
      weight = Math.min(1, weight + 1 / 255);
      candidate = mix(base, target, weight);
    }
    return candidate;
  }
  // The ratio is unreachable in either direction (e.g. > 21): return the best possible.
  return mostContrasting(background, ['#000000', '#ffffff']);
}

/**
 * Like {@link ensureContrast} but against several backgrounds at once (for
 * example every surface a status color may sit on). Backgrounds are expected
 * to share a lightness direction (all dark or all light).
 */
export function ensureContrastAll(
  color: string,
  backgrounds: readonly string[],
  minRatio: number,
): HexColor {
  let current = normalizeHex(color);
  // Each pass fixes the currently worst background; moving monotonically toward
  // white/black never breaks a background that already passes.
  for (let pass = 0; pass <= backgrounds.length; pass += 1) {
    let worst: string | undefined;
    let worstRatio = Number.POSITIVE_INFINITY;
    for (const bg of backgrounds) {
      const ratio = contrastRatio(current, bg);
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worst = bg;
      }
    }
    if (worst === undefined || worstRatio >= minRatio) return current;
    current = ensureContrast(current, worst, minRatio);
  }
  return current;
}
