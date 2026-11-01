import {
  type MessageFormatElement,
  isArgumentElement,
  isDateElement,
  isNumberElement,
  isPluralElement,
  isSelectElement,
  isTimeElement,
  parse,
} from '@formatjs/icu-messageformat-parser';
import { esAR } from './es-AR.js';
import { isMessageKey } from './index.js';

/** How an ICU argument is used: plain text, number, plural selector or select selector. */
export type ArgumentKind = 'text' | 'number' | 'plural' | 'select' | 'date';

/** Options shared by every parse in this package (tags are plain text, no rich-text markup). */
export const PARSER_OPTIONS = { ignoreTag: true } as const;

function collect(elements: readonly MessageFormatElement[], out: Map<string, ArgumentKind>): void {
  for (const element of elements) {
    if (isArgumentElement(element)) {
      if (!out.has(element.value)) out.set(element.value, 'text');
    } else if (isNumberElement(element)) {
      out.set(element.value, 'number');
    } else if (isDateElement(element) || isTimeElement(element)) {
      out.set(element.value, 'date');
    } else if (isPluralElement(element) || isSelectElement(element)) {
      out.set(element.value, isPluralElement(element) ? 'plural' : 'select');
      for (const option of Object.values(element.options)) collect(option.value, out);
    }
  }
}

/**
 * Parses an ICU message and returns its arguments with how each is used.
 * Throws a `SyntaxError` if the message is not valid ICU.
 */
export function extractArguments(message: string): Map<string, ArgumentKind> {
  const args = new Map<string, ArgumentKind>();
  collect(parse(message, PARSER_OPTIONS), args);
  return args;
}

export interface CatalogIssue {
  readonly key: string;
  readonly code: 'unknown_key' | 'invalid_syntax' | 'argument_mismatch' | 'date_argument' | 'blank';
  readonly detail: string;
}

function describe(args: Map<string, ArgumentKind>): string {
  const entries = [...args].map(([name, kind]) => `${name}:${kind}`).sort();
  return entries.length === 0 ? '(none)' : entries.join(', ');
}

/**
 * Checks a catalog (another locale, or a club's terminology overrides) against the source catalog:
 * keys must exist in `es-AR`, messages must be valid ICU, use exactly the same arguments with the
 * same kind, and must not format dates themselves (dates are pre-formatted in the club time zone).
 *
 * Returns an empty array when the catalog is valid. Suitable for tests and for validating
 * overrides at write time in the API.
 */
export function validateCatalog(catalog: Readonly<Record<string, string>>): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  for (const [key, message] of Object.entries(catalog)) {
    if (!isMessageKey(key)) {
      issues.push({ key, code: 'unknown_key', detail: 'Key does not exist in the es-AR catalog.' });
      continue;
    }
    if (message.trim() === '') {
      issues.push({ key, code: 'blank', detail: 'Message is empty.' });
      continue;
    }
    let args: Map<string, ArgumentKind>;
    try {
      args = extractArguments(message);
    } catch (error) {
      issues.push({
        key,
        code: 'invalid_syntax',
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if ([...args.values()].includes('date')) {
      issues.push({
        key,
        code: 'date_argument',
        detail: 'Format dates with formatDate/formatTime (club time zone) and pass them as text.',
      });
    }
    const expected = describe(extractArguments(esAR[key]));
    const actual = describe(args);
    if (expected !== actual) {
      issues.push({
        key,
        code: 'argument_mismatch',
        detail: `Expected arguments ${expected}, got ${actual}.`,
      });
    }
  }
  return issues;
}
