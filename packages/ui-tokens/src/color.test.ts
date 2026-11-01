import { describe, expect, it } from 'vitest';
import {
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
} from './color.js';

describe('normalizeHex', () => {
  it('normalizes short, long and unprefixed forms to lowercase #rrggbb', () => {
    expect(normalizeHex('#F1882A')).toBe('#f1882a');
    expect(normalizeHex('f1882a')).toBe('#f1882a');
    expect(normalizeHex('#FfF')).toBe('#ffffff');
    expect(normalizeHex('  #abc ')).toBe('#aabbcc');
  });

  it.each([['#12345'], ['red'], ['#ggg'], [''], [42], [null], [undefined], ['#1234567']])(
    'rejects %j',
    (value) => {
      expect(() => normalizeHex(value)).toThrow(InvalidColorError);
      expect(isHexColor(value)).toBe(false);
    },
  );
});

describe('rgb conversions', () => {
  it('round-trips', () => {
    expect(hexToRgb('#f1882a')).toEqual({ r: 241, g: 136, b: 42 });
    expect(rgbToHex({ r: 241, g: 136, b: 42 })).toBe('#f1882a');
  });

  it('clamps and rounds channels', () => {
    expect(rgbToHex({ r: -4, g: 255.6, b: 127.5 })).toBe('#00ff80');
  });
});

describe('contrast', () => {
  it('matches WCAG reference values', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    // WebAIM checker: #767676 on white is 4.54:1.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#f1882a', '#141210')).toBe(contrastRatio('#141210', '#f1882a'));
  });
});

describe('mix and alpha', () => {
  it('interpolates in sRGB and clamps the weight', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#000000', '#ffffff', -1)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 2)).toBe('#ffffff');
  });

  it('formats alpha for RN and modern CSS', () => {
    expect(withAlpha('#f1882a', 0.5)).toBe('rgba(241, 136, 42, 0.5)');
    expect(withAlpha('#f1882a', 0.5, 'css')).toBe('rgb(241 136 42 / 0.5)');
  });
});

describe('mostContrasting', () => {
  it('picks the best ink', () => {
    expect(mostContrasting('#f1882a', ['#050505', '#ffffff'])).toBe('#050505');
    expect(mostContrasting('#0a2a5c', ['#050505', '#ffffff'])).toBe('#ffffff');
  });

  it('requires candidates', () => {
    expect(() => mostContrasting('#000000', [])).toThrow(RangeError);
  });
});

describe('ensureContrast', () => {
  it('keeps colors that already pass', () => {
    expect(ensureContrast('#F1882A', '#141210', CONTRAST.aa)).toBe('#f1882a');
  });

  it('lightens on dark backgrounds and darkens on light ones, minimally', () => {
    const navy = '#0a2a5c';
    const onDark = ensureContrast(navy, '#141210', CONTRAST.aa);
    expect(contrastRatio(onDark, '#141210')).toBeGreaterThanOrEqual(CONTRAST.aa);
    expect(relativeLuminance(onDark)).toBeGreaterThan(relativeLuminance(navy));
    // Minimal: one 8-bit step less toward white would fail.
    expect(contrastRatio(onDark, '#141210')).toBeLessThan(CONTRAST.aa + 0.15);

    const orange = '#f1882a';
    const onWhite = ensureContrast(orange, '#ffffff', CONTRAST.aaa);
    expect(contrastRatio(onWhite, '#ffffff')).toBeGreaterThanOrEqual(CONTRAST.aaa);
    expect(relativeLuminance(onWhite)).toBeLessThan(relativeLuminance(orange));
    // Hue survives: red channel still dominates.
    const { r, g, b } = hexToRgb(onWhite);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('falls back to the other direction or the best ink when needed', () => {
    // On mid grey, 7:1 is unreachable toward white; black reaches it.
    const result = ensureContrast('#888888', '#959595', CONTRAST.aaa);
    expect(contrastRatio(result, '#959595')).toBeGreaterThanOrEqual(CONTRAST.aaa);
    // Impossible ratio: best effort.
    expect(ensureContrast('#888888', '#777777', 22)).toBe('#000000');
  });
});

describe('ensureContrastAll', () => {
  it('satisfies every background', () => {
    const bgs = ['#141210', '#1c1916', '#24201c'];
    const muted = ensureContrastAll('#857b70', bgs, CONTRAST.aa);
    for (const bg of bgs) expect(contrastRatio(muted, bg)).toBeGreaterThanOrEqual(CONTRAST.aa);
  });

  it('returns the color unchanged when no background needs it', () => {
    expect(ensureContrastAll('#F3EEE7', ['#141210'], CONTRAST.aa)).toBe('#f3eee7');
    expect(ensureContrastAll('#F3EEE7', [], CONTRAST.aa)).toBe('#f3eee7');
  });
});
