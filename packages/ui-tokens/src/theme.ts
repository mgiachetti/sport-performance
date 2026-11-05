import { defaultBrand, parseClubBrand, type ClubBrand, type ClubBrandInput } from './brand.js';
import {
  CONTRAST,
  ensureContrastAll,
  mix,
  mostContrasting,
  normalizeHex,
  type HexColor,
} from './color.js';
import { darkExtras, lightHighContrastPalette, orcPalette } from './palette.js';
import { borderWidth, focusRing, radius, sizes, spacing, type ElevationLevel } from './scales.js';
import { textStyles } from './typography.js';

/**
 * `dark`: the ORC identity (default).
 * `light-hc`: light, high-contrast (WCAG AAA text) for outdoor use in sunlight.
 */
export type ThemeVariant = 'dark' | 'light-hc';

export const themeVariants: readonly ThemeVariant[] = ['dark', 'light-hc'];

export type StatusLevel = 'ok' | 'warning' | 'critical';

export const statusLevels: readonly StatusLevel[] = ['ok', 'warning', 'critical'];

/**
 * Status colors. Color is never the only signal: every status must be shown
 * with an icon and a text label (CLAUDE.md, accessibility).
 */
export interface StatusColors {
  /** Text and icon color on any surface or on `bg`. */
  readonly fg: HexColor;
  /** Subtle tinted background (badges, banners). */
  readonly bg: HexColor;
  /** Border of tinted containers. */
  readonly border: HexColor;
  /** Solid fill (dots, filled badges). */
  readonly solid: HexColor;
  /** Text/icon color on `solid`. */
  readonly onSolid: HexColor;
}

export interface ThemeColors {
  readonly background: HexColor;
  readonly surface: HexColor;
  readonly surfaceRaised: HexColor;
  readonly border: {
    /** Decorative dividers; not required to reach 3:1. */
    readonly subtle: HexColor;
    /** Functional borders (inputs, toggles): ≥ 3:1 on every surface. */
    readonly strong: HexColor;
  };
  readonly text: {
    readonly primary: HexColor;
    readonly secondary: HexColor;
    readonly muted: HexColor;
  };
  readonly brand: {
    /** The club color as is, for fills (buttons, stripes, header bars). */
    readonly solid: HexColor;
    /** Text/icon color on `solid`. */
    readonly onSolid: HexColor;
    /** Brand color adjusted to be legible as text or lines on surfaces. */
    readonly accent: HexColor;
    /** Brand tint for selected/hover backgrounds. */
    readonly subtle: HexColor;
    /** Brand color as an outline (highlighted tile, selected option): ≥ 3:1 on surfaces. */
    readonly border: HexColor;
    /** Second jersey color. */
    readonly secondary: HexColor;
    readonly onSecondary: HexColor;
  };
  readonly focus: HexColor;
  readonly status: Readonly<Record<StatusLevel, StatusColors>>;
  readonly chart: {
    /** The player's series: brand color. */
    readonly player: HexColor;
    /** The brand series dimmed (past weeks next to the current one); still ≥ 3:1. */
    readonly playerMuted: HexColor;
    /** Category average: grey. */
    readonly categoryAverage: HexColor;
    /** First-team reference: dotted white (dark) / black (light) line with a direct label. */
    readonly reference: HexColor;
    readonly grid: HexColor;
    readonly axis: HexColor;
    readonly tooltipBackground: HexColor;
    readonly tooltipText: HexColor;
    readonly tooltipBorder: HexColor;
  };
}

export interface StripeTokens {
  /** Alternating band colors, top to bottom: brand primary, then secondary. */
  readonly colors: readonly [HexColor, HexColor];
  /** Height of one band in px, per size. */
  readonly bandPx: { readonly sm: number; readonly md: number; readonly lg: number };
}

export type StripeSize = keyof StripeTokens['bandPx'];

