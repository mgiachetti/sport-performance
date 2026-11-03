import { ApiError } from '@sport-performance/contracts';
import { parseLocalDate, parsePlayerId, parseUuid } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  hasProblems,
  hasValues,
  parseField,
  parseRow,
  previewPayload,
  rowIssues,
  savePayload,
  type RowDraft,
} from './sheet-model';

const P1 = parsePlayerId('0192e7a0-4444-7000-8000-000000000001');
const P2 = parsePlayerId('0192e7a0-4444-7000-8000-000000000002');
const DAY = parseLocalDate('2026-11-03');
const draft = (values: RowDraft['values']): RowDraft => ({
  clientUuid: parseUuid('0192e7a0-6666-7000-8000-000000000001'),
  values,
});

describe('sheet model', () => {
  it('reads es-AR numbers and refuses what is a typo', () => {
    expect(parseField('165,4', 'heightCm')).toEqual({ value: 165.4 });
    expect(parseField(' 55 ', 'weightKg')).toEqual({ value: 55 });
    expect(parseField('', 'weightKg')).toEqual({});
    expect(parseField('1.65', 'heightCm')).toEqual({ problem: 'number' });
    expect(parseField('1.650', 'heightCm')).toEqual({ problem: 'number' });
    expect(parseField('1650', 'heightCm')).toEqual({ problem: 'range' });
    expect(parseField('0', 'weightKg')).toEqual({ problem: 'range' });
  });

  it('checks the sitting height against the height of the same row', () => {
    const row = parseRow(P1, draft({ heightCm: '150', sittingHeightCm: '150' }));
    expect(row.problems).toEqual({ sittingHeightCm: 'sittingAboveHeight' });
    expect(row.values).toEqual({ heightCm: 150 });
    expect(hasProblems(row)).toBe(true);
    expect(parseRow(P2, undefined)).toEqual({
      playerId: P2,
      values: {},
      problems: {},
      touched: false,
    });
  });

  it('previews the whole squad and saves only the rows with values', () => {
    const drafts = { [P1]: draft({ heightCm: '165,4' }) };
    const rows = [parseRow(P1, drafts[P1]), parseRow(P2, undefined)];
    expect(previewPayload(rows, DAY)).toEqual([
      { playerId: P1, measuredOn: DAY, heightCm: 165.4 },
      { playerId: P2, measuredOn: DAY },
    ]);
    expect(rows.filter(hasValues)).toHaveLength(1);
    expect(savePayload(rows, drafts, DAY)).toEqual([
      { clientUuid: drafts[P1]?.clientUuid, playerId: P1, measuredOn: DAY, heightCm: 165.4 },
    ]);
    // A row with values and no draft is a bug: never a fresh clientUuid that breaks retries.
    expect(() => savePayload(rows, {}, DAY)).toThrow(/no draft/);
  });

  it('maps the issues of a batch to the rows that were sent', () => {
    const error = new ApiError({
      operationId: 'recordAnthroMeasurements',
      status: 400,
      code: 'validation_failed',
      message: 'invalid',
      details: [
        { path: ['body', 'measurements', 1, 'skinfoldsSumMm'], code: 'custom', message: 'x' },
        { path: ['body', 'measurements', 0, 'playerId'], code: 'consent_required', message: 'x' },
        { path: ['body', 'measurements', 0, 'heightCm'], code: 'custom', message: 'x' },
      ],
    });
    const issues = rowIssues(error, [{ playerId: P1 }, { playerId: P2 }]);
    expect(issues?.get(P1)).toEqual({
      playerId: 'anthropometry.error.consent',
      heightCm: 'anthropometry.error.value',
    });
    expect(issues?.get(P2)).toEqual({ skinfoldsSumMm: 'anthropometry.error.skinfoldsStage' });
    expect(rowIssues(new Error('boom'), [])).toBeNull();
  });
});
