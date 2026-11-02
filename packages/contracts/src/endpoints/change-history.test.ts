import {
  CHANGE_REASON_MAX_LENGTH,
  CHANGE_TRACKED_TABLES,
  type PlayerId,
} from '@sport-performance/domain';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  changeHistoryEntrySchema,
  changeHistoryPageSchema,
  changeReasonSchema,
  changeTrackedTableSchema,
  type ChangeHistoryEntry,
} from './change-history.js';

const entry = {
  id: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f',
  tableName: 'test_result',
  recordId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  playerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
  operation: 'update',
  source: 'app',
  changedBy: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
  actorRole: 'sc',
  changedAt: '2026-11-01T12:00:00.000Z',
  reason: 'Se cargó en el jugador equivocado',
  requestId: 'req-0192e7a0',
  changes: [
    { column: 'notes', previous: 'Viento a favor', current: 'Sin viento' },
    { column: 'conditions', previous: { surface: 'grass' }, current: { surface: 'synthetic' } },
    { column: 'evaluator_id', previous: null, current: '3f2504e0-4f89-41d3-9a0c-0305e82c3303' },
  ],
} as const;

describe('change history contract', () => {
  it('parses an entry into the domain ids', () => {
    const parsed = changeHistoryEntrySchema.parse(entry);
    expect(parsed).toEqual(entry);
    expectTypeOf(parsed.playerId).toEqualTypeOf<PlayerId | null>();
    expectTypeOf<ChangeHistoryEntry['tableName']>().toEqualTypeOf<
      (typeof CHANGE_TRACKED_TABLES)[number]
    >();
  });

  it('accepts deletes, system changes and changes without reason', () => {
    const removed = {
      ...entry,
      playerId: null,
      operation: 'delete',
      source: 'system',
      changedBy: null,
      actorRole: null,
      reason: null,
      requestId: null,
      changes: [{ column: 'reps', previous: 8, current: null }],
    };
    expect(changeHistoryEntrySchema.safeParse(removed).success).toBe(true);
  });

  it('rejects an entry without changes or with an unknown table', () => {
    expect(changeHistoryEntrySchema.safeParse({ ...entry, changes: [] }).success).toBe(false);
    expect(changeHistoryEntrySchema.safeParse({ ...entry, tableName: 'injury' }).success).toBe(
      false,
    );
  });

  it('lists the tracked tables of the domain', () => {
    expect(changeTrackedTableSchema.options).toEqual([...CHANGE_TRACKED_TABLES]);
  });

  it('pages entries with a cursor', () => {
    expect(changeHistoryPageSchema.parse({ items: [entry], nextCursor: null }).items).toHaveLength(
      1,
    );
  });

  it('validates the reason like the domain and the database', () => {
    expect(changeReasonSchema.safeParse('Error de tipeo').success).toBe(true);
    expect(changeReasonSchema.safeParse('🏉'.repeat(CHANGE_REASON_MAX_LENGTH)).success).toBe(true);
    for (const value of ['', '   ', ' con espacio', 'x'.repeat(CHANGE_REASON_MAX_LENGTH + 1)]) {
      expect(changeReasonSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it('is representable in JSON Schema (for the future endpoints)', () => {
    expect(() => z.toJSONSchema(changeHistoryPageSchema)).not.toThrow();
    expect(() => z.toJSONSchema(changeReasonSchema)).not.toThrow();
  });
});
