import { describe, expect, it } from 'vitest';
import { InvalidClubBrandError, defaultBrand, parseClubBrand } from './brand.js';
import { CONTRAST, contrastRatio } from './color.js';
import { orcPalette } from './palette.js';
import { createTheme, createThemes, statusLevels, themeVariants, type Theme } from './theme.js';

const CLUB_BRANDS = {
  orc: { primary: '#F1882A', secondary: '#050505' },
  navy: { primary: '#0A2A5C', secondary: '#FFFFFF' },
  yellow: { primary: '#FFE600', secondary: '#003399' },
  white: { primary: '#FFFFFF', secondary: '#000000' },
  black: { primary: '#000000' },
  green: { primary: '#2E7D32', secondary: '#FDD835' },
} as const;

function surfaces(theme: Theme): string[] {
  return [theme.color.background, theme.color.surface, theme.color.surfaceRaised];
}

function expectContrast(fg: string, bgs: readonly string[], min: number, what: string): void {
  for (const bg of bgs) {
    const ratio = contrastRatio(fg, bg);
    expect(
      ratio,
      `${what}: ${fg} on ${bg} = ${ratio.toFixed(2)} < ${String(min)}`,
    ).toBeGreaterThanOrEqual(min);
  }
}

describe('parseClubBrand', () => {
  it('normalizes colors and defaults the secondary to ORC black', () => {
    expect(parseClubBrand({ primary: '#0A2A5C' })).toEqual({
      primary: '#0a2a5c',
      secondary: '#050505',
    });
    expect(parseClubBrand({ primary: 'abc', secondary: null })).toEqual({
      primary: '#aabbcc',
      secondary: '#050505',
    });
  });

  it.each([
    [null, undefined],
    ['#f1882a', undefined],
    [{}, 'primary'],
    [{ primary: 'orange' }, 'primary'],
    [{ primary: '#f1882a', secondary: 12 }, 'secondary'],
  ])('rejects %j', (input, field) => {
    try {
      parseClubBrand(input);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidClubBrandError);
      expect((error as InvalidClubBrandError).field).toBe(field);
    }
  });
});

describe('createTheme (ORC defaults)', () => {
  it('defaults to the ORC brand, dark variant', () => {
    const theme = createTheme();
    expect(theme.variant).toBe('dark');
    expect(theme.colorScheme).toBe('dark');
    expect(theme.brand).toEqual(defaultBrand);
  });

  it('uses the CLAUDE.md identity verbatim where it is legible', () => {
    const { color, stripes } = createTheme();
    expect(color.background).toBe(orcPalette.background);
    expect(color.surface).toBe(orcPalette.panel);
    expect(color.surfaceRaised).toBe(orcPalette.panelRaised);
    expect(color.border.subtle).toBe(orcPalette.line);
    expect(color.text.primary).toBe(orcPalette.text);
    expect(color.text.secondary).toBe(orcPalette.textSecondary);
    expect(color.brand.solid).toBe(orcPalette.orange);
    expect(color.brand.accent).toBe(orcPalette.orange);
    expect(color.brand.onSolid).toBe(orcPalette.black);
    expect(color.chart.player).toBe(orcPalette.orange);
    expect(color.status.ok.fg).toBe(orcPalette.ok);
    expect(color.status.warning.fg).toBe(orcPalette.warning);
    expect(color.status.ok.solid).toBe(orcPalette.ok);
    expect(color.status.warning.solid).toBe(orcPalette.warning);
    expect(color.status.critical.solid).toBe(orcPalette.critical);
    // #e5604f drops below 4.5:1 on its own tinted badge background; the text
    // token is lifted minimally (the solid fill keeps the identity value).
    expect(color.status.critical.fg).not.toBe(orcPalette.critical);
    expect(contrastRatio(color.status.critical.fg, color.status.critical.bg)).toBeLessThan(
      CONTRAST.aa + 0.2,
    );
    expect(stripes.colors).toEqual([orcPalette.orange, orcPalette.black]);
  });

  it('lifts the identity muted text just enough to reach AA on raised panels', () => {
    const { color } = createTheme();
    // #857b70 is 3.9:1 on #24201c; the token keeps its hue but reaches 4.5:1.
    expect(contrastRatio(orcPalette.textMuted, orcPalette.panelRaised)).toBeLessThan(CONTRAST.aa);
    expect(color.text.muted).not.toBe(orcPalette.textMuted);
    expect(contrastRatio(color.text.muted, orcPalette.panelRaised)).toBeLessThan(CONTRAST.aa + 0.2);
  });

  it('light-hc is light with near-black text', () => {
    const theme = createTheme({ variant: 'light-hc' });
    expect(theme.colorScheme).toBe('light');
    expect(theme.color.background).toBe('#ffffff');
    expect(theme.color.text.primary).toBe(orcPalette.black);
    expect(theme.color.chart.reference).toBe(orcPalette.black);
    expect(theme.minTextContrast).toBe(CONTRAST.aaa);
  });
});

