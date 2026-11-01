/** Layout scales in px (CSS output converts spacing and radii to rem). */

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

export const borderWidth = {
  hairline: 1,
  thick: 2,
  /** Focus ring width; keep together with `focusRing.offset`. */
  focus: 2,
} as const;

export const focusRing = {
  width: borderWidth.focus,
  offset: 2,
} as const;

export const sizes = {
  /** Minimum touch target (WCAG 2.5.5 / platform guidelines). */
  touchTarget: 44,
  /** Status icons accompany every status color. */
  statusIcon: 16,
} as const;

export type SpacingKey = keyof typeof spacing;
export type RadiusKey = keyof typeof radius;
