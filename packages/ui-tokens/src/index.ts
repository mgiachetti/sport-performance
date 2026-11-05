/**
 * @sport-performance/ui-tokens — design tokens with per-club runtime theming.
 *
 * Framework-agnostic: no React, React Native or DOM dependency. Web consumes
 * `createStylesheet` / `applyCssVariables`; mobile consumes `toNativeTheme`.
 */

/** Workspace package identifier (used by the app scaffolds' wiring checks). */
export const packageName = '@sport-performance/ui-tokens' as const;

export {
  CONTRAST,
  InvalidColorError,
  contrastRatio,
  ensureContrast,
  ensureContrastAll,
  hexToRgb,
  isHexColor,
  mix,
  mostContrasting,
  normalizeHex,
  relativeLuminance,
  rgbToHex,
  withAlpha,
  type HexColor,
  type Rgb,
} from './color.js';
export { darkExtras, lightHighContrastPalette, orcBrand, orcPalette } from './palette.js';
export {
  fontFamilies,
  nativeFontFamilies,
  textStyles,
  webFontStacks,
  type FontFamilyRole,
  type FontWeight,
  type TextStyleRole,
  type TextStyleToken,
} from './typography.js';
export {
  borderWidth,
  focusRing,
  radius,
  sizes,
  spacing,
  type ElevationLevel,
  type RadiusKey,
  type SizeKey,
  type SpacingKey,
} from './scales.js';
export {
  InvalidClubBrandError,
  defaultBrand,
  parseClubBrand,
  type ClubBrand,
  type ClubBrandInput,
} from './brand.js';
export {
  createTheme,
  createThemes,
  statusLevels,
  themeVariants,
  type CreateThemeOptions,
  type ElevationTokens,
  type ShadowToken,
  type StatusColors,
  type StatusLevel,
  type StripeSize,
  type StripeTokens,
  type Theme,
  type ThemeColors,
  type ThemeVariant,
} from './theme.js';
export { stripeBands, stripesGradient, stripesSeal, type StripeBand } from './stripes.js';
export {
  CSS_VAR_PREFIX,
  applyCssVariables,
  createStylesheet,
  cssVar,
  cssVarName,
  toCssRule,
  toCssVariables,
  type CssVariableTarget,
  type CssVariables,
  type StylesheetOptions,
} from './css.js';
export { toNativeTheme, type NativeTextStyle, type NativeTheme } from './native.js';
