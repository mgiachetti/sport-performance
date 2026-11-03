import { describe, expect, it } from 'vitest';
import { alertDetailSchema, getAlert, listAlerts, reviewAlert } from './alerts.js';

const alert = {
  id: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f',
  playerId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10',
  ruleId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e11',
  ruleCode: 'acwr_high',
  kind: 'acwr_high',
  severity: 'critical',
  currentSeverity: 'warning',
  raisedOn: '2026-11-01',
  lastSeenOn: '2026-11-02',
  resolvedOn: null,
  observedOn: '2026-11-02',
  messageKey: 'alert.acwr_high.message',
  suggestionKey: 'alert.acwr_high.suggestion',
  values: { acwrRatio: 1.35, thresholdRatio: 1.3, historyDays: 40 },
  status: 'open',
  acknowledgedAt: null,
  acknowledgedBy: null,
  acknowledgementNote: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
  version: '1793586338688123',
  events: [
    {
      seq: 1,
      type: 'raised',
      localDate: '2026-11-01',
      severity: 'critical',
      note: null,
      actorId: null,
      createdAt: '2026-11-01T10:00:00.000Z',
    },
  ],
};

describe('alert endpoints', () => {
  it('are club endpoints under /v1/alerts', () => {
    for (const endpoint of [listAlerts, getAlert, reviewAlert]) {
      expect(endpoint.auth).toBe('club');
      expect(endpoint.tags).toEqual(['alerts']);
      expect(endpoint.path.startsWith('/v1/alerts')).toBe(true);
    }
    expect(reviewAlert.method).toBe('POST');
  });

  it('describes an episode with its history and no UI text', () => {
    expect(alertDetailSchema.safeParse(alert).success).toBe(true);
    expect(alertDetailSchema.safeParse({ ...alert, values: { acwrRatio: 'alto' } }).success).toBe(
      false,
    );
  });

  it('filters by state, status, severity and kind, newest first by default', () => {
    const query = listAlerts.query;
    expect(query.parse({})).toMatchObject({ state: 'all', sort: '-raisedOn', limit: 50 });
    expect(
      query.safeParse({ state: 'active', status: 'open', severity: 'critical', kind: 'cmj_drop' })
        .success,
    ).toBe(true);
    expect(query.safeParse({ state: 'open' }).success).toBe(false);
    expect(query.safeParse({ kind: 'player_load' }).success).toBe(false);
  });

  it('reviews with the version read, a known status and a trimmed note', () => {
    const body = reviewAlert.body;
    expect(body.safeParse({ version: '1', status: 'acknowledged' }).success).toBe(true);
    expect(body.parse({ version: '1', status: 'dismissed', note: '  No aplica  ' }).note).toBe(
      'No aplica',
    );
    for (const invalid of [
      { status: 'acknowledged' },
      { version: '1', status: 'open' },
      { version: '1', status: 'acknowledged', note: '   ' },
      { version: '1', status: 'acknowledged', note: 'x'.repeat(1001) },
      { version: '1', status: 'acknowledged', extra: true },
    ]) {
      expect(body.safeParse(invalid).success, JSON.stringify(invalid).slice(0, 60)).toBe(false);
    }
  });
});
