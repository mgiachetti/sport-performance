import { rosterRowsFromTable, type RosterTable } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { sha256Base64 } from '../api/storage-upload';
import { club } from '../test/fixtures';
import { assignmentBody, assignmentDraftErrors } from './AssignmentsSection';
import { missingBranches, parseSortOrder } from './CategoriesSection';
import { clubDraftErrors, clubDraftOf, clubPatch } from './ClubSection';
import { invitationFormErrors } from './InvitationsSection';
import { clubSports, isDefaultPosition, parsePositionLabel } from './PositionsSection';
import { cellText, decodeCsv, matrixToTable, readRosterFile, rosterFileKind } from './roster-file';
import {
  canImport,
  issueField,
  issueMessageKey,
  needsBatchSport,
  rosterBatch,
  rowNeedsAttention,
  sendableRows,
  unreadableRows,
} from './roster-model';
import { currentRollover, decisionValue } from './SeasonRolloverPage';
import { rollover } from '../test/admin-fixtures';

describe('roster file', () => {
  it('knows CSV and Excel files by name or type', () => {
    expect(rosterFileKind({ name: 'Padrón 2027.XLSX', type: '' })).toBe('xlsx');
    expect(rosterFileKind({ name: 'padron', type: 'text/csv' })).toBe('csv');
    expect(rosterFileKind({ name: 'padron.txt', type: '' })).toBe('csv');
    expect(rosterFileKind({ name: 'padron.xls', type: 'application/vnd.ms-excel' })).toBeNull();
  });

  it('reads UTF-8, and Windows-1252 when the bytes are not UTF-8', () => {
    const utf8 = new TextEncoder().encode('Pérez').buffer;
    expect(decodeCsv(utf8)).toBe('Pérez');
    const latin1 = new Uint8Array([0x50, 0xe9, 0x72, 0x65, 0x7a]).buffer;
    expect(decodeCsv(latin1)).toBe('Pérez');
  });

  it('turns Excel cells into the text the mapping reads', () => {
    expect(cellText(new Date(Date.UTC(2011, 2, 5)))).toBe('2011-03-05');
    expect(cellText(15)).toBe('15');
    expect(cellText(null)).toBe('');
    expect(cellText(true)).toBe('true');
    expect(cellText(Number.NaN)).toBe('');
    expect(
      matrixToTable([
        ['Apellido', 'Nombre'],
        [null, ''],
        ['Gómez', 'Juan'],
      ]),
    ).toEqual([
      { line: 1, cells: ['Apellido', 'Nombre'] },
      { line: 3, cells: ['Gómez', 'Juan'] },
    ]);
  });

  it('maps an Excel sheet with dates as dates', async () => {
    const file = new File([new Uint8Array([0x50, 0x4b])], 'padron.xlsx');
    const result = await readRosterFile(file, {
      readXlsx: () =>
        Promise.resolve([
          ['Apellido y nombre', 'Fecha de nacimiento', 'Sexo'],
          ['Gómez, Juan', new Date(Date.UTC(2011, 2, 5)), 'M'],
        ]),
    });
    expect(result.ok && result.table.entries[0]?.row).toEqual({
      sourceRow: 2,
      firstName: 'Juan',
      lastName: 'Gómez',
      birthDate: '2011-03-05',
      sex: 'male',
    });
  });

  it('reports a damaged Excel, a CSV quote left open and an unknown type', async () => {
    const xlsx = await readRosterFile(new File(['x'], 'a.xlsx'), {
      readXlsx: () => Promise.reject(new Error('zip')),
    });
    expect(xlsx).toEqual({ ok: false, problem: { code: 'unreadable' } });
    const csv = await readRosterFile(new File(['Apellido;Nombre\n"Gómez;Juan'], 'a.csv'));
    expect(csv).toEqual({ ok: false, problem: { code: 'csv_syntax', line: 2 } });
    const pdf = await readRosterFile(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }));
    expect(pdf).toEqual({ ok: false, problem: { code: 'unsupported_type' } });
  });
});

