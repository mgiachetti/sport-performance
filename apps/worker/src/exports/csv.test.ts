import { CLUB_DATA_EXPORT_DATASETS, parseTimeZone } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  csvHeader,
  csvLine,
  csvRow,
  formatCsvCell,
  neutralizeFormula,
  quoteCsvField,
  type CsvColumn,
} from './csv.js';
import { DATASETS } from './datasets.js';
import { dictionaryText } from './generate.js';

const zone = parseTimeZone('America/Argentina/Buenos_Aires');
const column = (type: CsvColumn['type'], extra: Partial<CsvColumn> = {}): CsvColumn => ({
  key: 'v',
  header: 'v',
  type,
  description: '',
  ...extra,
});
const cell = (value: unknown, type: CsvColumn['type'], extra: Partial<CsvColumn> = {}) =>
  formatCsvCell(value, column(type, extra), zone);

describe('CSV cells in es-AR', () => {
  it('writes numbers with a decimal comma and no thousands separator', () => {
    expect(cell(1234.5, 'decimal')).toBe('1234,5');
    expect(cell(-0.512, 'decimal')).toBe('-0,512');
    expect(cell(1.23456789, 'decimal')).toBe('1,234568');
    expect(cell(1.23456789, 'decimal', { decimals: 2 })).toBe('1,23');
    expect(cell(-0.0001, 'decimal', { decimals: 2 })).toBe('0');
    expect(cell(420, 'integer')).toBe('420');
    expect(cell('5234.5', 'decimal')).toBe('5234,5');
    expect(() => cell(1.5, 'integer')).toThrow(TypeError);
    expect(() => cell(Number.NaN, 'decimal')).toThrow(TypeError);
    expect(() => cell('abc', 'decimal')).toThrow(TypeError);
  });

  it('writes club days as dd/mm/aaaa and instants in the club zone', () => {
    expect(cell('2026-03-01', 'date')).toBe('01/03/2026');
    expect(() => cell('01/03/2026', 'date')).toThrow(TypeError);
    // 23:00 UTC is 20:00 in Buenos Aires, still the 20th.
    expect(cell(new Date('2026-03-20T23:00:00Z'), 'datetime')).toBe('20/03/2026 20:00');
    expect(cell('2026-03-21T02:30:00Z', 'datetime')).toBe('20/03/2026 23:30');
  });

  it('writes empty for missing values, si/no for booleans, lists and JSON', () => {
    expect(cell(null, 'decimal')).toBe('');
    expect(cell(undefined, 'text')).toBe('');
    expect(cell(true, 'boolean')).toBe('si');
    expect(cell(false, 'boolean')).toBe('no');
    expect(cell(['M15', 'M16'], 'list')).toBe('M15, M16');
    expect(cell({}, 'json')).toBe('');
    expect(cell({ surface: 'grass' }, 'json')).toBe('{"surface":"grass"}');
  });

  it('makes formulas inert in text, never in numbers', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r']) {
      expect(neutralizeFormula(`${start}SUM(A1)`)).toBe(`'${start}SUM(A1)`);
    }
    expect(neutralizeFormula('Pérez')).toBe('Pérez');
    expect(cell('=HYPERLINK("x")', 'text')).toBe(`'=HYPERLINK("x")`);
    expect(cell(['=1+1'], 'list')).toBe("'=1+1");
    expect(cell(-1.5, 'decimal')).toBe('-1,5');
  });

  it('quotes fields as RFC 4180 with ; as the separator', () => {
    expect(quoteCsvField('simple')).toBe('simple');
    expect(quoteCsvField('a;b')).toBe('"a;b"');
    expect(quoteCsvField('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(quoteCsvField('dos\nlíneas')).toBe('"dos\nlíneas"');
    expect(quoteCsvField('1,5')).toBe('1,5');
    expect(csvLine(['a', 'b;c', ''])).toBe('a;"b;c";\r\n');
  });

  it('starts the file with the BOM and writes rows by column key', () => {
    const columns = [column('text', { key: 'name', header: 'nombre' }), column('decimal')];
    expect(csvHeader(columns)).toBe(`${CSV_BOM}nombre;v\r\n`);
    expect(csvRow({ name: 'Ana', v: 2.5 }, columns, zone)).toBe('Ana;2,5\r\n');
  });
});

describe('datasets', () => {
  it('define every dataset with unique Spanish snake_case headers', () => {
    for (const dataset of CLUB_DATA_EXPORT_DATASETS) {
      const { columns, query } = DATASETS[dataset];
      const headers = columns.map((c) => c.header);
      expect(new Set(headers).size, dataset).toBe(headers.length);
      for (const header of headers) expect(header, dataset).toMatch(/^[a-z][a-z0-9_]*$/);
      for (const c of columns) expect(c.description, `${dataset}.${c.header}`).not.toBe('');
      // Every query stays in the club of the job.
      expect(query, dataset).toContain('app.current_club_id()');
    }
  });

  it('never reads the medical schema nor calls PlayerLoad by that name', () => {
    for (const dataset of CLUB_DATA_EXPORT_DATASETS) {
      const { columns, query } = DATASETS[dataset];
      expect(query, dataset).not.toMatch(/medical\./);
      expect(columns.map((c) => c.header).join(), dataset).not.toMatch(/playerload/i);
    }
    // `injured` reads `unavailable` for everyone but the medical staff (ADR 0029).
    expect(DATASETS.test_results.query).toContain(
      'app.not_done_reason_for_viewer(x.not_done_reason) as not_done_reason',
    );
  });

  it('documents every column in the dictionary', () => {
    const text = dictionaryText(['anthropometry']);
    expect(text.startsWith(`${CSV_BOM}archivo;columna;tipo;unidad;descripcion\r\n`)).toBe(true);
    expect(text).toContain('antropometria.csv;talla_cm;decimal (coma);cm;Talla.\r\n');
    expect(text.split('\r\n').length - 2).toBe(DATASETS.anthropometry.columns.length);
  });
});
