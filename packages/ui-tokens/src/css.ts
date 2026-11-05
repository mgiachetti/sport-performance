import { withAlpha } from './color.js';
import { stripesGradient, stripesSeal } from './stripes.js';
import { createThemes, type CreateThemeOptions, type Theme } from './theme.js';
import { webFontStacks, type TextStyleRole } from './typography.js';

/** Prefix of every CSS custom property emitted by this package. */
export const CSS_VAR_PREFIX = 'sp';

/** Map of CSS custom property name (`--sp-…`) to value. */
export type CssVariables = Record<`--${string}`, string>;

const ROOT_FONT_PX = 16;

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function rem(px: number): string {
  return px === 0 ? '0' : `${String(px / ROOT_FONT_PX)}rem`;
}

/** `cssVar('color', 'text', 'primary')` → `--sp-color-text-primary`. */
export function cssVarName(...path: readonly string[]): `--${string}` {
  return `--${[CSS_VAR_PREFIX, ...path].map(kebab).join('-')}`;
}

/** `var(--sp-…)` reference, for use in CSS-in-JS or inline styles. */
export function cssVar(...path: readonly string[]): string {
  return `var(${cssVarName(...path)})`;
}

function flattenColors(value: unknown, path: readonly string[], out: CssVariables): void {
  if (typeof value === 'string') {
    out[cssVarName(...path)] = value;
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) flattenColors(child, [...path, key], out);
  }
}

/**
 * All theme tokens as CSS custom properties (`--sp-*`). Colors in hex,
 * sizes in rem, letter spacing in em, unitless line heights.
 */
export function toCssVariables(theme: Theme): CssVariables {
  const vars: CssVariables = {};

  flattenColors(theme.color, ['color'], vars);

  vars[cssVarName('font', 'condensed')] = webFontStacks.condensed;
  vars[cssVarName('font', 'text')] = webFontStacks.text;

  for (const [role, style] of Object.entries(theme.text) as [
    TextStyleRole,
    Theme['text'][TextStyleRole],
  ][]) {
    vars[cssVarName('text', role, 'family')] = cssVar('font', style.family);
    vars[cssVarName('text', role, 'size')] = rem(style.sizePx);
    vars[cssVarName('text', role, 'line-height')] = String(
      Math.round((style.lineHeightPx / style.sizePx) * 1000) / 1000,
    );
    vars[cssVarName('text', role, 'weight')] = String(style.weight);
    vars[cssVarName('text', role, 'letter-spacing')] =
      style.letterSpacingEm === 0 ? '0' : `${String(style.letterSpacingEm)}em`;
    vars[cssVarName('text', role, 'numeric')] = style.tabularNums ? 'tabular-nums' : 'normal';
    vars[cssVarName('text', role, 'transform')] = style.uppercase ? 'uppercase' : 'none';
  }

  for (const [key, px] of Object.entries(theme.spacing)) vars[cssVarName('space', key)] = rem(px);
  for (const [key, px] of Object.entries(theme.radius)) {
    vars[cssVarName('radius', key)] = key === 'pill' ? `${String(px)}px` : rem(px);
  }
  for (const [key, px] of Object.entries(theme.borderWidth)) {
    vars[cssVarName('border-width', key)] = `${String(px)}px`;
  }
  vars[cssVarName('focus-ring', 'width')] = `${String(theme.focusRing.width)}px`;
  vars[cssVarName('focus-ring', 'offset')] = `${String(theme.focusRing.offset)}px`;
  for (const [key, px] of Object.entries(theme.sizes)) vars[cssVarName('size', key)] = rem(px);

  for (const size of ['sm', 'md', 'lg'] as const) {
    vars[cssVarName('stripes', size)] = stripesGradient(theme, size);
  }
  vars[cssVarName('stripes', 'seal')] = stripesSeal(theme);
  for (const [level, shadow] of Object.entries(theme.elevation)) {
    vars[cssVarName('elevation', level)] =
      shadow === null
        ? 'none'
        : `0 ${String(shadow.offsetYPx)}px ${String(shadow.blurPx)}px ${String(shadow.spreadPx)}px ${withAlpha(shadow.color, shadow.opacity)}`;
  }
  // What dims the page under an overlay (the drawer): the overlay shadow's color and opacity.
  const overlay = theme.elevation.overlay;
  vars[cssVarName('elevation', 'scrim')] =
    overlay === null ? 'transparent' : withAlpha(overlay.color, overlay.opacity);
  const [dash, gap] = theme.chartDash.reference;
  vars[cssVarName('chart', 'reference-dash')] = `${String(dash)} ${String(gap)}`;

  return vars;
}

/** A CSS rule declaring the theme's variables (and `color-scheme`) under `selector`. */
export function toCssRule(theme: Theme, selector = ':root'): string {
  const lines = Object.entries(toCssVariables(theme)).map(
    ([name, value]) => `  ${name}: ${value};`,
  );
  return `${selector} {\n  color-scheme: ${theme.colorScheme};\n${lines.join('\n')}\n}\n`;
}

export interface StylesheetOptions {
  readonly brand?: CreateThemeOptions['brand'];
  /** Selector of the default (dark) theme. */
  readonly darkSelector?: string;
  /** Selector that switches to the light high-contrast variant. */
  readonly lightHighContrastSelector?: string;
}

/**
 * Complete stylesheet for a club: dark on `:root` and the light high-contrast
 * variant on `[data-theme="light-hc"]` (put the attribute on `<html>`).
 */
export function createStylesheet(options: StylesheetOptions = {}): string {
  const themes = createThemes(options.brand);
  return [
    toCssRule(themes.dark, options.darkSelector ?? ':root'),
    toCssRule(themes['light-hc'], options.lightHighContrastSelector ?? '[data-theme="light-hc"]'),
  ].join('\n');
}

/** Minimal shape of `HTMLElement` needed to apply a theme (keeps this package DOM-free). */
export interface CssVariableTarget {
  readonly style: {
    setProperty(name: string, value: string): void;
  };
}

/**
 * Applies a theme at runtime (e.g. when the active club changes) by setting
 * the variables inline on `target`, usually `document.documentElement`.
 */
export function applyCssVariables(target: CssVariableTarget, theme: Theme): void {
  target.style.setProperty('color-scheme', theme.colorScheme);
  for (const [name, value] of Object.entries(toCssVariables(theme))) {
    target.style.setProperty(name, value);
  }
}
