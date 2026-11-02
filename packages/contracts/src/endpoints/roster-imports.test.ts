import { parseDelimitedText, rosterRowsFromTable } from '@sport-performance/domain';
import type { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  ROSTER_IMPORT_MAX_ROWS,
  endpointErrorCodes,
  getRosterImport,
  importRoster,
  listRosterImports,
  previewRosterImport,
  type rosterImportRowSchema,
} from '../index.js';

describe('roster import endpoints', () => {
  const row = {
    firstName: 'Juan',
    lastName: 'Pérez',
    birthDate: '2011-03-05',
    sex: 'male',
    sport: 'rugby',
  };
  const clientUuid = '0b6f9e43-8a61-4a3b-9f3e-6f3d0b9e2a11';

  it('accepts the rows the domain maps from a spreadsheet', () => {
    const table = rosterRowsFromTable(
      parseDelimitedText(
        'Apellido;Nombre;Nacimiento;Sexo;Categoría;Posición;Email madre\nPérez;Juan;05/03/2011;M;M15;hooker;a@example.com',
      ).rows,
    );
    const rows = table.entries.flatMap((entry) => (entry.row === null ? [] : [entry.row]));
    // Compile-time too: the domain row is an input of the contract.
    const typed: z.input<typeof rosterImportRowSchema>[] = rows;
    expect(previewRosterImport.body.safeParse({ sport: 'rugby', rows: typed }).success).toBe(true);
  });

  it('needs a sport per row or for the batch', () => {
    const withoutSport = { ...row, sport: undefined };
    const result = previewRosterImport.body.safeParse({ rows: [withoutSport] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toContainEqual(['rows', 0, 'sport']);
    expect(
      previewRosterImport.body.safeParse({ sport: 'hockey', rows: [withoutSport] }).success,
    ).toBe(true);
  });

  it('rejects bad rows, too many guardians or positions, and too many rows', () => {
    const guardian = { email: 'a@example.com', relationship: 'mother' };
    for (const bad of [
      { ...row, firstName: ' Juan' },
      { ...row, birthDate: '05/03/2011' },
      { ...row, sex: 'M' },
      { ...row, positions: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { ...row, guardians: [guardian, { ...guardian, relationship: 'father' }] },
      {
        ...row,
        guardians: [
          guardian,
          { ...guardian, email: 'b@example.com' },
          { ...guardian, email: 'c@example.com' },
        ],
      },
      { ...row, guardians: [{ email: 'nope', relationship: 'mother' }] },
      { ...row, resolution: { action: 'update', playerId: clientUuid } },
      { ...row, resolution: { action: 'merge' } },
      { ...row, sourceRow: 0 },
      { ...row, extra: 1 },
    ]) {
      expect(previewRosterImport.body.safeParse({ rows: [bad] }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
    const many = Array.from({ length: ROSTER_IMPORT_MAX_ROWS + 1 }, () => row);
    expect(previewRosterImport.body.safeParse({ rows: many }).success).toBe(false);
    expect(previewRosterImport.body.safeParse({ rows: [] }).success).toBe(false);
  });

  it('imports with a clientUuid and decisions per row', () => {
    expect(importRoster.body.safeParse({ rows: [row] }).success).toBe(false);
    expect(
      importRoster.body.safeParse({
        clientUuid,
        rows: [
          { ...row, resolution: { action: 'create' } },
          { ...row, resolution: { action: 'skip' } },
          { ...row, resolution: { action: 'update', playerId: clientUuid, version: '1' } },
        ],
      }).success,
    ).toBe(true);
    expect(endpointErrorCodes(importRoster)).toContain('conflict');
    expect(endpointErrorCodes(getRosterImport)).toContain('not_found');
    expect(listRosterImports.query.safeParse({ sort: '-createdAt' }).success).toBe(true);
    expect(listRosterImports.query.safeParse({ sort: 'name' }).success).toBe(false);
  });
});
