import {
  CsvSyntaxError,
  parseDelimitedText,
  rosterRowsFromTable,
  tableFromMatrix,
  type RosterTable,
} from '@sport-performance/domain';

/**
 * Reading the roster spreadsheet in the browser (B-330, ADR 0047): a CSV
 * with the domain's reader, or the first sheet of an Excel `.xlsx` with
 * `read-excel-file` (a dependency of the web, not of the domain), both
 * mapped by `rosterRowsFromTable` so every client reads the same headers
 * and values the same way. The file never leaves the browser: the API
 * receives the typed rows.
 */

export type RosterFileKind = 'csv' | 'xlsx';

export type RosterFileProblem =
  /** Not a CSV or an `.xlsx` (an old `.xls`, a PDF…). */
  | { code: 'unsupported_type' }
  /** An unterminated quote, with its line. */
  | { code: 'csv_syntax'; line: number }
  /** The Excel file could not be read (damaged, password-protected). */
  | { code: 'unreadable' };

export type RosterFileResult =
  | { ok: true; kind: RosterFileKind; table: RosterTable }
  | { ok: false; problem: RosterFileProblem };

/** Largest spreadsheet read (a roster of a few thousand rows is far below). */
export const ROSTER_FILE_MAX_BYTES = 5 * 1024 * 1024;

export function rosterFileKind(file: { name: string; type: string }): RosterFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || file.type.includes('spreadsheetml')) return 'xlsx';
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') return 'csv';
  return null;
}

/**
 * Text of a CSV: UTF-8 (with or without BOM) when it is valid UTF-8, else
 * Windows-1252, which is what Excel in Spanish writes by default ("Pérez"
 * would otherwise read as "P�rez").
 */
export function decodeCsv(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** A day as `YYYY-MM-DD`: Excel dates are read as UTC midnights. */
function isoDay(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** A cell of the sheet as the text the roster mapping reads. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : isoDay(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

/** The sheet (rows of cells) as text rows with their 1-based line. */
export function matrixToTable(rows: readonly (readonly unknown[])[]) {
  return tableFromMatrix(rows.map((row) => row.map(cellText)));
}

export interface ReadRosterFileOptions {
  /** Reads the first sheet of an `.xlsx`; tests pass a fake. */
  readonly readXlsx?: (file: File) => Promise<readonly (readonly unknown[])[]>;
}

async function readXlsxSheet(file: File): Promise<readonly (readonly unknown[])[]> {
  // Loaded on demand: only this screen needs it.
  const { readSheet } = await import('read-excel-file/browser');
  // `dd/mm/yyyy` is the custom date format of most es-AR sheets; the standard ones are known.
  return readSheet(file, { dateFormat: 'dd/mm/yyyy' });
}

export async function readRosterFile(
  file: File,
  options: ReadRosterFileOptions = {},
): Promise<RosterFileResult> {
  const kind = rosterFileKind(file);
  if (kind === null) return { ok: false, problem: { code: 'unsupported_type' } };
  if (kind === 'csv') {
    try {
      const parsed = parseDelimitedText(decodeCsv(await file.arrayBuffer()));
      return { ok: true, kind, table: rosterRowsFromTable(parsed.rows) };
    } catch (error) {
      if (error instanceof CsvSyntaxError) {
        return { ok: false, problem: { code: 'csv_syntax', line: error.line } };
      }
      throw error;
    }
  }
  let rows: readonly (readonly unknown[])[];
  try {
    rows = await (options.readXlsx ?? readXlsxSheet)(file);
  } catch {
    return { ok: false, problem: { code: 'unreadable' } };
  }
  return { ok: true, kind, table: rosterRowsFromTable(matrixToTable(rows)) };
}
