import { describe, expect, it } from 'vitest';
import type { PlayerId } from '../ids.js';
import type { LocalDate } from '../time.js';
import { CsvSyntaxError, detectDelimiter, parseDelimitedText } from './csv.js';
import {
  RosterMatcher,
  boundedEditDistance,
  normalizePersonName,
  rosterPersonKey,
  type RosterPlayer,
} from './duplicates.js';
import {
  classifyHeader,
  parseSpreadsheetDate,
  rosterRowsFromTable,
  splitFullName,
  tableFromMatrix,
} from './table.js';

const d = (value: string) => value as LocalDate;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as PlayerId;

describe('parseDelimitedText', () => {
  it('reads the semicolon CSV of es-AR Excel with a BOM and CRLF', () => {
    const text = '﻿Apellido;Nombre;Peso\r\nPérez;Juan;72,5\r\n\r\nGómez;Ana;60\r\n';
    const parsed = parseDelimitedText(text);
    expect(parsed.delimiter).toBe(';');
    expect(parsed.rows).toEqual([
      { line: 1, cells: ['Apellido', 'Nombre', 'Peso'] },
      { line: 2, cells: ['Pérez', 'Juan', '72,5'] },
      { line: 4, cells: ['Gómez', 'Ana', '60'] },
    ]);
  });

  it('handles quotes, doubled quotes, delimiters and line breaks inside fields', () => {
    const text = 'a,b,c\n"Pérez, Juan","dice ""hola""","línea 1\nlínea 2"\nx,,z';
    const parsed = parseDelimitedText(text);
    expect(parsed.delimiter).toBe(',');
    expect(parsed.rows).toEqual([
      { line: 1, cells: ['a', 'b', 'c'] },
      { line: 2, cells: ['Pérez, Juan', 'dice "hola"', 'línea 1\nlínea 2'] },
      { line: 4, cells: ['x', '', 'z'] },
    ]);
  });

  it('detects tabs and ignores delimiters inside quotes when detecting', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('"a,b,c";d\n')).toBe(';');
    expect(detectDelimiter('solo')).toBe(';');
  });

  it('rejects an unterminated quote with its line', () => {
    expect(() => parseDelimitedText('a;b\n"abierto;x\n')).toThrow(CsvSyntaxError);
    try {
      parseDelimitedText('a;b\n"abierto;x\n');
    } catch (error) {
      expect((error as CsvSyntaxError).line).toBe(2);
    }
  });

  it('honours an explicit delimiter', () => {
    expect(parseDelimitedText('a;b,c', { delimiter: ',' }).rows[0]?.cells).toEqual(['a;b', 'c']);
  });
});

describe('names and distances', () => {
  it('normalizes accents, case, punctuation and spaces', () => {
    expect(normalizePersonName('  José  María ')).toBe('jose maria');
    expect(normalizePersonName("O'Connor-Muñoz")).toBe('o connor munoz');
    expect(normalizePersonName('ÁLVAREZ')).toBe('alvarez');
  });

  it('bounds the edit distance', () => {
    expect(boundedEditDistance('perez juan', 'peres juan', 2)).toBe(1);
    expect(boundedEditDistance('gomez ana', 'gomes anna', 2)).toBe(2);
    expect(boundedEditDistance('gomez ana', 'rodriguez maria', 2)).toBe(3);
    expect(boundedEditDistance('', 'abc', 5)).toBe(3);
  });
});

