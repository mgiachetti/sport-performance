import { stripeBands, type StripeBand } from './stripes.js';
import type { StripeSize, Theme, ThemeColors, ThemeVariant } from './theme.js';
import { nativeFontFamilies, type TextStyleRole } from './typography.js';

/**
 * Subset of React Native's `TextStyle` produced by this package. Declared here
 * so the package does not depend on `react-native`; it is assignable to
 * `TextStyle`.
 */
export interface NativeTextStyle {
  /** Family already encodes the weight (one family per weight on RN). */
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly fontVariant?: ['tabular-nums'];
  readonly textTransform?: 'uppercase';
}

export interface NativeTheme {
  readonly variant: ThemeVariant;
  /** Convenience for `StatusBar` style and navigation themes. */
  readonly dark: boolean;
  readonly colors: ThemeColors;
  readonly text: Readonly<Record<TextStyleRole, NativeTextStyle>>;
  readonly spacing: Theme['spacing'];
  readonly radius: Theme['radius'];
  readonly borderWidth: Theme['borderWidth'];
  readonly focusRing: Theme['focusRing'];
  readonly sizes: Theme['sizes'];
  readonly chartDash: Theme['chartDash'];
  /** Stripe bands filling `totalHeightPx`, ready to render as stacked views. */
  readonly stripes: (totalHeightPx: number, size?: StripeSize) => StripeBand[];
  /** Every family used by `text`; load them all (e.g. `useFonts` with `@expo-google-fonts`). */
  readonly fontFamilies: readonly string[];
}

function toNativeText(style: Theme['text'][TextStyleRole]): NativeTextStyle {
  const base = {
    fontFamily: nativeFontFamilies[style.family][style.weight],
    fontSize: style.sizePx,
    lineHeight: style.lineHeightPx,
    letterSpacing: Math.round(style.letterSpacingEm * style.sizePx * 100) / 100,
  };
  return {
    ...base,
    ...(style.tabularNums ? { fontVariant: ['tabular-nums'] as ['tabular-nums'] } : {}),
    ...(style.uppercase ? { textTransform: 'uppercase' as const } : {}),
  };
}

/** React Native theme object: colors, text styles, spacing and radii as plain numbers. */
export function toNativeTheme(theme: Theme): NativeTheme {
  const text = Object.fromEntries(
    Object.entries(theme.text).map(([role, style]) => [role, toNativeText(style)]),
  ) as Record<TextStyleRole, NativeTextStyle>;

  const families = [...new Set(Object.values(text).map((style) => style.fontFamily))].sort();

  return {
    variant: theme.variant,
    dark: theme.colorScheme === 'dark',
    colors: theme.color,
    text,
    spacing: theme.spacing,
    radius: theme.radius,
    borderWidth: theme.borderWidth,
    focusRing: theme.focusRing,
    sizes: theme.sizes,
    chartDash: theme.chartDash,
    stripes: (totalHeightPx, size) => stripeBands(theme, totalHeightPx, size),
    fontFamilies: families,
  };
}
