/** Locales with a message catalog. `es-AR` is the source locale: every key is defined there first. */
export const SUPPORTED_LOCALES = ['es-AR'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Locale used when nothing better matches (and the source of every message). */
export const DEFAULT_LOCALE: Locale = 'es-AR';

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function canonicalize(tag: string): string | undefined {
  const cleaned = tag.trim().replace(/_/g, '-');
  if (cleaned === '' || cleaned === '*') return undefined;
  try {
    return Intl.getCanonicalLocales(cleaned)[0];
  } catch {
    return undefined;
  }
}

function languageOf(tag: string): string {
  return tag.split('-')[0]?.toLowerCase() ?? '';
}

/**
 * Picks the best supported locale for a list of preferred language tags, in order of preference
 * (for example the device languages or the parsed `Accept-Language` header).
 *
 * An exact match wins; otherwise the first tag whose language matches a supported locale
 * (`es`, `es-ES`, `es_UY` → `es-AR`). Falls back to {@link DEFAULT_LOCALE}.
 */
export function resolveLocale(preferred?: string | readonly string[] | null): Locale {
  const tags = (typeof preferred === 'string' ? [preferred] : (preferred ?? []))
    .map(canonicalize)
    .filter((tag): tag is string => tag !== undefined);

  for (const tag of tags) {
    if (isSupportedLocale(tag)) return tag;
  }
  for (const tag of tags) {
    const language = languageOf(tag);
    const match = SUPPORTED_LOCALES.find((locale) => languageOf(locale) === language);
    if (match !== undefined) return match;
  }
  return DEFAULT_LOCALE;
}

/**
 * Parses an HTTP `Accept-Language` header into language tags sorted by quality (highest first).
 * Entries with `q=0` are dropped; malformed quality values count as `q=1`, like most browsers.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (header === null || header === undefined) return [];
  return header
    .split(',')
    .map((entry, index) => {
      const [tag = '', ...params] = entry.trim().split(';');
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const parsedQ = qParam === undefined ? 1 : Number(qParam.slice(2));
      const q = Number.isFinite(parsedQ) ? parsedQ : 1;
      return { tag: tag.trim(), q, index };
    })
    .filter((entry) => entry.tag !== '' && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.tag);
}
