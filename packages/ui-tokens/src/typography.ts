/**
 * Typography: Barlow Condensed for numbers, titles and tabular figures;
 * Barlow for running text. Sizes and line heights are in px (CSS output
 * converts to rem); letter spacing is in em (RN output converts to px).
 */

export type FontFamilyRole = 'condensed' | 'text';

/** Weights that are actually loaded; keep in sync with `nativeFontFamilies`. */
export type FontWeight = 400 | 500 | 600 | 700 | 800;

export const fontFamilies = {
  condensed: 'Barlow Condensed',
  text: 'Barlow',
} as const satisfies Record<FontFamilyRole, string>;

/** CSS font stacks with fallbacks of similar width. */
export const webFontStacks = {
  condensed: "'Barlow Condensed', 'Roboto Condensed', 'Arial Narrow', system-ui, sans-serif",
  text: "'Barlow', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const satisfies Record<FontFamilyRole, string>;

/**
 * React Native loads one family per weight (Android ignores `fontWeight` for
 * custom fonts). Names follow `@expo-google-fonts/barlow` and
 * `@expo-google-fonts/barlow-condensed`.
 */
export const nativeFontFamilies = {
  condensed: {
    400: 'BarlowCondensed_400Regular',
    500: 'BarlowCondensed_500Medium',
    600: 'BarlowCondensed_600SemiBold',
    700: 'BarlowCondensed_700Bold',
    800: 'BarlowCondensed_800ExtraBold',
  },
  text: {
    400: 'Barlow_400Regular',
    500: 'Barlow_500Medium',
    600: 'Barlow_600SemiBold',
    700: 'Barlow_700Bold',
    800: 'Barlow_800ExtraBold',
  },
} as const satisfies Record<FontFamilyRole, Record<FontWeight, string>>;

export interface TextStyleToken {
  readonly family: FontFamilyRole;
  readonly weight: FontWeight;
  readonly sizePx: number;
  readonly lineHeightPx: number;
  /** Tracking in em (relative to the font size). */
  readonly letterSpacingEm: number;
  /** Tabular (monospaced) figures so numbers align in tables and counters. */
  readonly tabularNums: boolean;
  readonly uppercase: boolean;
}

function style(
  family: FontFamilyRole,
  weight: FontWeight,
  sizePx: number,
  lineHeightPx: number,
  extra: Partial<Pick<TextStyleToken, 'letterSpacingEm' | 'tabularNums' | 'uppercase'>> = {},
): TextStyleToken {
  return {
    family,
    weight,
    sizePx,
    lineHeightPx,
    letterSpacingEm: extra.letterSpacingEm ?? 0,
    tabularNums: extra.tabularNums ?? false,
    uppercase: extra.uppercase ?? false,
  };
}

/**
 * Text roles (the type scale, ADR 0097). Barlow Condensed for titles, labels
 * of controls and every figure; Barlow for running text. Metric roles are for
 * figures (values, records, counters) and always use tabular numbers.
 */
export const textStyles = {
  display: style('condensed', 700, 40, 44, { letterSpacingEm: -0.01 }),
  /** H1 of a page. */
  pageTitle: style('condensed', 700, 34, 38, { letterSpacingEm: -0.005 }),
  title: style('condensed', 700, 28, 32),
  heading: style('condensed', 600, 20, 24),
  /** Title of a card or a section inside a page. */
  cardTitle: style('condensed', 700, 20, 24),
  overline: style('condensed', 600, 13, 16, { letterSpacingEm: 0.08, uppercase: true }),
  /** Column headers of data tables: condensed, muted, not uppercase. */
  tableHeader: style('condensed', 600, 15, 18, { letterSpacingEm: 0.01 }),
  /** Labels of buttons and segmented controls: condensed, sentence case. */
  button: style('condensed', 600, 17, 20, { letterSpacingEm: 0.01 }),
  body: style('text', 400, 16, 24),
  bodyStrong: style('text', 600, 16, 24),
  bodySmall: style('text', 400, 14, 20),
  caption: style('text', 400, 12, 16, { letterSpacingEm: 0.01 }),
  metricXl: style('condensed', 700, 56, 56, { tabularNums: true, letterSpacingEm: -0.01 }),
  /** The figure of a KPI tile. */
  kpi: style('condensed', 700, 44, 44, { tabularNums: true, letterSpacingEm: -0.01 }),
  metric: style('condensed', 700, 32, 36, { tabularNums: true }),
  metricSmall: style('condensed', 600, 20, 24, { tabularNums: true }),
  /** The unit next to a figure (`/ 24`, `UA`): smaller and muted. */
  unit: style('condensed', 600, 18, 20, { tabularNums: true }),
  /** Numbers inside data tables: condensed, tabular, right-aligned by the table. */
  tableNumber: style('condensed', 600, 17, 20, { tabularNums: true }),
  tabular: style('text', 500, 14, 20, { tabularNums: true }),
} as const satisfies Record<string, TextStyleToken>;

export type TextStyleRole = keyof typeof textStyles;
