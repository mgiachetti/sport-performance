import { isLocalDate, type TimeZone } from '@sport-performance/domain';
import { formatDateTime, formatLocalDate, formatNumber } from '@sport-performance/i18n';

/**
 * CSV in the formats of es-AR (ADR 0072, CLAUDE.md), as Excel and LibreOffice
 * open it with a Spanish locale and as `read.csv2` / `pandas(sep=';',
 * decimal=',')` read it back:
 *
 * - UTF-8 with BOM (Excel guesses the encoding from it), CRLF line ends and
 *   RFC 4180 quoting (`"` doubled, fields with `;`, `"`, CR or LF quoted);
 * - `;` between fields: the comma is the decimal separator;
 * - numbers with a decimal comma and **no** thousands separator: a CSV is
 *   read back as numbers, and `1.234` would be a thousandth there;
 * - club days as `dd/mm/aaaa`, instants as `dd/mm/aaaa HH:mm` in the club's
 *   zone; booleans `si` / `no`; empty for a missing value.
 *
 * Text a spreadsheet would take for a formula (`=`, `+`, `-`, `@`, tab or CR
 * first, CWE-1236) gets a leading `'`: names, notes and conditions are typed
 * by people. Numbers and dates are never text, so a negative PHV offset stays
 * a number.
 */

export const CSV_SEPARATOR = ';';
export const CSV_LINE_END = '\r\n';
/** U+FEFF, the byte order mark (`EF BB BF` in UTF-8). */
export const CSV_BOM = String.fromCharCode(0xfeff);

/**
 * What a column holds, which decides how a value is written:
 * - `text`: free text typed by people (neutralized against formulas);
 * - `code`: a closed vocabulary or identifier (`sprint_40`, a uuid);
 * - `integer` / `decimal`: numbers (`decimals` = most decimals kept);
 * - `date`: a club day (`aaaa-mm-dd` from the database);
 * - `datetime`: an instant, in the club's zone;
 * - `boolean`; `list`: values joined with `, `; `json`: an object as JSON.
 */
export type CsvColumnType =
  'text' | 'code' | 'integer' | 'decimal' | 'date' | 'datetime' | 'boolean' | 'list' | 'json';

export interface CsvColumn {
  /** Key of the value in the database row. */
  readonly key: string;
  /** Header of the column: Spanish `snake_case`, with the unit when there is one. */
  readonly header: string;
  readonly type: CsvColumnType;
  /** Most decimals of a `decimal` (default 6: values are written as stored, rounded only there). */
  readonly decimals?: number;
  /** Unit code of the values (`s`, `cm`, `au`); `null` when the column has none. */
  readonly unit?: string | null;
  /** What the column is, for `diccionario.csv`. */
  readonly description: string;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Quotes a field when RFC 4180 needs it. */
export function quoteCsvField(field: string): string {
  return /[;"\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/** Text typed by people, made inert for a spreadsheet. */
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** A value as text: strings as they are, other scalars with `String`, the rest as JSON. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

function numberCell(value: unknown, decimals: number, integer: boolean): string {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    throw new TypeError(`Not a finite number: ${textOf(value)}`);
  }
  if (integer && !Number.isInteger(number)) {
    throw new TypeError(`Not an integer: ${textOf(value)}`);
  }
  return formatNumber(number, { maxDecimals: integer ? 0 : decimals, grouping: false });
}

/** One value as the text of its cell (before quoting). Throws on a value of the wrong type. */
export function formatCsvCell(value: unknown, column: CsvColumn, timeZone: TimeZone): string {
  if (value === null || value === undefined) return '';
  switch (column.type) {
    case 'text':
    case 'code':
      return neutralizeFormula(textOf(value));
    case 'integer':
      return numberCell(value, 0, true);
    case 'decimal':
      return numberCell(value, column.decimals ?? 6, false);
    case 'date': {
      if (!isLocalDate(value)) throw new TypeError(`Not a club day: ${textOf(value)}`);
      return formatLocalDate(value);
    }
    case 'datetime': {
      const instant = value instanceof Date ? value : new Date(textOf(value));
      if (Number.isNaN(instant.getTime())) throw new TypeError(`Not an instant: ${textOf(value)}`);
      return formatDateTime(instant, { timeZone });
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new TypeError(`Not a boolean: ${textOf(value)}`);
      return value ? 'si' : 'no';
    case 'list': {
      if (!Array.isArray(value)) throw new TypeError(`Not a list: ${textOf(value)}`);
      return neutralizeFormula(value.map(textOf).join(', '));
    }
    case 'json': {
      if (typeof value === 'object' && Object.keys(value).length === 0) return '';
      return neutralizeFormula(JSON.stringify(value));
    }
  }
}

/** A whole line, quoted and with its CRLF. */
export function csvLine(fields: readonly string[]): string {
  return fields.map(quoteCsvField).join(CSV_SEPARATOR) + CSV_LINE_END;
}

/** The header line of a set of columns (with the BOM: it starts the file). */
export function csvHeader(columns: readonly CsvColumn[]): string {
  return CSV_BOM + csvLine(columns.map((column) => column.header));
}

/** A database row as a CSV line of `columns`. */
export function csvRow(
  row: Readonly<Record<string, unknown>>,
  columns: readonly CsvColumn[],
  timeZone: TimeZone,
): string {
  return csvLine(columns.map((column) => formatCsvCell(row[column.key], column, timeZone)));
}
