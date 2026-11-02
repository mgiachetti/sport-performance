import type { GuardianRelationship } from '../guardian.js';
import type { DominantSide } from '../player.js';
import type { Sex } from '../sex.js';
import type { Sport } from '../sport.js';
import { isLocalDate, type LocalDate } from '../time.js';

/**
 * From a spreadsheet to rows of the roster import (B-330, ADR 0047). The
 * web reads the file (a CSV with {@link parseDelimitedText}, an Excel sheet
 * with its reader, as text cells) and maps the table here, so every client
 * reads the same headers and values the same way; the API receives the rows
 * already typed and validates them against the club.
 *
 * Headers are recognised in Spanish (rioplatense) and English, regardless of
 * case, accents and punctuation. Values too: `dd/mm/aaaa` dates, `M` / `F`,
 * `madre`, `izquierdo`. A cell that cannot be read is an issue with its row
 * and column, never a guess.
 */

/** A guardian of a row: the email to link or invite, and the relationship. */
export interface RosterImportGuardian {
  email: string;
  relationship: GuardianRelationship;
}

/** One player of the spreadsheet, typed (the body row of the import, B-330). */
export interface RosterImportRow {
  /** Row of the spreadsheet (1-based, the header is a row too): for messages. */
  sourceRow?: number;
  firstName: string;
  lastName: string;
  birthDate: LocalDate;
  sex: Sex;
  sport?: Sport;
  /** Name of the category, or its age band code (`M15`). */
  category?: string;
  /** Position codes or labels of the club, the main one first. */
  positions?: string[];
  dominantSide?: DominantSide;
  joinedOn?: LocalDate;
  guardians?: RosterImportGuardian[];
}

/** Fields a column can carry. */
export const ROSTER_COLUMN_FIELDS = [
  'firstName',
  'lastName',
  'fullName',
  'birthDate',
  'sex',
  'sport',
  'category',
  'positions',
  'dominantSide',
  'joinedOn',
  'guardianEmail',
  'guardianRelationship',
] as const;
export type RosterColumnField = (typeof ROSTER_COLUMN_FIELDS)[number];

export interface RosterColumn {
  /** 0-based index of the column in the table. */
  index: number;
  /** The header as written. */
  header: string;
  /** What it carries; `null`: not recognised (reported, never read). */
  field: RosterColumnField | null;
  /** Guardian columns: which guardian of the row (`1`, `2`, `madre`, `padre`). */
  guardianSlot?: string;
  /** Guardian email columns named after the parent (`Email madre`). */
  impliedRelationship?: GuardianRelationship;
}

export const ROSTER_TABLE_ISSUE_CODES = [
  'empty_table',
  'missing_column',
  'repeated_column',
  'required',
  'invalid_date',
  'invalid_sex',
  'invalid_sport',
  'invalid_dominant_side',
  'invalid_relationship',
  'invalid_email',
  'full_name_without_comma',
  'relationship_without_email',
  'guardian_without_relationship',
  'too_many_guardians',
  'repeated_guardian',
] as const;
export type RosterTableIssueCode = (typeof ROSTER_TABLE_ISSUE_CODES)[number];

export interface RosterTableIssue {
  code: RosterTableIssueCode;
  /** Row of the table (1-based); absent for issues of the whole table. */
  sourceRow?: number;
  /** Header of the column, when the issue is about one. */
  column?: string;
  /** The cell as written. */
  value?: string;
}

/** One data row: the typed row, or the issues that kept it from being one. */
export type RosterTableEntry =
  | { sourceRow: number; row: RosterImportRow; issues: [] }
  | { sourceRow: number; row: null; issues: RosterTableIssue[] };

export interface RosterTable {
  columns: RosterColumn[];
  /** Problems of the table itself (no header, a required column missing). */
  issues: RosterTableIssue[];
  entries: RosterTableEntry[];
}

/** Most guardians per row of the import. */
export const ROSTER_IMPORT_MAX_GUARDIANS = 2;