describe('roster batch', () => {
  const table: RosterTable = rosterRowsFromTable([
    { line: 1, cells: ['Apellido', 'Nombre', 'Fecha de nacimiento', 'Sexo', 'Deporte'] },
    { line: 2, cells: ['Gómez', 'Juan', '05/03/2011', 'M', 'rugby'] },
    { line: 3, cells: ['Sosa', 'Ana', '31/02/2011', 'F', ''] },
    { line: 4, cells: ['Paz', 'Lola', '01/01/2012', 'F', ''] },
  ]);

  it('sends the rows the sheet read, and asks for a sport only when one lacks it', () => {
    const rows = sendableRows(table);
    expect(rows.map((r) => r.sourceRow)).toEqual([2, 4]);
    expect(unreadableRows(table).map((r) => r.sourceRow)).toEqual([3]);
    expect(needsBatchSport(rows)).toBe(true);
    expect(needsBatchSport(rows.slice(0, 1))).toBe(false);
  });

  it('builds the body with the batch sport and the decisions by row', () => {
    const rows = sendableRows(table);
    const body = rosterBatch(rows, 'hockey', new Map([[1, { action: 'create' as const }]]));
    expect(body.sport).toBe('hockey');
    expect(body.rows[0]).not.toHaveProperty('resolution');
    expect(body.rows[1]).toMatchObject({ lastName: 'Paz', resolution: { action: 'create' } });
    expect(rosterBatch(rows, null, new Map())).not.toHaveProperty('sport');
  });

  it('reads the issues of the API by field and code', () => {
    expect(issueField({ path: ['body', 'rows', 0, 'birthDate'] })).toBe('birthDate');
    expect(issueField({ path: ['body', 'rows', 0] })).toBeNull();
    expect(issueField({ path: ['body', 'rows', 0, 'nope'] })).toBeNull();
    expect(issueMessageKey({ code: 'future_date' })).toBe('admin.roster.issue.future_date');
    expect(issueMessageKey({ code: 'too_small' })).toBe('admin.roster.issue.invalid');
  });

  it('imports only a preview with every row valid and decided', () => {
    const base = {
      rowCount: 1,
      invalidCount: 0,
      resolutionRequiredCount: 0,
      createCount: 1,
      updateCount: 0,
      skipCount: 0,
      guardiansToLinkCount: 0,
      invitationsToSendCount: 0,
      rows: [],
    };
    expect(canImport(base)).toBe(true);
    expect(canImport({ ...base, invalidCount: 1 })).toBe(false);
    expect(canImport({ ...base, resolutionRequiredCount: 1 })).toBe(false);
    expect(canImport({ ...base, rowCount: 0 })).toBe(false);
    const row = {
      index: 0,
      sourceRow: 2,
      issues: [],
      action: 'create' as const,
      resolutionRequired: false,
      categoryId: null,
      positionIds: [],
      matches: [],
      duplicateOfIndex: null,
      guardians: [],
    };
    expect(rowNeedsAttention(row)).toBe(false);
    expect(rowNeedsAttention({ ...row, duplicateOfIndex: 1 })).toBe(true);
  });
});