describe.each(Object.entries(CLUB_BRANDS))('accessibility for club brand %s', (_name, brand) => {
  describe.each(themeVariants)('%s', (variant) => {
    const theme = createTheme({ brand, variant });
    const min = variant === 'light-hc' ? CONTRAST.aaa : CONTRAST.aa;
    const all = surfaces(theme);

    it('text reaches the variant minimum on every surface', () => {
      expectContrast(theme.color.text.primary, all, min, 'text.primary');
      expectContrast(theme.color.text.secondary, all, min, 'text.secondary');
      expectContrast(theme.color.text.muted, all, min, 'text.muted');
      expectContrast(theme.color.chart.axis, all, min, 'chart.axis');
      expectContrast(theme.color.chart.reference, all, min, 'chart.reference');
    });

    it('brand accent is legible on surfaces and on the brand tint', () => {
      expectContrast(theme.color.brand.accent, [...all, theme.color.brand.subtle], min, 'accent');
    });

    it('ink on brand fills reaches AA', () => {
      expectContrast(theme.color.brand.onSolid, [theme.color.brand.solid], CONTRAST.aa, 'onSolid');
      expectContrast(
        theme.color.brand.onSecondary,
        [theme.color.brand.secondary],
        CONTRAST.aa,
        'onSecondary',
      );
    });

    it('status colors reach the minimum on surfaces and their own tint', () => {
      for (const level of statusLevels) {
        const s = theme.color.status[level];
        expectContrast(s.fg, [...all, s.bg], min, `status.${level}.fg`);
        expectContrast(s.onSolid, [s.solid], CONTRAST.aa, `status.${level}.onSolid`);
        expectContrast(s.border, all, CONTRAST.nonText, `status.${level}.border`);
      }
    });

    it('focus ring, functional borders and chart marks reach 3:1', () => {
      expectContrast(theme.color.focus, all, CONTRAST.nonText, 'focus');
      expectContrast(theme.color.border.strong, all, CONTRAST.nonText, 'border.strong');
      expectContrast(theme.color.chart.player, all, CONTRAST.nonText, 'chart.player');
      expectContrast(theme.color.chart.categoryAverage, all, CONTRAST.nonText, 'chart.avg');
      expectContrast(theme.color.chart.playerMuted, all, CONTRAST.nonText, 'chart.playerMuted');
      expectContrast(theme.color.brand.border, all, CONTRAST.nonText, 'brand.border');
    });

    it('dims the brand series without making it the same color', () => {
      expect(theme.color.chart.playerMuted).not.toBe(theme.color.chart.player);
    });

    it('keeps the raw club colors for fills and stripes', () => {
      expect(theme.color.brand.solid).toBe(parseClubBrand(brand).primary);
      expect(theme.stripes.colors).toEqual([
        parseClubBrand(brand).primary,
        parseClubBrand(brand).secondary,
      ]);
    });
  });
});

describe('runtime club override', () => {
  it('changes only brand-derived tokens', () => {
    const orc = createTheme();
    const navy = createTheme({ brand: CLUB_BRANDS.navy });
    expect(navy.color.background).toBe(orc.color.background);
    expect(navy.color.text).toEqual(orc.color.text);
    expect(navy.color.status).toEqual(orc.color.status);
    expect(navy.color.brand.solid).toBe('#0a2a5c');
    expect(navy.color.brand.onSolid).toBe('#ffffff');
    expect(navy.color.brand.accent).not.toBe('#0a2a5c');
    expect(navy.color.chart.player).toBe(navy.color.brand.accent);
  });

  it('validates raw input', () => {
    expect(() => createTheme({ brand: { primary: 'nope' } })).toThrow(InvalidClubBrandError);
  });

  it('createThemes builds both variants for the same club', () => {
    const themes = createThemes({ primary: '#2e7d32' });
    expect(themes.dark.variant).toBe('dark');
    expect(themes['light-hc'].variant).toBe('light-hc');
    expect(themes.dark.brand).toEqual(themes['light-hc'].brand);
  });

  it('is deterministic', () => {
    expect(createTheme({ brand: CLUB_BRANDS.yellow, variant: 'light-hc' })).toEqual(
      createTheme({ brand: CLUB_BRANDS.yellow, variant: 'light-hc' }),
    );
  });
});
