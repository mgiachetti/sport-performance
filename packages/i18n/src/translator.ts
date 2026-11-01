import { IntlMessageFormat } from 'intl-messageformat';
import { DEFAULT_LOCALE, type Locale } from './locale.js';
import {
  type MessageArgs,
  type MessageCatalog,
  type MessageKey,
  catalogs,
  esAR,
} from './messages/index.js';
import { PARSER_OPTIONS } from './messages/validate.js';

export interface TranslatorOptions {
  /** Defaults to {@link DEFAULT_LOCALE}. Use `resolveLocale()` to pick it from user preferences. */
  readonly locale?: Locale;
  /**
   * Per-club terminology overrides, applied on top of the locale catalog. Validate them with
   * `validateCatalog()` when they are saved.
   */
  readonly overrides?: MessageCatalog;
}

export interface Translator {
  readonly locale: Locale;
  /**
   * Formats the message `key`. Messages with ICU arguments require their values; numbers are
   * formatted es-AR (`1.234,5`) and pick the plural form. Throws if a value is missing.
   * Safe to destructure (`const { t } = createTranslator()`).
   */
  readonly t: <K extends MessageKey>(key: K, ...args: MessageArgs<K>) => string;
}

/** Error thrown when a message cannot be formatted (missing or invalid argument value). */
export class MessageFormatError extends Error {
  readonly key: MessageKey;
  readonly locale: Locale;

  constructor(key: MessageKey, locale: Locale, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Cannot format message "${key}" (${locale}): ${reason}`, { cause });
    this.name = 'MessageFormatError';
    this.key = key;
    this.locale = locale;
  }
}

/**
 * Creates a translator bound to a locale. Formatters are compiled lazily per key and cached for
 * the lifetime of the translator, so create one per locale/club and reuse it.
 *
 * Lookup order per key: club overrides → locale catalog → `es-AR` source catalog.
 */
export function createTranslator(options: TranslatorOptions = {}): Translator {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const catalog = catalogs[locale];
  const overrides = options.overrides ?? {};
  const cache = new Map<MessageKey, IntlMessageFormat>();

  const compile = (key: MessageKey): IntlMessageFormat => {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const message = overrides[key] ?? catalog[key] ?? esAR[key];
    const formatter = new IntlMessageFormat(message, locale, undefined, PARSER_OPTIONS);
    cache.set(key, formatter);
    return formatter;
  };

  return {
    locale,
    t: (key, ...args) => {
      try {
        const result = compile(key).format<string>(args[0]);
        return Array.isArray(result) ? result.join('') : result;
      } catch (error) {
        throw new MessageFormatError(key, locale, error);
      }
    },
  };
}
