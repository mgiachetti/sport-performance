import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  PANEL_WEEKS_DEFAULT,
  PANEL_WEEKS_MAX,
  PANEL_WEEKS_MIN,
  getWeeklyPanel,
  weeklyPanelSchema,
} from './panel.js';

const panel = {
  today: '2026-11-03',
  week: { from: '2026-11-02', to: '2026-11-08' },
  referenceDate: '2026-11-03',
  weeks: [{ from: '2026-11-02', to: '2026-11-08' }],
  players: [
    {
      playerId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e01',
      firstName: 'Tomás',
      lastName: 'Bianchi',
      sex: 'male',
      sport: 'rugby',
      birthDate: '2011-05-04',
      categoryIds: [],
      position: null,
      stage: 'development',
      maturity: null,
      wellness: {
        submittedToday: true,
        weekEntries: 2,
        weekMeanScore: 3.5,
        latestOn: '2026-11-03',
        latestMeanScore: 4,
        latestZScore: null,
      },
      load: {
        weekLoadAu: 900,
        pendingRpeN: 0,
        asOf: '2026-11-03',
        historyDays: 40,
        acwr: 1.2,
        acwrStatus: 'ok',
        acuteEwmaAu: 60,
        chronicEwmaAu: 50,
        monotony: null,
        strainAu: null,
        monotonyStatus: 'zero_variance',
        weeks: [{ loadAu: 900, hasData: true, chronicWeeklyAu: 350 }],
      },
      availability: { training: 'limited', match: 'unavailable', overall: 'unavailable' },
      alerts: [],
    },
  ],
} satisfies z.input<typeof weeklyPanelSchema>;

describe('getWeeklyPanel', () => {
  it('is a club GET with a strict query', () => {
    expect(getWeeklyPanel).toMatchObject({ method: 'GET', path: '/v1/panel/weekly', auth: 'club' });
    expect(getWeeklyPanel.query.parse({})).toEqual({ weeks: PANEL_WEEKS_DEFAULT });
    expect(getWeeklyPanel.query.parse({ weeks: '8', weekOf: '2026-11-03' })).toEqual({
      weeks: 8,
      weekOf: '2026-11-03',
    });
    for (const weeks of [PANEL_WEEKS_MIN - 1, PANEL_WEEKS_MAX + 1, 1.5]) {
      expect(getWeeklyPanel.query.safeParse({ weeks }).success, String(weeks)).toBe(false);
    }
    expect(getWeeklyPanel.query.safeParse({ limit: 10 }).success).toBe(false);
    expect(getWeeklyPanel.query.safeParse({ weekOf: '03/11/2026' }).success).toBe(false);
  });

  it('describes the panel: availability without a cause', () => {
    expect(weeklyPanelSchema.parse(panel)).toEqual(panel);
    const [player] = panel.players;
    if (player === undefined) throw new Error('fixture');
    const withNull = { ...panel, players: [{ ...player, availability: null }] };
    expect(weeklyPanelSchema.safeParse(withNull).success).toBe(true);
    const badStatus = {
      ...panel,
      players: [{ ...player, availability: { ...player.availability, overall: 'injured' } }],
    };
    expect(weeklyPanelSchema.safeParse(badStatus).success).toBe(false);
  });

  it('never carries a dismissed alert', () => {
    const [player] = panel.players;
    if (player === undefined) throw new Error('fixture');
    const alert = {
      id: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e02',
      kind: 'acwr_high',
      severity: 'critical',
      raisedOn: '2026-11-01',
      lastSeenOn: '2026-11-03',
      messageKey: 'alert.acwr_high.message',
      values: { acwrRatio: 1.45 },
    } as const;
    const withAlert = (status: string) => ({
      ...panel,
      players: [{ ...player, alerts: [{ ...alert, status }] }],
    });
    expect(weeklyPanelSchema.safeParse(withAlert('open')).success).toBe(true);
    expect(weeklyPanelSchema.safeParse(withAlert('acknowledged')).success).toBe(true);
    expect(weeklyPanelSchema.safeParse(withAlert('dismissed')).success).toBe(false);
  });
});
