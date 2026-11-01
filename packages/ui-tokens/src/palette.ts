/**
 * Primitive palettes. These are raw values; apps consume the semantic tokens
 * produced by `createTheme`, never these constants directly.
 *
 * `orcPalette` is the visual identity of the first tenant (Olivos Rugby Club)
 * as defined in CLAUDE.md, "Identidad visual". It is also the product default.
 */

/** ORC identity, dark (the canonical look). Values verbatim from CLAUDE.md. */
export const orcPalette = {
  orange: '#f1882a',
  black: '#050505',
  background: '#141210',
  panel: '#1c1916',
  panelRaised: '#24201c',
  line: '#332d27',
  text: '#f3eee7',
  textSecondary: '#b9b0a5',
  textMuted: '#857b70',
  ok: '#5bbf7a',
  warning: '#e8c14a',
  critical: '#e5604f',
} as const;

/**
 * Light high-contrast neutrals for outdoor use (phone in direct sunlight at
 * the pitch). Warm greys keep the ORC feel; text is near-black.
 */
export const lightHighContrastPalette = {
  background: '#ffffff',
  panel: '#f7f4f0',
  panelRaised: '#efeae3',
  line: '#cfc6bb',
  lineStrong: '#5c534a',
  text: '#050505',
  textSecondary: '#2e2924',
  textMuted: '#4a433c',
  /** Status base hues; darkened as needed by `createTheme` to reach 7:1. */
  ok: '#1f7a3f',
  warning: '#8a5f00',
  critical: '#b3261e',
  chartCategoryAverage: '#6b6158',
} as const;

/** Extra neutrals for the dark variant not named in the identity. */
export const darkExtras = {
  /** Functional borders (inputs, toggles); derived to reach 3:1 on panels. */
  lineStrong: '#6e655b',
  chartCategoryAverage: '#9a9187',
  chartReference: '#ffffff',
} as const;

/** The ORC brand as a club brand input (see `ClubBrand`). */
export const orcBrand = {
  primary: orcPalette.orange,
  secondary: orcPalette.black,
} as const;
