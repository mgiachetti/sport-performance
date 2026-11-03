import type {
  RosterImportPreview,
  RosterImportResolution,
  ValidationIssue,
} from '@sport-performance/contracts';
import {
  ROSTER_ROW_ISSUE_CODES,
  type RosterImportRow,
  type RosterRowIssueCode,
  type RosterTable,
  type Sport,
} from '@sport-performance/domain';
import type { MessageKey } from '@sport-performance/i18n';

/**
 * The roster import as the screen builds it (B-330, ADR 0047): which rows of
 * the sheet go to the API, with the batch sport and the staff's decision for
 * each row, and how the API's answer reads in Spanish. Pure: tested apart.
 */

/** A row of the sheet that can be sent (the sheet read it without problems). */
export interface SendableRow {
  readonly sourceRow: number;
  readonly row: RosterImportRow;
}

export function sendableRows(table: RosterTable): SendableRow[] {
  return table.entries.flatMap((entry) =>
    entry.row === null ? [] : [{ sourceRow: entry.sourceRow, row: entry.row }],
  );
}

/** Rows the sheet could not read: they are left out (the staff fixes them in the file). */
export function unreadableRows(table: RosterTable) {
  return table.entries.filter((entry) => entry.row === null);
}

/** Whether the batch needs a default sport: some row does not bring its own. */
export function needsBatchSport(rows: readonly SendableRow[]): boolean {
  return rows.some((r) => r.row.sport === undefined);
}

/** The body of the preview and of the import (without `clientUuid`). */
export function rosterBatch(
  rows: readonly SendableRow[],
  sport: Sport | null,
  resolutions: ReadonlyMap<number, RosterImportResolution>,
) {
  return {
    ...(sport === null ? {} : { sport }),
    rows: rows.map((r, index) => {
      const resolution = resolutions.get(index);
      return { ...r.row, ...(resolution === undefined ? {} : { resolution }) };
    }),
  };
}

/** The import can go: every row is valid and decided. */
export function canImport(preview: RosterImportPreview): boolean {
  return (
    preview.rowCount > 0 && preview.invalidCount === 0 && preview.resolutionRequiredCount === 0
  );
}

/** Rows worth showing by default: with problems, with candidates or with a duplicate. */
export function rowNeedsAttention(row: RosterImportPreview['rows'][number]): boolean {
  return row.issues.length > 0 || row.matches.length > 0 || row.duplicateOfIndex !== null;
}

const ROW_FIELDS = [
  'firstName',
  'lastName',
  'birthDate',
  'sex',
  'sport',
  'category',
  'positions',
  'dominantSide',
  'joinedOn',
  'guardians',
  'resolution',
] as const;
export type RosterRowField = (typeof ROW_FIELDS)[number];

function isRowIssueCode(code: string): code is RosterRowIssueCode {
  return (ROSTER_ROW_ISSUE_CODES as readonly string[]).includes(code);
}

/** The field of a row an issue is about (`["body", "rows", i, field, …]`), if any. */
export function issueField(issue: Pick<ValidationIssue, 'path'>): RosterRowField | null {
  const field = issue.path[3];
  return typeof field === 'string' && (ROW_FIELDS as readonly string[]).includes(field)
    ? (field as RosterRowField)
    : null;
}

/**
 * The message of an issue of the API: its stable code (`future_date`…), or,
 * for a contract problem of the body (a zod code), "this field is not valid".
 */
export function issueMessageKey(issue: Pick<ValidationIssue, 'code'>): MessageKey {
  return isRowIssueCode(issue.code)
    ? `admin.roster.issue.${issue.code}`
    : 'admin.roster.issue.invalid';
}
