import type { Locale } from '../locale.js';
import { esAR } from './es-AR.js';

export { esAR } from './es-AR.js';

/** The source catalog type. */
export type SourceMessages = typeof esAR;

/** Every message key, taken from the source (`es-AR`) catalog. */
export type MessageKey = keyof SourceMessages;

/**
 * A catalog for a locale other than the source, or a club override set.
 * It may be partial: missing keys fall back to the source catalog.
 */
export type MessageCatalog = Partial<Record<MessageKey, string>>;

/** Catalogs bundled with the package, by locale. */
export const catalogs: Readonly<Record<Locale, MessageCatalog>> = {
  'es-AR': esAR,
};

/** All message keys of the source catalog, in declaration order. */
export const messageKeys = Object.keys(esAR) as MessageKey[];

export function isMessageKey(value: string): value is MessageKey {
  return Object.hasOwn(esAR, value);
}

type HasArguments<S extends string> = S extends `${string}{${string}}${string}` ? true : false;

/** Value accepted for an ICU argument. Dates and measures are formatted before being passed. */
export type MessageValue = string | number;

/** Values for the ICU arguments of a message, by argument name. */
export type MessageValues = Readonly<Record<string, MessageValue>>;

/**
 * Arguments for `t(key, ...)`: messages with ICU arguments require a values object; messages
 * without arguments take none.
 */
export type MessageArgs<K extends MessageKey> =
  HasArguments<SourceMessages[K]> extends true ? [values: MessageValues] : [values?: undefined];