describe('RosterMatcher', () => {
  const players: RosterPlayer[] = [
    { id: id(1), firstName: 'Juan', lastName: 'Pérez', birthDate: d('2011-03-05'), sport: 'rugby' },
    {
      id: id(2),
      firstName: 'Tomás',
      lastName: 'Gómez',
      birthDate: d('2011-07-20'),
      sport: 'rugby',
    },
    { id: id(3), firstName: 'Ana', lastName: 'Pérez', birthDate: d('2011-03-05'), sport: 'hockey' },
  ];
  const matcher = new RosterMatcher(players);

  it('finds an exact match regardless of accents and case', () => {
    expect(
      matcher.matches({
        firstName: 'JUAN',
        lastName: 'perez',
        birthDate: d('2011-03-05'),
        sport: 'rugby',
      }),
    ).toEqual([{ playerId: id(1), kind: 'exact', reason: 'same_name_and_birth_date' }]);
  });

  it('never matches across sports', () => {
    expect(
      matcher.matches({
        firstName: 'Ana',
        lastName: 'Perez',
        birthDate: d('2011-03-05'),
        sport: 'rugby',
      }),
    ).toEqual([{ playerId: id(1), kind: 'possible', reason: 'same_last_name_and_birth_date' }]);
  });

  it('proposes swapped names, typos and close or swapped birth dates', () => {
    const at = (firstName: string, lastName: string, birthDate: string) =>
      matcher.matches({ firstName, lastName, birthDate: d(birthDate), sport: 'rugby' });
    expect(at('Pérez', 'Juan', '2011-03-05')[0]?.reason).toBe('swapped_names');
    expect(at('Tomas', 'Gomes', '2011-07-20')[0]?.reason).toBe('similar_name');
    expect(at('Tomás', 'Gómez', '2011-07-27')[0]?.reason).toBe('same_name_close_birth_date');
    // 05/03 typed as 03/05: day and month swapped.
    expect(at('Juan', 'Pérez', '2011-05-03')[0]?.reason).toBe('same_name_close_birth_date');
    expect(at('Juan', 'Pérez', '2012-03-05')).toEqual([]);
    expect(at('Lucía', 'Fernández', '2011-07-20')).toEqual([]);
  });

  it('orders exact matches first', () => {
    const twin = new RosterMatcher([
      ...players,
      {
        id: id(0),
        firstName: 'Juana',
        lastName: 'Pérez',
        birthDate: d('2011-03-05'),
        sport: 'rugby',
      },
    ]);
    const found = twin.matches({
      firstName: 'Juan',
      lastName: 'Pérez',
      birthDate: d('2011-03-05'),
      sport: 'rugby',
    });
    expect(found.map((m) => [m.playerId, m.kind])).toEqual([
      [id(1), 'exact'],
      [id(0), 'possible'],
    ]);
  });

  it('keys a person within a spreadsheet', () => {
    const a = rosterPersonKey({
      firstName: 'José',
      lastName: 'Ruiz',
      birthDate: d('2010-01-01'),
      sport: 'rugby',
    });
    const b = rosterPersonKey({
      firstName: 'jose ',
      lastName: 'RUIZ',
      birthDate: d('2010-01-01'),
      sport: 'rugby',
    });
    expect(a).toBe(b);
  });
});

describe('spreadsheet cells', () => {
  it('reads dd/mm/aaaa and ISO dates, never two-digit years or serials', () => {
    expect(parseSpreadsheetDate('05/03/2011')).toBe('2011-03-05');
    expect(parseSpreadsheetDate('5-3-2011')).toBe('2011-03-05');
    expect(parseSpreadsheetDate('5.3.2011')).toBe('2011-03-05');
    expect(parseSpreadsheetDate('2011-03-05')).toBe('2011-03-05');
    expect(parseSpreadsheetDate('2011-03-05T00:00:00.000Z')).toBe('2011-03-05');
    expect(parseSpreadsheetDate('31/02/2011')).toBeUndefined();
    expect(parseSpreadsheetDate('05/03/11')).toBeUndefined();
    expect(parseSpreadsheetDate('40607')).toBeUndefined();
  });

  it('splits "Apellido, Nombre" only with a comma', () => {
    expect(splitFullName('Pérez Ruiz, Juan Ignacio')).toEqual({
      lastName: 'Pérez Ruiz',
      firstName: 'Juan Ignacio',
    });
    expect(splitFullName('Juan Pérez')).toBeUndefined();
    expect(splitFullName(', Juan')).toBeUndefined();
  });

  it('classifies headers in Spanish and English', () => {
    const field = (header: string) => classifyHeader(header, 0);
    expect(field('APELLIDO').field).toBe('lastName');
    expect(field('Fecha de Nacimiento').field).toBe('birthDate');
    expect(field('F. Nac.').field).toBe('birthDate');
    expect(field('Categoría').field).toBe('category');
    expect(field('Pie hábil').field).toBe('dominantSide');
    expect(field('Email tutor 2')).toMatchObject({ field: 'guardianEmail', guardianSlot: '2' });
    expect(field('Mail de la madre')).toBeDefined();
    expect(field('Email madre')).toMatchObject({
      field: 'guardianEmail',
      impliedRelationship: 'mother',
    });
    expect(field('Vínculo tutor 1')).toMatchObject({
      field: 'guardianRelationship',
      guardianSlot: '1',
    });
    expect(field('DNI').field).toBeNull();
  });
});

