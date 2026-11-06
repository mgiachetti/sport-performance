/**
 * ECMA-402 APIs the app needs that Hermes does not provide (ADR 0099):
 * `Intl.PluralRules` (every ICU `plural` message, e.g. the sign-in code
 * screen), `Intl.Locale`, and `DateTimeFormat.prototype.formatToParts` with
 * `timeZone` (the club's day, `@sport-performance/domain` time). Each FormatJS
 * polyfill installs itself only where the engine's own is missing or
 * incomplete, so in Node (tests) and on a full engine it is a no-op.
 *
 * Imported first by the app entry (`app/_layout.tsx`), before any module that
 * formats. Order matters: each polyfill relies on the previous ones.
 */
import '@formatjs/intl-getcanonicallocales/polyfill.js';
import '@formatjs/intl-locale/polyfill.js';
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/es.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-numberformat/polyfill.js';
import '@formatjs/intl-numberformat/locale-data/es.js';
import '@formatjs/intl-numberformat/locale-data/en.js';
import '@formatjs/intl-datetimeformat/polyfill.js';
import '@formatjs/intl-datetimeformat/locale-data/es.js';
import '@formatjs/intl-datetimeformat/locale-data/en.js';
// Every IANA zone: a club can be in any of them.
import '@formatjs/intl-datetimeformat/add-all-tz.js';

interface PolyfilledDateTimeFormat {
  __setDefaultTimeZone?: (timeZone: string) => void;
}

/**
 * The polyfilled `DateTimeFormat` defaults to UTC; this makes it default to
 * the phone's zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), as
 * the native one does. A no-op when the engine's own is in use.
 */
export function setDefaultTimeZone(timeZone: string | null | undefined): void {
  const setter = (Intl.DateTimeFormat as unknown as PolyfilledDateTimeFormat).__setDefaultTimeZone;
  if (
    typeof setter !== 'function' ||
    timeZone === null ||
    timeZone === undefined ||
    timeZone === ''
  )
    return;
  try {
    setter(timeZone);
  } catch {
    // An unknown zone keeps UTC rather than breaking the app at launch.
  }
}