/** A drop shadow; `none` for the flat level. */
export interface ShadowToken {
  readonly offsetYPx: number;
  readonly blurPx: number;
  readonly spreadPx: number;
  readonly color: HexColor;
  /** 0–1. */
  readonly opacity: number;
}

export type ElevationTokens = Readonly<Record<ElevationLevel, ShadowToken | null>>;

export interface Theme {
  readonly variant: ThemeVariant;
  readonly colorScheme: 'dark' | 'light';
  readonly brand: ClubBrand;
  /** Minimum text contrast this variant guarantees (4.5 dark, 7 light-hc). */
  readonly minTextContrast: number;
  readonly color: ThemeColors;
  readonly text: typeof textStyles;
  readonly spacing: typeof spacing;
  readonly radius: typeof radius;
  readonly borderWidth: typeof borderWidth;
  readonly focusRing: typeof focusRing;
  readonly sizes: typeof sizes;
  readonly stripes: StripeTokens;
  /** Shadows of what floats above the page (ADR 0097). */
  readonly elevation: ElevationTokens;
  readonly chartDash: {
    /** Dash pattern for the first-team reference line, in px (dash, gap). */
    readonly reference: readonly [number, number];
  };
}

export interface CreateThemeOptions {
  /** Club brand; defaults to ORC. Raw input is validated with `parseClubBrand`. */
  readonly brand?: ClubBrand | ClubBrandInput | undefined;
  readonly variant?: ThemeVariant | undefined;
}

interface Neutrals {
  background: string;
  surface: string;
  surfaceRaised: string;
  borderSubtle: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  status: Record<StatusLevel, string>;
  categoryAverage: string;
  reference: string;
  /** Weight of the hue in tinted backgrounds. */
  tint: number;
  /** Shadow color and opacities of the raised and overlay levels. */
  shadow: { color: string; raised: number; overlay: number };
  minText: number;
  colorScheme: 'dark' | 'light';
}

const NEUTRALS: Record<ThemeVariant, Neutrals> = {
  dark: {
    background: orcPalette.background,
    surface: orcPalette.panel,
    surfaceRaised: orcPalette.panelRaised,
    borderSubtle: orcPalette.line,
    borderStrong: darkExtras.lineStrong,
    textPrimary: orcPalette.text,
    textSecondary: orcPalette.textSecondary,
    textMuted: orcPalette.textMuted,
    status: { ok: orcPalette.ok, warning: orcPalette.warning, critical: orcPalette.critical },
    categoryAverage: darkExtras.chartCategoryAverage,
    reference: darkExtras.chartReference,
    tint: 0.16,
    shadow: { color: '#000000', raised: 0.28, overlay: 0.5 },
    minText: CONTRAST.aa,
    colorScheme: 'dark',
  },
  'light-hc': {
    background: lightHighContrastPalette.background,
    surface: lightHighContrastPalette.panel,
    surfaceRaised: lightHighContrastPalette.panelRaised,
    borderSubtle: lightHighContrastPalette.line,
    borderStrong: lightHighContrastPalette.lineStrong,
    textPrimary: lightHighContrastPalette.text,
    textSecondary: lightHighContrastPalette.textSecondary,
    textMuted: lightHighContrastPalette.textMuted,
    status: {
      ok: lightHighContrastPalette.ok,
      warning: lightHighContrastPalette.warning,
      critical: lightHighContrastPalette.critical,
    },
    categoryAverage: lightHighContrastPalette.chartCategoryAverage,
    reference: lightHighContrastPalette.text,
    tint: 0.12,
    shadow: { color: '#2e2924', raised: 0.12, overlay: 0.22 },
    minText: CONTRAST.aaa,
    colorScheme: 'light',
  },
};

/** Ink candidates for text on solid fills: near-black and white. */
const INKS = [orcPalette.black, '#ffffff'] as const;

function resolveBrand(brand: CreateThemeOptions['brand']): ClubBrand {
  return brand === undefined ? defaultBrand : parseClubBrand(brand);
}

