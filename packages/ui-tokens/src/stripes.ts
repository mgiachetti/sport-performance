import type { HexColor } from './color.js';
import type { StripeSize, Theme } from './theme.js';

/**
 * Horizontal jersey stripes (brand / secondary), the visual seal of the club.
 * Purely decorative: never carry information in them.
 */

/** CSS `repeating-linear-gradient` for the stripes at the given size. */
export function stripesGradient(theme: Theme, size: StripeSize = 'md'): string {
  const band = theme.stripes.bandPx[size];
  const [first, second] = theme.stripes.colors;
  return `repeating-linear-gradient(180deg, ${first} 0 ${String(band)}px, ${second} ${String(band)}px ${String(band * 2)}px)`;
}

export interface StripeBand {
  readonly color: HexColor;
  /** Band height in px (the last band may be shorter to fit `totalHeightPx`). */
  readonly height: number;
}

/**
 * Bands to render the stripes in React Native (stacked `View`s), which has no
 * native gradients. Fills exactly `totalHeightPx`.
 */
export function stripeBands(
  theme: Theme,
  totalHeightPx: number,
  size: StripeSize = 'md',
): StripeBand[] {
  if (!Number.isFinite(totalHeightPx) || totalHeightPx < 0) {
    throw new RangeError(`totalHeightPx must be a finite number ≥ 0, got ${String(totalHeightPx)}`);
  }
  const band = theme.stripes.bandPx[size];
  const bands: StripeBand[] = [];
  let remaining = totalHeightPx;
  for (let i = 0; remaining > 0; i += 1) {
    const height = Math.min(band, remaining);
    bands.push({ color: theme.stripes.colors[i % 2 === 0 ? 0 : 1], height });
    remaining -= height;
  }
  return bands;
}