describe('rosterRowsFromTable', () => {
  it('maps a full spreadsheet', () => {
    const { rows } = parseDelimitedText(
      [
        'Apellido;Nombre;Fecha de nacimiento;Sexo;Deporte;Categoría;Posición;Pie hábil;Email madre;Email tutor 2;Vínculo tutor 2;DNI',
        'Pérez;Juan;05/03/2011;M;Rugby;M15;Hooker / Pilar;Derecho;MAMA@example.com;tio@example.com;otro;123',
        'Gómez;Ana;20/07/2011;F;Hockey;;;;;;;',
      ].join('\n'),
    );
    const table = rosterRowsFromTable(rows);
    expect(table.issues).toEqual([]);
    expect(table.columns.at(-1)).toMatchObject({ header: 'DNI', field: null });
    expect(table.entries).toEqual([
      {
        sourceRow: 2,
        issues: [],
        row: {
          sourceRow: 2,
          lastName: 'Pérez',
          firstName: 'Juan',
          birthDate: '2011-03-05',
          sex: 'male',
          sport: 'rugby',
          category: 'M15',
          positions: ['Hooker', 'Pilar'],
          dominantSide: 'right',
          guardians: [
            { email: 'mama@example.com', relationship: 'mother' },
            { email: 'tio@example.com', relationship: 'other' },
          ],
        },
      },
      {
        sourceRow: 3,
        issues: [],
        row: {
          sourceRow: 3,
          lastName: 'Gómez',
          firstName: 'Ana',
          birthDate: '2011-07-20',
          sex: 'female',
          sport: 'hockey',
        },
      },
    ]);
  });

  it('reads "Apellido y nombre" and reports every bad cell with its row and column', () => {
    const table = rosterRowsFromTable(
      tableFromMatrix([
        ['Apellido y nombre', 'Nacimiento', 'Sexo', 'Lado dominante', 'Email tutor', 'Vínculo'],
        ['Pérez, Juan', '31/02/2011', 'X', 'arriba', 'no-es-un-mail', ''],
        ['Juan Pérez', '05/03/2011', 'M', '', 'a@example.com', ''],
        ['', '', '', '', '', 'madre'],
      ]),
    );
    expect(table.issues).toEqual([]);
    expect(table.entries[0]).toEqual({
      sourceRow: 2,
      row: null,
      issues: [
        { code: 'invalid_date', sourceRow: 2, column: 'Nacimiento', value: '31/02/2011' },
        { code: 'invalid_sex', sourceRow: 2, column: 'Sexo', value: 'X' },
        { code: 'invalid_dominant_side', sourceRow: 2, column: 'Lado dominante', value: 'arriba' },
        { code: 'invalid_email', sourceRow: 2, column: 'Email tutor', value: 'no-es-un-mail' },
      ],
    });
    expect(table.entries[1]?.issues.map((i) => i.code)).toEqual([
      'full_name_without_comma',
      'guardian_without_relationship',
    ]);
    expect(table.entries[2]?.issues.map((i) => i.code)).toEqual([
      'required',
      'required',
      'required',
      'required',
      'relationship_without_email',
    ]);
  });

  it('reports missing and repeated columns', () => {
    expect(rosterRowsFromTable([]).issues).toEqual([{ code: 'empty_table' }]);
    const missing = rosterRowsFromTable(tableFromMatrix([['Nombre', 'Sexo']]));
    expect(missing.issues.map((i) => [i.code, i.column])).toEqual([
      ['missing_column', 'Apellido / Nombre'],
      ['missing_column', 'Fecha de nacimiento'],
    ]);
    const repeated = rosterRowsFromTable(
      tableFromMatrix([['Apellido', 'Nombre', 'Nacimiento', 'Sexo', 'Apellidos']]),
    );
    expect(repeated.issues).toEqual([{ code: 'repeated_column', column: 'Apellidos' }]);
  });

  it('rejects a guardian repeated in the same row', () => {
    const table = rosterRowsFromTable(
      tableFromMatrix([
        ['Apellido', 'Nombre', 'Nacimiento', 'Sexo', 'Email madre', 'Email padre'],
        ['Ruiz', 'Lía', '01/01/2012', 'F', 'a@example.com', 'A@example.com'],
      ]),
    );
    expect(table.entries[0]?.issues.map((i) => i.code)).toEqual(['repeated_guardian']);
  });
});