/**
 * Builds the full semantic theme for a club brand and variant. Pure and cheap;
 * call it again when the active club or the variant changes at runtime.
 *
 * Every color used as text is adjusted (keeping its hue) until it reaches the
 * variant's minimum contrast on all surfaces, so any club color works.
 */
export function createTheme(options: CreateThemeOptions = {}): Theme {
  const variant = options.variant ?? 'dark';
  const brand = resolveBrand(options.brand);
  const n = NEUTRALS[variant];

  const background = normalizeHex(n.background);
  const surface = normalizeHex(n.surface);
  const surfaceRaised = normalizeHex(n.surfaceRaised);
  const surfaces = [background, surface, surfaceRaised];
  const text = (c: string, extra: readonly string[] = []): HexColor =>
    ensureContrastAll(c, [...surfaces, ...extra], n.minText);
  const nonText = (c: string): HexColor => ensureContrastAll(c, surfaces, CONTRAST.nonText);

  const brandSubtle = mix(background, brand.primary, n.tint);

  const status = Object.fromEntries(
    statusLevels.map((level) => {
      const base = normalizeHex(n.status[level]);
      const bg = mix(surface, base, n.tint);
      const fg = text(base, [bg]);
      const solid = n.colorScheme === 'dark' ? base : fg;
      const colors: StatusColors = {
        fg,
        bg,
        border: nonText(base),
        solid,
        onSolid: mostContrasting(solid, INKS),
      };
      return [level, colors];
    }),
  ) as Record<StatusLevel, StatusColors>;

  const textPrimary = text(n.textPrimary);
  const borderStrong = nonText(n.borderStrong);
  const accent = text(brand.primary, [brandSubtle]);

  const color: ThemeColors = {
    background,
    surface,
    surfaceRaised,
    border: { subtle: normalizeHex(n.borderSubtle), strong: borderStrong },
    text: {
      primary: textPrimary,
      secondary: text(n.textSecondary),
      muted: text(n.textMuted),
    },
    brand: {
      solid: brand.primary,
      onSolid: mostContrasting(brand.primary, INKS),
      accent,
      subtle: brandSubtle,
      border: nonText(brand.primary),
      secondary: brand.secondary,
      onSecondary: mostContrasting(brand.secondary, INKS),
    },
    focus: nonText(brand.primary),
    status,
    chart: {
      player: accent,
      playerMuted: nonText(mix(surface, accent, n.colorScheme === 'dark' ? 0.5 : 0.55)),
      categoryAverage: nonText(n.categoryAverage),
      reference: text(n.reference),
      grid: normalizeHex(n.borderSubtle),
      axis: text(n.textMuted),
      tooltipBackground: surfaceRaised,
      tooltipText: textPrimary,
      tooltipBorder: borderStrong,
    },
  };

  return {
    variant,
    colorScheme: n.colorScheme,
    brand,
    minTextContrast: n.minText,
    color,
    text: textStyles,
    spacing,
    radius,
    borderWidth,
    focusRing,
    sizes,
    stripes: { colors: [brand.primary, brand.secondary], bandPx: { sm: 5, md: 10, lg: 16 } },
    elevation: {
      flat: null,
      raised: {
        offsetYPx: 1,
        blurPx: 2,
        spreadPx: 0,
        color: normalizeHex(n.shadow.color),
        opacity: n.shadow.raised,
      },
      overlay: {
        offsetYPx: 12,
        blurPx: 32,
        spreadPx: -4,
        color: normalizeHex(n.shadow.color),
        opacity: n.shadow.overlay,
      },
    },
    chartDash: { reference: [6, 4] },
  };
}

/** Both variants for one club, e.g. to emit a stylesheet or to switch instantly. */
export function createThemes(brand?: CreateThemeOptions['brand']): Record<ThemeVariant, Theme> {
  const resolved = resolveBrand(brand);
  return {
    dark: createTheme({ brand: resolved, variant: 'dark' }),
    'light-hc': createTheme({ brand: resolved, variant: 'light-hc' }),
  };
}