/** A header or a value, comparable: no accents, lowercase, words split by one space. */
export function normalizeHeader(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const SIMPLE_HEADERS: [RegExp, RosterColumnField][] = [
  [/^(nombres?|primer nombre|first ?name|given name)$/, 'firstName'],
  [/^(apellidos?|last ?name|surname|family name)$/, 'lastName'],
  [
    /^(apellidos? y nombres?|apellidos? nombres?|nombre y apellido|nombres? y apellidos?|nombre completo|full name)$/,
    'fullName',
  ],
  [
    /^(fecha (de )?nacimiento|fecha nac|f nac|fnac|nacimiento|birth ?date|date of birth|dob)$/,
    'birthDate',
  ],
  [/^(sexo|sex)$/, 'sex'],
  [/^(deporte|sport)$/, 'sport'],
  [/^(categoria|category|cat)$/, 'category'],
  [/^(posicion|posiciones|puesto|puestos|position|positions)$/, 'positions'],
  [
    /^(lado dominante|pie habil|pie dominante|mano habil|mano dominante|perfil|lateralidad|dominant side)$/,
    'dominantSide',
  ],
  [/^(fecha (de )?(alta|ingreso)|alta|ingreso|joined on|join date)$/, 'joinedOn'],
];

const EMAIL_WORD = '(?:email|e mail|mail|correo(?: electronico)?)';
const GUARDIAN_WORD = '(?:tutor|tutora|tutor a|responsable|guardian)';
const GUARDIAN_EMAIL = [
  new RegExp(`^${EMAIL_WORD} (?:(?:del?|de la) )?${GUARDIAN_WORD}(?: (\\d))?$`),
  new RegExp(`^${GUARDIAN_WORD}(?: (\\d))? ${EMAIL_WORD}$`),
];
const PARENT_EMAIL = [
  new RegExp(`^${EMAIL_WORD} (?:(?:del?|de la) )?(madre|padre|mama|papa)$`),
  new RegExp(`^(madre|padre|mama|papa) ${EMAIL_WORD}$`),
];
const GUARDIAN_RELATIONSHIP = [
  new RegExp(
    `^(?:vinculo|relacion|parentesco|relationship)(?: (?:(?:del?|de la) )?${GUARDIAN_WORD})?(?: (\\d))?$`,
  ),
  new RegExp(`^${GUARDIAN_WORD}(?: (\\d))? (?:vinculo|relacion|parentesco|relationship)$`),
];

/** What a header carries. */
export function classifyHeader(header: string, index: number): RosterColumn {
  const text = normalizeHeader(header);
  for (const [pattern, field] of SIMPLE_HEADERS) {
    if (pattern.test(text)) return { index, header, field };
  }
  for (const pattern of GUARDIAN_EMAIL) {
    const match = pattern.exec(text);
    if (match !== null) {
      return { index, header, field: 'guardianEmail', guardianSlot: match[1] ?? '1' };
    }
  }
  for (const pattern of PARENT_EMAIL) {
    const match = pattern.exec(text);
    if (match !== null) {
      const relationship: GuardianRelationship = /^(madre|mama)$/.test(match[1] ?? '')
        ? 'mother'
        : 'father';
      return {
        index,
        header,
        field: 'guardianEmail',
        guardianSlot: relationship,
        impliedRelationship: relationship,
      };
    }
  }
  for (const pattern of GUARDIAN_RELATIONSHIP) {
    const match = pattern.exec(text);
    if (match !== null) {
      return { index, header, field: 'guardianRelationship', guardianSlot: match[1] ?? '1' };
    }
  }
  return { index, header, field: null };
}

function lookup<T extends string>(table: Record<string, T>): (text: string) => T | undefined {
  return (text) => table[normalizeHeader(text)];
}

export const parseSexCell = lookup<Sex>({
  m: 'male',
  masc: 'male',
  masculino: 'male',
  varon: 'male',
  hombre: 'male',
  h: 'male',
  male: 'male',
  f: 'female',
  fem: 'female',
  femenino: 'female',
  mujer: 'female',
  female: 'female',
});

export const parseSportCell = lookup<Sport>({
  rugby: 'rugby',
  hockey: 'hockey',
  'hockey sobre cesped': 'hockey',
  'hockey cesped': 'hockey',
  'field hockey': 'hockey',
});

export const parseDominantSideCell = lookup<DominantSide>({
  izquierdo: 'left',
  izquierda: 'left',
  izq: 'left',
  i: 'left',
  zurdo: 'left',
  zurda: 'left',
  left: 'left',
  l: 'left',
  derecho: 'right',
  derecha: 'right',
  der: 'right',
  d: 'right',
  diestro: 'right',
  diestra: 'right',
  right: 'right',
  r: 'right',
  ambos: 'both',
  ambidiestro: 'both',
  ambidiestra: 'both',
  ambidextro: 'both',
  ambidextra: 'both',
  both: 'both',
});

export const parseRelationshipCell = lookup<GuardianRelationship>({
  madre: 'mother',
  mama: 'mother',
  mother: 'mother',
  padre: 'father',
  papa: 'father',
  father: 'father',
  tutor: 'legal_guardian',
  tutora: 'legal_guardian',
  'tutor legal': 'legal_guardian',
  'tutora legal': 'legal_guardian',
  'tutor a legal': 'legal_guardian',
  'legal guardian': 'legal_guardian',
  legal_guardian: 'legal_guardian',
  otro: 'other',
  otra: 'other',
  other: 'other',
});

/**
 * A date as spreadsheets write it: `dd/mm/aaaa` (also with `-` or `.`, and
 * one-digit day or month) or ISO `aaaa-mm-dd`, optionally with a midnight
 * time (an Excel date read as a date-time). Two-digit years and Excel serial
 * numbers are not dates here: the century or the epoch would be a guess.
 */
export function parseSpreadsheetDate(text: string): LocalDate | undefined {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]00:00(?::00(?:\.0+)?)?(?:Z)?)?$/.exec(value);
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  let candidate: string | undefined;
  if (iso !== null) candidate = `${iso[1] ?? ''}-${iso[2] ?? ''}-${iso[3] ?? ''}`;
  if (local !== null) {
    const [, day = '', month = '', year = ''] = local;
    candidate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return candidate !== undefined && isLocalDate(candidate) ? candidate : undefined;
}

