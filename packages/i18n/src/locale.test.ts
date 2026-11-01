import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isSupportedLocale, parseAcceptLanguage, resolveLocale } from './locale.js';

describe('resolveLocale', () => {
  it('defaults to es-AR', () => {
    expect(DEFAULT_LOCALE).toBe('es-AR');
    expect(resolveLocale()).toBe('es-AR');
    expect(resolveLocale(null)).toBe('es-AR');
    expect(resolveLocale([])).toBe('es-AR');
  });

  it('matches exact tags regardless of case or underscore', () => {
    expect(resolveLocale('es-AR')).toBe('es-AR');
    expect(resolveLocale('es-ar')).toBe('es-AR');
    expect(resolveLocale('es_AR')).toBe('es-AR');
  });

  it('falls back by language, then to the default', () => {
    expect(resolveLocale(['en-US', 'es-UY'])).toBe('es-AR');
    expect(resolveLocale('es')).toBe('es-AR');
    expect(resolveLocale(['fr-FR', 'en'])).toBe('es-AR');
  });

  it('ignores malformed tags and wildcards', () => {
    expect(resolveLocale(['', '*', 'not a tag!', 'es-AR'])).toBe('es-AR');
  });

  it('works with a parsed Accept-Language header', () => {
    expect(resolveLocale(parseAcceptLanguage('en-US,en;q=0.9,es-AR;q=0.8'))).toBe('es-AR');
  });
});

describe('isSupportedLocale', () => {
  it('only accepts canonical supported tags', () => {
    expect(isSupportedLocale('es-AR')).toBe(true);
    expect(isSupportedLocale('es')).toBe(false);
    expect(isSupportedLocale('en-US')).toBe(false);
  });
});

describe('parseAcceptLanguage', () => {
  it('sorts by quality and keeps order for ties', () => {
    expect(parseAcceptLanguage('en;q=0.5, es-AR, es;q=0.9, pt')).toEqual([
      'es-AR',
      'pt',
      'es',
      'en',
    ]);
  });

  it('drops q=0 and empty entries; malformed q counts as 1', () => {
    expect(parseAcceptLanguage('fr;q=0, ,de;q=abc')).toEqual(['de']);
  });

  it('handles missing headers', () => {
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage('')).toEqual([]);
  });
});
