import {
  alertDetailSchema,
  categorySchema,
  weeklyPanelSchema,
  type AlertDetailDto,
  type Category,
  type PanelAlert,
  type PanelPlayer,
  type WeeklyPanel,
} from '@sport-performance/contracts';
import {
  addDays,
  parseCategoryId,
  parseLocalDate,
  parsePlayerId,
  parseUuid,
} from '@sport-performance/domain';

/**
 * Valid payloads of the staff reads (B-510): they pass the contract schemas,
 * so the typed client accepts them from the fake API.
 */

const AT = '2026-03-01T12:00:00.000Z';
export const TODAY = parseLocalDate('2026-11-03');
const MONDAY = parseLocalDate('2026-11-02');

export function category(id: string, name: string, sortOrder = 0): Category {
  return categorySchema.parse({
    id,
    sport: 'rugby',
    sex: 'male',
    ageBandCode: 'm15',
    name,
    defaultStage: 'development',
    sortOrder,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: '1793586338688123',
  });
}

export const M15 = category('0192e7a0-2222-7000-8000-000000000015', 'M15');
export const M17 = category('0192e7a0-2222-7000-8000-000000000017', 'M17', 1);

let sequence = 0;

export function panelAlert(overrides: Partial<PanelAlert> = {}): PanelAlert {
  sequence += 1;
  return {
    id: parseUuid(`0192e7a0-4444-7000-8000-${String(sequence).padStart(12, '0')}`),
    kind: 'acwr_high',
    severity: 'critical',
    status: 'open',
    raisedOn: TODAY,
    lastSeenOn: TODAY,
    messageKey: 'alert.acwr_high.message',
    values: { acwrRatio: 1.456, thresholdRatio: 1.4 },
    ...overrides,
  };
}

export function panelPlayer(index: number, overrides: Partial<PanelPlayer> = {}): PanelPlayer {
  return {
    playerId: parsePlayerId(`0192e7a0-5555-7000-8000-${String(index).padStart(12, '0')}`),
    firstName: 'Jugador',
    lastName: `Apellido ${String(index)}`,
    sex: 'male',
    sport: 'rugby',
    birthDate: parseLocalDate('2011-05-04'),
    categoryIds: [parseCategoryId(M15.id)],
    position: null,
    stage: 'development',
    maturity: null,
    wellness: {
      submittedToday: false,
      weekEntries: 0,
      weekMeanScore: null,
      latestOn: null,
      latestMeanScore: null,
      latestZScore: null,
    },
    load: {
      weekLoadAu: 0,
      pendingRpeN: 0,
      asOf: null,
      historyDays: 0,
      acwr: null,
      acwrStatus: 'insufficient_history',
      acuteEwmaAu: null,
      chronicEwmaAu: null,
      monotony: null,
      strainAu: null,
      monotonyStatus: 'insufficient_history',
      weeks: Array.from({ length: 4 }, () => ({
        loadAu: 0,
        hasData: false,
        chronicWeeklyAu: null,
      })),
    },
    availability: { training: 'available', match: 'available', overall: 'available' },
    alerts: [],
    ...overrides,
  };
}

export function weeklyPanel(players: readonly PanelPlayer[]): WeeklyPanel {
  return weeklyPanelSchema.parse({
    today: TODAY,
    week: { from: MONDAY, to: addDays(MONDAY, 6) },
    referenceDate: TODAY,
    weeks: Array.from({ length: 4 }, (_, index) => {
      const from = addDays(MONDAY, -7 * (3 - index));
      return { from, to: addDays(from, 6) };
    }),
    players,
  });
}

/** A small squad: one of each state. */
export function squad(): PanelPlayer[] {
  return [
    panelPlayer(1, {
      firstName: 'Tomás',
      lastName: 'Bianchi',
      availability: { training: 'limited', match: 'unavailable', overall: 'unavailable' },
    }),
    panelPlayer(2, {
      firstName: 'Juan',
      lastName: 'Acosta',
      alerts: [
        panelAlert({ severity: 'warning', kind: 'acwr_low', messageKey: 'alert.acwr_low.message' }),
        panelAlert(),
      ],
    }),
    panelPlayer(3, {
      firstName: 'Lucas',
      lastName: 'Zárate',
      availability: { training: 'limited', match: 'limited', overall: 'limited' },
      wellness: {
        submittedToday: true,
        weekEntries: 1,
        weekMeanScore: 4,
        latestOn: TODAY,
        latestMeanScore: 4,
        latestZScore: null,
      },
    }),
    panelPlayer(4, {
      firstName: 'Pedro',
      lastName: 'Correa',
      categoryIds: [parseCategoryId(M17.id)],
      alerts: [
        panelAlert({
          severity: 'warning',
          kind: 'wellness_low',
          messageKey: 'alert.wellness_low.message',
          values: { wellnessScore: 3.2, thresholdScore: 3.3 },
        }),
      ],
    }),
    panelPlayer(5, { firstName: 'Mateo', lastName: 'Díaz' }),
    panelPlayer(6, {
      firstName: 'Bruno',
      lastName: 'Ferrari',
      categoryIds: [parseCategoryId(M17.id)],
      wellness: {
        submittedToday: true,
        weekEntries: 3,
        weekMeanScore: 4.2,
        latestOn: TODAY,
        latestMeanScore: 4.4,
        latestZScore: 0.3,
      },
    }),
  ];
}

export function alertDetail(
  alert: PanelAlert,
  player: PanelPlayer,
  overrides: Partial<AlertDetailDto> = {},
): AlertDetailDto {
  return alertDetailSchema.parse({
    id: alert.id,
    playerId: player.playerId,
    ruleId: '0192e7a0-7777-7000-8000-000000000001',
    ruleCode: 'acwr_high_red',
    kind: alert.kind,
    severity: alert.severity,
    currentSeverity: alert.severity,
    raisedOn: alert.raisedOn,
    lastSeenOn: alert.lastSeenOn,
    resolvedOn: null,
    observedOn: alert.lastSeenOn,
    messageKey: alert.messageKey,
    suggestionKey: `alert.${alert.kind}.suggestion`,
    values: alert.values,
    status: alert.status,
    acknowledgedAt: null,
    acknowledgedBy: null,
    acknowledgementNote: null,
    createdAt: AT,
    updatedAt: AT,
    version: '1793586338688125',
    events: [
      {
        seq: 10,
        type: 'raised',
        localDate: alert.raisedOn,
        severity: alert.severity,
        note: null,
        actorId: null,
        createdAt: AT,
      },
    ],
    ...overrides,
  });
}
