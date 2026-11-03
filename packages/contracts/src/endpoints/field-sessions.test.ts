import { describe, expect, it } from 'vitest';
import {
  fieldSessionListItemSchema,
  fieldSessionSchema,
  getTrainingSessionFieldMetrics,
  listFieldSessions,
} from './field-sessions.js';

const sessionId = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';
const playerId = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10';

const session = {
  id: sessionId,
  sport: 'rugby',
  kind: 'match',
  categoryId: null,
  title: null,
  startsAt: '2026-10-27T21:00:00.000Z',
  localDate: '2026-10-27',
  plannedDurationMin: 78,
  location: null,
  opponent: 'CASI',
  notes: null,
  archivedAt: null,
  createdAt: '2026-10-27T21:00:00.000Z',
  updatedAt: '2026-10-27T21:00:00.000Z',
  version: '1793586338688123',
};

describe('listFieldSessions', () => {
  it('is a cursor list sorted by start, newest first', () => {
    expect(listFieldSessions.path).toBe('/v1/field-sessions');
    const query = listFieldSessions.query.parse({});
    expect(query).toMatchObject({ limit: 50, sort: '-startsAt' });
    expect(listFieldSessions.query.safeParse({ limit: 101 }).success).toBe(false);
    expect(listFieldSessions.query.safeParse({ sort: 'createdAt' }).success).toBe(false);
    expect(listFieldSessions.query.safeParse({ source: 'pod' }).success).toBe(false);
  });

  it('needs at least one player, source and metric per item', () => {
    const item = {
      session: {
        id: sessionId,
        sport: 'rugby',
        kind: 'match',
        categoryId: null,
        title: null,
        startsAt: session.startsAt,
        localDate: session.localDate,
        plannedDurationMin: 78,
        archivedAt: null,
      },
      playersN: 23,
      sources: ['catapult'],
      metricCodes: ['dist_m', 'hsr_abs_m'],
    };
    expect(fieldSessionListItemSchema.parse(item).playersN).toBe(23);
    expect(fieldSessionListItemSchema.safeParse({ ...item, sources: [] }).success).toBe(false);
    expect(fieldSessionListItemSchema.safeParse({ ...item, sources: ['gps'] }).success).toBe(false);
    expect(fieldSessionListItemSchema.safeParse({ ...item, playersN: 0 }).success).toBe(false);
  });
});

describe('getTrainingSessionFieldMetrics', () => {
  it('reads one session by id', () => {
    expect(getTrainingSessionFieldMetrics.path).toBe(
      '/v1/training-sessions/{trainingSessionId}/field-metrics',
    );
    expect(
      getTrainingSessionFieldMetrics.params.safeParse({ trainingSessionId: 'nope' }).success,
    ).toBe(false);
  });

  it('keeps each value with its source', () => {
    const view = {
      session,
      columns: [
        { metricCode: 'dist_m', source: 'catapult', unit: 'm', direction: 'higher_is_better' },
        { metricCode: 'dist_m', source: 'pod', unit: 'm', direction: 'higher_is_better' },
      ],
      players: [
        {
          playerId,
          firstName: 'Tomás',
          lastName: 'Pérez',
          position: { code: 'hooker', label: null, lineCode: 'forwards' },
          participation: { status: 'full', minutes: 78, contactsN: 12, rpe: 8, srpeAu: 624 },
          values: [
            { metricCode: 'dist_m', source: 'catapult', value: 5321 },
            { metricCode: 'dist_m', source: 'pod', value: 5288.5 },
          ],
        },
      ],
      references: [
        {
          metricCode: 'dist_m',
          unit: 'm',
          value: 6100,
          method: 'pod',
          validFrom: '2026-03-01',
          source: 'Catapult, temporada 2026',
        },
      ],
    };
    const parsed = fieldSessionSchema.parse(view);
    expect(parsed.players[0]?.values.map((v) => v.source)).toEqual(['catapult', 'pod']);
    expect(
      fieldSessionSchema.safeParse({
        ...view,
        columns: [{ ...view.columns[0], unit: 'meters' }],
      }).success,
    ).toBe(false);
  });

  it('says "unavailable" without a cause', () => {
    const player = {
      playerId,
      firstName: 'Tomás',
      lastName: 'Pérez',
      position: null,
      participation: {
        status: 'unavailable',
        minutes: null,
        contactsN: null,
        rpe: null,
        srpeAu: null,
      },
      values: [],
    };
    const parsed = fieldSessionSchema.parse({
      session,
      columns: [],
      players: [player],
      references: [],
    });
    expect(parsed.players[0]?.participation).toEqual(player.participation);
    expect(Object.keys(parsed.players[0]?.participation ?? {})).not.toContain('reason');
  });
});