/** A name cell: trimmed, inner whitespace collapsed. */
export function cleanNameCell(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** `Pérez, Juan Ignacio` → last and first name; without a comma the split is a guess. */
export function splitFullName(text: string): { firstName: string; lastName: string } | undefined {
  const comma = text.indexOf(',');
  if (comma < 0) return undefined;
  const lastName = cleanNameCell(text.slice(0, comma));
  const firstName = cleanNameCell(text.slice(comma + 1));
  if (lastName === '' || firstName === '' || firstName.includes(',')) return undefined;
  return { firstName, lastName };
}

/** Several positions in one cell: `hooker / pilar`, `hooker, pilar`. */
export function splitPositionsCell(text: string): string[] {
  return text
    .split(/[,;/|]+/)
    .map((part) => cleanNameCell(part))
    .filter((part) => part !== '');
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Maps a table (header row first) to roster rows; see the module comment. */
export function rosterRowsFromTable(
  rows: readonly { line: number; cells: readonly string[] }[],
): RosterTable {
  const [header, ...data] = rows;
  if (header === undefined) {
    return { columns: [], issues: [{ code: 'empty_table' }], entries: [] };
  }
  const columns = header.cells.map((cell, index) => classifyHeader(cell, index));
  const issues: RosterTableIssue[] = [];

  const key = (c: RosterColumn) => `${c.field ?? ''}|${c.guardianSlot ?? ''}`;
  const seen = new Set<string>();
  for (const column of columns) {
    if (column.field === null) continue;
    if (seen.has(key(column))) issues.push({ code: 'repeated_column', column: column.header });
    seen.add(key(column));
  }
  const has = (field: RosterColumnField) => columns.some((c) => c.field === field);
  const hasNames = (has('firstName') && has('lastName')) || has('fullName');
  if (!hasNames) issues.push({ code: 'missing_column', column: 'Apellido / Nombre' });
  if (!has('birthDate')) issues.push({ code: 'missing_column', column: 'Fecha de nacimiento' });
  if (!has('sex')) issues.push({ code: 'missing_column', column: 'Sexo' });
  if (issues.length > 0) return { columns, issues, entries: [] };

  const first = (field: RosterColumnField) => columns.find((c) => c.field === field);
  const slots = [
    ...new Set(
      columns
        .filter((c) => c.field === 'guardianEmail' || c.field === 'guardianRelationship')
        .map((c) => c.guardianSlot ?? '1'),
    ),
  ];

  const entries = data.map(({ line, cells }): RosterTableEntry => {
    const rowIssues: RosterTableIssue[] = [];
    const cell = (column: RosterColumn | undefined) =>
      column === undefined ? '' : (cells[column.index] ?? '').trim();
    const fail = (code: RosterTableIssueCode, column: RosterColumn | undefined, value?: string) => {
      rowIssues.push({
        code,
        sourceRow: line,
        ...(column !== undefined && { column: column.header }),
        ...(value !== undefined && value !== '' && { value }),
      });
    };

    let firstName = cleanNameCell(cell(first('firstName')));
    let lastName = cleanNameCell(cell(first('lastName')));
    const fullColumn = first('fullName');
    if ((firstName === '' || lastName === '') && fullColumn !== undefined && cell(fullColumn)) {
      const split = splitFullName(cell(fullColumn));
      if (split === undefined) fail('full_name_without_comma', fullColumn, cell(fullColumn));
      else ({ firstName, lastName } = split);
    } else {
      if (firstName === '') fail('required', first('firstName') ?? fullColumn);
      if (lastName === '') fail('required', first('lastName') ?? fullColumn);
    }

    const date = (field: 'birthDate' | 'joinedOn', required: boolean) => {
      const column = first(field);
      const text = cell(column);
      if (text === '') {
        if (required) fail('required', column);
        return undefined;
      }
      const parsed = parseSpreadsheetDate(text);
      if (parsed === undefined) fail('invalid_date', column, text);
      return parsed;
    };
    const birthDate = date('birthDate', true);
    const joinedOn = date('joinedOn', false);

    const vocabulary = <T>(
      field: RosterColumnField,
      parse: (text: string) => T | undefined,
      code: RosterTableIssueCode,
      required: boolean,
    ): T | undefined => {
      const column = first(field);
      const text = cell(column);
      if (text === '') {
        if (required) fail('required', column);
        return undefined;
      }
      const parsed = parse(text);
      if (parsed === undefined) fail(code, column, text);
      return parsed;
    };
    const sex = vocabulary('sex', parseSexCell, 'invalid_sex', true);
    const sport = vocabulary('sport', parseSportCell, 'invalid_sport', false);
    const dominantSide = vocabulary(
      'dominantSide',
      parseDominantSideCell,
      'invalid_dominant_side',
      false,
    );
    const category = cleanNameCell(cell(first('category')));
    const positions = splitPositionsCell(cell(first('positions')));

    const guardians: RosterImportGuardian[] = [];
    for (const slot of slots) {
      const emailColumn = columns.find(
        (c) => c.field === 'guardianEmail' && c.guardianSlot === slot,
      );
      const relationshipColumn = columns.find(
        (c) => c.field === 'guardianRelationship' && c.guardianSlot === slot,
      );
      const email = cell(emailColumn).toLowerCase();
      const relationshipText = cell(relationshipColumn);
      if (email === '') {
        if (relationshipText !== '') {
          fail('relationship_without_email', relationshipColumn, relationshipText);
        }
        continue;
      }
      if (!EMAIL_PATTERN.test(email)) {
        fail('invalid_email', emailColumn, email);
        continue;
      }
      let relationship = emailColumn?.impliedRelationship;
      if (relationshipText !== '') {
        relationship = parseRelationshipCell(relationshipText);
        if (relationship === undefined) {
          fail('invalid_relationship', relationshipColumn, relationshipText);
          continue;
        }
      }
      if (relationship === undefined) {
        fail('guardian_without_relationship', relationshipColumn ?? emailColumn, email);
        continue;
      }
      if (guardians.some((g) => g.email === email)) {
        fail('repeated_guardian', emailColumn, email);
        continue;
      }
      guardians.push({ email, relationship });
    }
    if (guardians.length > ROSTER_IMPORT_MAX_GUARDIANS) fail('too_many_guardians', undefined);

    if (
      rowIssues.length > 0 ||
      birthDate === undefined ||
      sex === undefined ||
      firstName === '' ||
      lastName === ''
    ) {
      return { sourceRow: line, row: null, issues: rowIssues };
    }
    return {
      sourceRow: line,
      row: {
        sourceRow: line,
        firstName,
        lastName,
        birthDate,
        sex,
        ...(sport !== undefined && { sport }),
        ...(category !== '' && { category }),
        ...(positions.length > 0 && { positions }),
        ...(dominantSide !== undefined && { dominantSide }),
        ...(joinedOn !== undefined && { joinedOn }),
        ...(guardians.length > 0 && { guardians }),
      },
      issues: [],
    };
  });
  return { columns, issues, entries };
}

/** A plain matrix (an Excel sheet as text) as rows with their 1-based line. */
export function tableFromMatrix(
  matrix: readonly (readonly string[])[],
): { line: number; cells: readonly string[] }[] {
  return matrix
    .map((cells, index) => ({ line: index + 1, cells }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ''));
}
