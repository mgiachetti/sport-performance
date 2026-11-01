import { describe, expect, it } from 'vitest';
import {
  CSS_VAR_PREFIX,
  applyCssVariables,
  createStylesheet,
  createTheme,
  cssVar,
  cssVarName,
  nativeFontFamilies,
  packageName,
  stripeBands,
  stripesGradient,
  textStyles,
  toCssRule,
  toCssVariables,
  toNativeTheme,
  type TextStyleRole,
} from './index.js';

it('exposes its package name', () => {
  expect(packageName).toBe('@sport-performance/ui-tokens');
});

describe('CSS output', () => {
  const theme = createTheme();
  const vars = toCssVariables(theme);

  it('names variables with the sp prefix in kebab case', () => {
    expect(CSS_VAR_PREFIX).toBe('sp');
    expect(cssVarName('color', 'surfaceRaised')).toBe('--sp-color-surface-raised');
    expect(cssVar('color', 'text', 'primary')).toBe('var(--sp-color-text-primary)');
  });

  it('emits every color token', () => {
    expect(vars['--sp-color-background']).toBe('#141210');
    expect(vars['--sp-color-text-primary']).toBe('#f3eee7');
    expect(vars['--sp-color-brand-solid']).toBe('#f1882a');
    expect(vars['--sp-color-status-critical-solid']).toBe('#e5604f');
    expect(vars['--sp-color-status-critical-fg']).toBe(theme.color.status.critical.fg);
    expect(vars['--sp-color-chart-category-average']).toBe(theme.color.chart.categoryAverage);
    const colorVars = Object.keys(vars).filter((k) => k.startsWith('--sp-color-'));
    // background, surface, surfaceRaised, 2 borders, 3 text, 6 brand, focus, 3×5 status, 8 chart.
    expect(colorVars).toHaveLength(3 + 2 + 3 + 6 + 1 + 15 + 8);
    for (const key of colorVars) expect(vars[key as `--${string}`]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('emits typography with font stacks, rem sizes and tabular figures', () => {
    expect(vars['--sp-font-condensed']).toContain("'Barlow Condensed'");
    expect(vars['--sp-font-text']).toMatch(/^'Barlow',/);
    expect(vars['--sp-text-metric-family']).toBe('var(--sp-font-condensed)');
    expect(vars['--sp-text-metric-size']).toBe('2rem');
    expect(vars['--sp-text-metric-line-height']).toBe('1.125');
    expect(vars['--sp-text-metric-numeric']).toBe('tabular-nums');
    expect(vars['--sp-text-body-numeric']).toBe('normal');
    expect(vars['--sp-text-overline-transform']).toBe('uppercase');
    expect(vars['--sp-text-overline-letter-spacing']).toBe('0.08em');
    expect(vars['--sp-text-body-letter-spacing']).toBe('0');
  });

  it('emits scales, focus ring, stripes and the reference dash', () => {
    expect(vars['--sp-space-lg']).toBe('1rem');
    expect(vars['--sp-space-none']).toBe('0');
    expect(vars['--sp-radius-pill']).toBe('9999px');
    expect(vars['--sp-border-width-hairline']).toBe('1px');
    expect(vars['--sp-focus-ring-offset']).toBe('2px');
    expect(vars['--sp-size-touch-target']).toBe('2.75rem');
    expect(vars['--sp-stripes-md']).toBe(
      'repeating-linear-gradient(180deg, #f1882a 0 10px, #050505 10px 20px)',
    );
    expect(vars['--sp-chart-reference-dash']).toBe('6 4');
  });

  it('builds rules and a stylesheet with both variants', () => {
    const rule = toCssRule(theme, '.club');
    expect(rule.startsWith('.club {\n  color-scheme: dark;\n')).toBe(true);
    expect(rule).toContain('  --sp-color-background: #141210;\n');

    const sheet = createStylesheet({ brand: { primary: '#0a2a5c' } });
    expect(sheet).toContain(':root {\n  color-scheme: dark;');
    expect(sheet).toContain('[data-theme="light-hc"] {\n  color-scheme: light;');
    expect(sheet).toContain('--sp-color-brand-solid: #0a2a5c;');
    expect(sheet.match(/--sp-color-background:/g)).toHaveLength(2);

    const custom = createStylesheet({ darkSelector: '.d', lightHighContrastSelector: '.l' });
    expect(custom).toMatch(/^\.d \{/);
    expect(custom).toContain('\n.l {');
  });

  it('applies variables at runtime to an element-like target', () => {
    const set = new Map<string, string>();
    const target = {
      style: { setProperty: (name: string, value: string) => set.set(name, value) },
    };
    applyCssVariables(target, createTheme({ brand: { primary: '#2e7d32' }, variant: 'light-hc' }));
    expect(set.get('color-scheme')).toBe('light');
    expect(set.get('--sp-color-brand-solid')).toBe('#2e7d32');
    expect(set.get('--sp-color-background')).toBe('#ffffff');
    expect(set.size).toBe(Object.keys(vars).length + 1);
  });
});

describe('React Native output', () => {
  const theme = createTheme({ variant: 'light-hc' });
  const native = toNativeTheme(theme);

  it('exposes colors and numeric scales', () => {
    expect(native.dark).toBe(false);
    expect(native.variant).toBe('light-hc');
    expect(native.colors).toBe(theme.color);
    expect(native.spacing.lg).toBe(16);
    expect(native.radius.md).toBe(8);
  });

  it('maps text roles to per-weight families and px letter spacing', () => {
    expect(native.text.metric).toEqual({
      fontFamily: 'BarlowCondensed_700Bold',
      fontSize: 32,
      lineHeight: 36,
      letterSpacing: 0,
      fontVariant: ['tabular-nums'],
    });
    expect(native.text.overline).toEqual({
      fontFamily: 'BarlowCondensed_600SemiBold',
      fontSize: 13,
      lineHeight: 16,
      letterSpacing: 1.04,
      textTransform: 'uppercase',
    });
    expect(native.text.body).toEqual({
      fontFamily: 'Barlow_400Regular',
      fontSize: 16,
      lineHeight: 24,
      letterSpacing: 0,
    });
    expect(Object.keys(native.text).sort()).toEqual(Object.keys(textStyles).sort());
  });

  it('lists every font family it needs, all of them known', () => {
    const known = new Set<string>([
      ...Object.values(nativeFontFamilies.condensed),
      ...Object.values(nativeFontFamilies.text),
    ]);
    for (const family of native.fontFamilies) expect(known.has(family)).toBe(true);
    for (const role of Object.keys(native.text) as TextStyleRole[]) {
      expect(native.fontFamilies).toContain(native.text[role].fontFamily);
    }
  });

  it('renders stripes as bands', () => {
    expect(native.stripes(25)).toEqual([
      { color: '#f1882a', height: 10 },
      { color: '#050505', height: 10 },
      { color: '#f1882a', height: 5 },
    ]);
  });
});

describe('stripes', () => {
  const theme = createTheme({ brand: { primary: '#0a2a5c', secondary: '#ffffff' } });

  it('uses the club colors', () => {
    expect(stripesGradient(theme, 'sm')).toBe(
      'repeating-linear-gradient(180deg, #0a2a5c 0 5px, #ffffff 5px 10px)',
    );
    expect(stripesGradient(theme)).toContain('0 10px');
  });

  it('fills the requested height exactly', () => {
    const bands = stripeBands(theme, 37, 'lg');
    expect(bands.map((b) => b.height)).toEqual([16, 16, 5]);
    expect(bands.map((b) => b.color)).toEqual(['#0a2a5c', '#ffffff', '#0a2a5c']);
    expect(stripeBands(theme, 0)).toEqual([]);
  });

  it('rejects invalid heights', () => {
    expect(() => stripeBands(theme, -1)).toThrow(RangeError);
    expect(() => stripeBands(theme, Number.NaN)).toThrow(RangeError);
  });
});
