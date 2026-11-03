import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { apiEndpoints } from './index.js';
import {
  TEST_IMPORT_MAX_ROWS,
  createTestImport,
  previewTestImport,
  testImportBodySchema,
} from './test-imports.js';

const playerId = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';

const row = (overrides: Record<string, unknown> = {}) => ({
  player: { playerId },
  testCode: 'cmj',
  entries: [{ kind: 'value', metricCode: 'cmj_height_cm', value: 41.5 }],
  ...overrides,
});

const batch = (overrides: Record<string, unknown> = {}) => ({
  clientUuid: randomUUID(),
  source: 'Planilla M15 2024',
  measuredOn: '2024-04-10',
  rows: [row()],
  ...overrides,
});

describe('test imports (B-331)', () => {
  it('are served under /v1/test-imports', () => {
    expect(previewTestImport.path).toBe('/v1/test-imports/preview');
    expect(previewTestImport.response.status).toBe(200);
    expect(createTestImport.path).toBe('/v1/test-imports');
    expect(createTestImport.response.status).toBe(201);
    expect(apiEndpoints.createTestImport).toBe(createTestImport);
  });

  it('accepts a player by id or by name and birth date, and defaults to rejecting duplicates', () => {
    const parsed = testImportBodySchema.parse(
      batch({
        rows: [
          row(),
          row({ player: { lastName: 'Pérez', firstName: 'Juan', birthDate: '2011-05-01' } }),
        ],
      }),
    );
    expect(parsed.onDuplicate).toBe('reject');
    expect(parsed.rows).toHaveLength(2);
  });

  it('needs a day for every row, from the row or the batch', () => {
    const result = testImportBodySchema.safeParse(batch({ measuredOn: undefined }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['rows', 0, 'measuredOn']);
    expect(
      testImportBodySchema.safeParse(
        batch({ measuredOn: undefined, rows: [row({ measuredOn: '2024-04-10' })] }),
      ).success,
    ).toBe(true);
  });

  it('never takes the method: imported results are historical', () => {
    expect(
      testImportBodySchema.safeParse(batch({ rows: [row({ method: 'manual' })] })).success,
    ).toBe(false);
  });

  it('rejects mixed player references, empty sources and too many rows', () => {
    const mixed = row({ player: { playerId, lastName: 'Pérez' } });
    expect(testImportBodySchema.safeParse(batch({ rows: [mixed] })).success).toBe(false);
    expect(testImportBodySchema.safeParse(batch({ source: ' Planilla' })).success).toBe(false);
    expect(testImportBodySchema.safeParse(batch({ clientUuid: undefined })).success).toBe(false);
    const many = Array.from({ length: TEST_IMPORT_MAX_ROWS + 1 }, () => row());
    expect(testImportBodySchema.safeParse(batch({ rows: many })).success).toBe(false);
  });
});
