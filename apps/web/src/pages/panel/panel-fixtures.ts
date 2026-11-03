import type { PanelAlert, PanelPlayer, WeeklyPanel } from '@sport-performance/contracts';
import {
  addDays,
  parseCategoryId,
  parseLocalDate,
  parsePlayerId,
  parseUuid,
  type LocalDate,
} from '@sport-performance/domain';
import { M15_RUGBY, M17_RUGBY } from '../../test/fixtures';

/** Valid `GET /v1/panel/weekly` payloads for the panel's tests (they pass the client's validation). */

export const TODAY = parseLocalDate('2026-11-03');
export const WEEK_FROM = parseLocalDate('2026-11-02');
const WEEKS = 4;

export function weeks(from: LocalDate = WEEK_FROM, count = WEEKS) {
  return Array.from({ length: count }, (_, index) => {
    const start = addDays(from, -7 * (count - 1 - index));
    return { from: start, to: addDays(start, 6) };
  });
}

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
    values: { acwrRatio: 1.456, thresholdRatio: 1.4, historyDays: 40 },
    ...overrides,
  };
}

export function panelPlayer(
  index: number,
  overrides: Omit<Partial<PanelPlayer>, 'load'> & { load?: Partial<PanelPlayer['load']> } = {},
): PanelPlayer {
  const { load, ...rest } = overrides;
  return {
    playerId: parsePlayerId(`0192e7a0-5555-7000-8000-${String(index).padStart(12, '0')}`),
    firstName: 'Jugador',
    lastName: `Apellido ${String(index)}`,
    sex: 'male',
    sport: 'rugby',
    birthDate: parseLocalDate('2011-05-04'),
    categoryIds: [M15_RUGBY.id],
    position: {
      id: parseUuid('0192e7a0-6666-7000-8000-000000000001'),
      code: 'hooker',
      label: null,
    },
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
      weeks: weeks().map(() => ({ loadAu: 0, hasData: false, chronicWeeklyAu: null })),
      ...load,
    },
    availability: { training: 'available', match: 'available', overall: 'available' },
    alerts: [],
    ...rest,
  };
}

export function weeklyPanel(
  players: readonly PanelPlayer[],
  from: LocalDate = WEEK_FROM,
): WeeklyPanel {
  const current = from === WEEK_FROM;
  return {
    today: TODAY,
    week: { from, to: addDays(from, 6) },
    referenceDate: current ? TODAY : addDays(from, 6),
    weeks: weeks(from),
    players: [...players],
  };
}

/** A small M15 + M17 squad with a bit of everything. */
export function squad(): PanelPlayer[] {
  return [
    panelPlayer(1, {
      firstName: 'Tomás',
      lastName: 'Bianchi',
      maturity: {
        measuredOn: parseLocalDate('2026-08-01'),
        phvOffsetYears: -0.6,
        phvOffsetYearsOnDate: -0.35,
        adultHeightPct: 91.2,
        growthVelocityCmYear: 9.1,
      },
      wellness: {
        submittedToday: true,
        weekEntries: 2,
        weekMeanScore: 2.5,
        latestOn: TODAY,
        latestMeanScore: 2,
        latestZScore: -2.1,
      },
      load: {
        weekLoadAu: 1200,
        pendingRpeN: 1,
        asOf: TODAY,
        historyDays: 60,
        acwr: 1.456,
        acwrStatus: 'ok',
        weeks: [
          { loadAu: 1500, hasData: true, chronicWeeklyAu: 1400 },
          { loadAu: 1600, hasData: true, chronicWeeklyAu: 1450 },
          { loadAu: 1700, hasData: true, chronicWeeklyAu: 1500 },
          { loadAu: 1200, hasData: true, chronicWeeklyAu: 1550 },
        ],
      },
      availability: { training: 'limited', match: 'unavailable', overall: 'unavailable' },
      alerts: [
        panelAlert(),
        panelAlert({
          kind: 'wellness_low',
          severity: 'warning',
          messageKey: 'alert.wellness_low.message',
          values: { wellnessScore: 2, thresholdScore: 3 },
        }),
      ],
    }),
    panelPlayer(2, {
      firstName: 'Bautista',
      lastName: 'Paz',
      maturity: {
        measuredOn: parseLocalDate('2026-08-01'),
        phvOffsetYears: 1.4,
        phvOffsetYearsOnDate: 1.65,
        adultHeightPct: null,
        growthVelocityCmYear: null,
      },
      wellness: {
        submittedToday: false,
        weekEntries: 1,
        weekMeanScore: 4.5,
        latestOn: parseLocalDate('2026-11-02'),
        latestMeanScore: 4.5,
        latestZScore: 0.3,
      },
      load: {
        weekLoadAu: 800,
        asOf: TODAY,
        historyDays: 60,
        acwr: 1.1,
        acwrStatus: 'ok',
        weeks: [
          { loadAu: 900, hasData: true, chronicWeeklyAu: 1000 },
          { loadAu: 1000, hasData: true, chronicWeeklyAu: 1000 },
          { loadAu: 1100, hasData: true, chronicWeeklyAu: 1050 },
          { loadAu: 800, hasData: true, chronicWeeklyAu: 1100 },
        ],
      },
    }),
    panelPlayer(3, {
      firstName: 'Felipe',
      lastName: 'Roldán',
      categoryIds: [M17_RUGBY.id],
      position: null,
      alerts: [
        panelAlert({
          kind: 'growth_peak',
          severity: 'warning',
          messageKey: 'alert.growth_peak.message',
          values: { velocityCmYear: 9.4, thresholdCmYear: 8 },
        }),
      ],
    }),
  ];
}

export const UNKNOWN_CATEGORY = parseCategoryId('0192e7a0-2222-7000-8000-000000000099');