describe('forms of the administration', () => {
  it('validates an invitation', () => {
    expect(invitationFormErrors({ email: '', expiresInDays: '7' })).toEqual({ email: 'required' });
    expect(invitationFormErrors({ email: 'a@b', expiresInDays: '0' })).toEqual({
      email: 'invalid',
      expiresInDays: 'range',
    });
    expect(invitationFormErrors({ email: ' ana@example.com ', expiresInDays: '30' })).toBeNull();
  });

  it('validates an assignment and builds its body', () => {
    const draft = {
      membershipId: 'm',
      target: 'sport:hockey',
      validFrom: '2027-03-01',
      validTo: '',
    };
    expect(assignmentDraftErrors(draft)).toEqual([]);
    expect(assignmentDraftErrors({ ...draft, validTo: '2027-03-01' })).toEqual(['order']);
    expect(assignmentDraftErrors({ ...draft, membershipId: '', target: '' })).toEqual([
      'member',
      'target',
    ]);
    expect(assignmentBody(draft, 'uuid')).toEqual({
      clientUuid: 'uuid',
      membershipId: 'm',
      target: { kind: 'sport', sport: 'hockey' },
      validFrom: '2027-03-01',
    });
    expect(
      assignmentBody({ ...draft, target: 'category:c1', validTo: '2027-12-01' }, 'uuid'),
    ).toMatchObject({ target: { kind: 'category', categoryId: 'c1' }, validTo: '2027-12-01' });
  });

  it('patches only what changed in the club', () => {
    const current = club();
    const draft = clubDraftOf(current);
    expect(clubPatch(current, draft)).toEqual({ version: current.version });
    expect(clubPatch(current, { ...draft, primary: '#ABCDEF', name: ' Olivos ' })).toEqual({
      version: current.version,
      name: 'Olivos',
      colors: { primary: '#abcdef' },
    });
    expect(clubDraftErrors({ ...draft, shortName: '', secondary: '#12' })).toEqual([
      'shortName',
      'secondary',
    ]);
  });

  it('offers the branches the club does not have and reads sort orders', () => {
    expect(missingBranches([{ sport: 'rugby', sex: 'male' }])).toEqual([
      { sport: 'rugby', sex: 'female' },
      { sport: 'hockey', sex: 'male' },
      { sport: 'hockey', sex: 'female' },
    ]);
    expect(parseSortOrder('')).toBeNull();
    expect(parseSortOrder(' 3 ')).toBe(3);
    expect(parseSortOrder('1,5')).toBe('invalid');
    expect(parseSortOrder('-1')).toBe('invalid');
  });

  it('works on the season change in review, else the newest', () => {
    const draft = rollover({ status: 'draft' });
    const applied = rollover({ status: 'applied' });
    expect(currentRollover([applied, draft])).toBe(draft);
    expect(currentRollover([applied])).toBe(applied);
    expect(currentRollover([])).toBeNull();
    expect(decisionValue({ decision: 'stay', targetCategoryId: null })).toBe('stay');
    expect(decisionValue({ decision: 'move', targetCategoryId: 'c1' as never })).toBe('move:c1');
  });

  it('hashes the crest as the bucket checks it', async () => {
    expect(await sha256Base64(new Blob([new Uint8Array([1, 2, 3, 4])]))).toBe(
      'n2SnR+G5fxMfq7a0Rylsm28CAeefs8U1bmx36JtqgGo=',
    );
  });
});

describe('positions of the club (B-801)', () => {
  it('shows the sports of the active branches, in the domain order', () => {
    expect(
      clubSports([
        { sport: 'hockey', archivedAt: null },
        { sport: 'rugby', archivedAt: '2026-01-01T00:00:00.000Z' },
      ]),
    ).toEqual(['hockey']);
    expect(
      clubSports([
        { sport: 'hockey', archivedAt: null },
        { sport: 'rugby', archivedAt: null },
      ]),
    ).toEqual(['rugby', 'hockey']);
  });

  it('tells the seeded positions apart from the club ones', () => {
    expect(isDefaultPosition({ sport: 'hockey', code: 'goalkeeper' })).toBe(true);
    expect(isDefaultPosition({ sport: 'rugby', code: 'goalkeeper' })).toBe(false);
    expect(isDefaultPosition({ sport: 'hockey', code: 'sweeper' })).toBe(false);
  });

  it('trims the label, empty is the catalog name, too long is not valid', () => {
    expect(parsePositionLabel('  Líbero ')).toEqual({ ok: true, value: 'Líbero' });
    expect(parsePositionLabel('   ')).toEqual({ ok: true, value: null });
    expect(parsePositionLabel('x'.repeat(41))).toEqual({ ok: false });
  });
});
