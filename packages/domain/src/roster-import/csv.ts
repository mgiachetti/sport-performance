/**
 * Delimited text (CSV) reader for spreadsheets exported by the staff (B-330).
 * RFC 4180 with what real exports bring: a UTF-8 BOM, `\r\n` or `\n` line
 * ends, quoted fields with doubled quotes and line breaks inside, and the
 * separator Excel uses for the locale (`;` in es-AR, where `,` is the decimal
 * separator), `,` or a tab. Pure: the caller reads the file.
 */

export const CSV_DELIMITERS = [',', ';', '\t'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

export interface DelimitedText {
  delimiter: CsvDelimiter;
  /**
   * Rows of cells, as text (not trimmed), each with the 1-based line of the
   * text where it starts. Completely empty lines are dropped.
   */
  rows: { line: number; cells: string[] }[];
}

/** A malformed input: an unterminated quote, with the line where it opened. */
export class CsvSyntaxError extends Error {
  constructor(
    message: string,
    /** 1-based line of the text where the problem starts. */
    readonly line: number,
  ) {
    super(message);
    this.name = 'CsvSyntaxError';
  }
}

function stripBom(text: string): string {
  return text.startsWith('﻿') ? text.slice(1) : text;
}

function isDelimiter(char: string): char is CsvDelimiter {
  return (CSV_DELIMITERS as readonly string[]).includes(char);
}

/**
 * The separator of the first non-empty line: the candidate that appears
 * most often outside quotes (`;` wins ties, it is what es-AR Excel writes).
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>(CSV_DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  let seen = false;
  for (const char of stripBom(text)) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === '\n' || char === '\r') {
      if (seen) break;
      continue;
    }
    seen = true;
    if (isDelimiter(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let best: CsvDelimiter = ';';
  for (const delimiter of CSV_DELIMITERS) {
    if ((counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0)) best = delimiter;
  }
  return best;
}

/** Parses delimited text; `delimiter` defaults to {@link detectDelimiter}. */
export function parseDelimitedText(
  input: string,
  options: { delimiter?: CsvDelimiter } = {},
): DelimitedText {
  const text = stripBom(input);
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const rows: DelimitedText['rows'] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let quoteLine = 0;
  let line = 1;
  let rowLine = 1;
  let i = 0;

  const endRow = () => {
    cells.push(field);
    field = '';
    if (cells.some((cell) => cell.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
  };

  while (i < text.length) {
    const char = text.charAt(i);
    if (quoted) {
      if (char === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      if (char === '\n') line += 1;
      field += char;
      i += 1;
      continue;
    }
    if (char === '"' && field.trim() === '') {
      // A quote opens a quoted field only at its start (spaces before it are dropped).
      field = '';
      quoted = true;
      quoteLine = line;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      cells.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      endRow();
      if (char === '\r' && text.charAt(i + 1) === '\n') i += 1;
      line += 1;
      rowLine = line;
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (quoted) throw new CsvSyntaxError('Unterminated quoted field', quoteLine);
  if (field !== '' || cells.length > 0) endRow();
  return { delimiter, rows };
}
