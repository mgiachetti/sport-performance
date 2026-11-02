import { describe, expect, it } from 'vitest';
import {
  REFERENCE_IMPORT_MAX_ROWS,
  createReferenceValue,
  endpointErrorCodes,
  getPlayerFirstTeamReferences,
  importReferenceValues,
  listReferenceValues,
  updateReferenceValue,
} from '../index.js';

describe('first-team reference endpoints', () => {
  const entry = {
    metricCode: 'cmj_height_cm',
    sport: 'rugby',
    sex: 'male',
    value: 45.5,
    unit: 'cm',
    validFrom: '2026-02-01',
    source: 'Primera, pretemporada 2026',
  };

  it('accepts a squad, a position or a line reference, never two scopes', () => {
    expect(createReferenceValue.body.safeParse(entry).success).toBe(true);
    expect(createReferenceValue.body.safeParse({ ...entry, positionCode: 'hooker' }).success).toBe(
      true,
    );
    expect(createReferenceValue.body.safeParse({ ...entry, lineCode: 'forwards' }).success).toBe(
      true,
    );
    const both = createReferenceValue.body.safeParse({
      ...entry,
      positionCode: 'hooker',
      lineCode: 'forwards',
    });
    expect(both.success).toBe(false);
    expect(both.error?.issues.map((i) => i.path)).toContainEqual(['lineCode']);
  });

  it('rejects unknown units, padded sources, bad codes and non-finite values', () => {
    for (const body of [
      { ...entry, unit: 'inches' },
      { ...entry, source: ' Primera' },
      { ...entry, source: '' },
      { ...entry, source: 'x'.repeat(201) },
      { ...entry, metricCode: 'CMJ' },
      { ...entry, metricCode: 'player_load_au' },
      { ...entry, value: Number.POSITIVE_INFINITY },
      { ...entry, validFrom: '2026-02-30' },
      { ...entry, method: 'guess' },
      { ...entry, extra: true },
    ]) {
      expect(createReferenceValue.body.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('corrects only the value, the method, the date and the source, with the version', () => {
    expect(updateReferenceValue.body.safeParse({ value: 1 }).success).toBe(false);
    expect(
      updateReferenceValue.body.safeParse({ version: '1', value: 1, method: null }).success,
    ).toBe(true);
    expect(
      updateReferenceValue.body.safeParse({ version: '1', positionCode: 'hooker' }).success,
    ).toBe(false);
    expect(endpointErrorCodes(updateReferenceValue)).toContain('conflict');
  });

  it('needs a default or a value of its own for the date and source of every imported row', () => {
    const row = {
      metricCode: 'sprint_40_s',
      sport: 'rugby',
      sex: 'male',
      value: 5.3,
      unit: 's',
    };
    const batch = {
      clientUuid: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f',
      validFrom: '2026-02-01',
      source: 'Planilla',
      rows: [row],
    };
    expect(importReferenceValues.body.parse(batch).mode).toBe('insert');
    const missing = importReferenceValues.body.safeParse({
      clientUuid: batch.clientUuid,
      rows: [row, { ...row, validFrom: '2026-03-01', source: 'Otra' }],
    });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues.map((i) => i.path)).toEqual([
      ['rows', 0, 'validFrom'],
      ['rows', 0, 'source'],
    ]);
    expect(importReferenceValues.body.safeParse({ ...batch, rows: [] }).success).toBe(false);
    expect(
      importReferenceValues.body.safeParse({
        ...batch,
        rows: Array.from({ length: REFERENCE_IMPORT_MAX_ROWS + 1 }, () => row),
      }).success,
    ).toBe(false);
    expect(importReferenceValues.body.safeParse({ ...batch, clientUuid: undefined }).success).toBe(
      false,
    );
    expect(importReferenceValues.body.safeParse({ ...batch, mode: 'merge' }).success).toBe(false);
  });

  it('lists with typed filters and the allowed sorts', () => {
    expect(listReferenceValues.query.parse({})).toMatchObject({
      sort: '-validFrom',
      status: 'active',
      limit: 50,
    });
    expect(listReferenceValues.query.safeParse({ sort: 'value' }).success).toBe(false);
    expect(listReferenceValues.query.safeParse({ scope: 'team' }).success).toBe(false);
  });

  it("serves the player's view per player, with an optional date", () => {
    expect(getPlayerFirstTeamReferences.path).toBe('/v1/players/{playerId}/first-team-references');
    expect(getPlayerFirstTeamReferences.query.safeParse({ asOf: '2026-05-01' }).success).toBe(true);
    expect(getPlayerFirstTeamReferences.query.safeParse({ asOf: 'today' }).success).toBe(false);
  });
});
