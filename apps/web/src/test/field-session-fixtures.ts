import type {
  FieldSession,
  FieldSessionListItem,
  FieldSessionPlayer,
} from '@sport-performance/contracts';
import { parsePlayerId } from '@sport-performance/domain';
import * as fixtures from './fixtures';

/** Valid payloads of the field session endpoints (B-408) for the screen tests. */

export const MATCH_ID = '0192e7a0-4444-7000-8000-000000000001';
export const TRAINING_ID = '0192e7a0-4444-7000-8000-000000000002';

const AT = '2026-10-24T18:00:00.000Z';

export function sessionSummary(
  overrides: Partial<FieldSessionListItem['session']> = {},
): FieldSessionListItem['session'] {
  return {
    id: MATCH_ID as FieldSessionListItem['session']['id'],
    sport: 'rugby',
    kind: 'match',
    categoryId: fixtures.M15_RUGBY.id,
    title: 'M15 vs. CASI',
    startsAt: AT,
    localDate: '2026-10-24' as FieldSessionListItem['session']['localDate'],
    plannedDurationMin: 70,
    archivedAt: null,
    ...overrides,
  };
}

export function listItem(overrides: Partial<FieldSessionListItem> = {}): FieldSessionListItem {
  return {
    session: sessionSummary(),
    playersN: 3,
    sources: ['catapult'],
    metricCodes: ['dist_m', 'hsr_abs_m', 'vmax_ms'] as FieldSessionListItem['metricCodes'],
    ...overrides,
  };
}

export function player(
  id: string,
  firstName: string,
  lastName: string,
  overrides: Partial<FieldSessionPlayer> = {},
): FieldSessionPlayer {
  return {
    playerId: parsePlayerId(id),
    firstName,
    lastName,
    position: null,
    participation: { status: 'full', minutes: 70, contactsN: 10, rpe: 7, srpeAu: 490 },
    values: [],
    ...overrides,
  };
}

type Values = FieldSessionPlayer['values'];

export const values = (...entries: [string, 'catapult' | 'pod' | 'hr_band' | 'manual', number][]) =>
  entries.map(([metricCode, source, value]) => ({ metricCode, source, value })) as Values;

export const ALVAREZ = player('0192e7a0-5555-7000-8000-000000000001', 'Tomás', 'Álvarez', {
  position: { code: 'hooker', label: null, lineCode: 'forwards' },
  values: values(
    ['dist_m', 'catapult', 5120],
    ['hsr_abs_m', 'catapult', 310],
    ['vmax_ms', 'catapult', 7.84],
    ['contacts_n', 'catapult', 18],
  ),
});
export const BIANCHI = player('0192e7a0-5555-7000-8000-000000000002', 'Juan', 'Bianchi', {
  position: { code: 'fly_half', label: null, lineCode: 'backs' },
  values: values(
    ['dist_m', 'catapult', 6230],
    ['hsr_abs_m', 'catapult', 520],
    ['vmax_ms', 'catapult', 8.61],
    ['contacts_n', 'catapult', 6],
  ),
});
export const CASTRO = player('0192e7a0-5555-7000-8000-000000000003', 'Lucas', 'Castro', {
  participation: {
    status: 'unavailable',
    minutes: null,
    contactsN: null,
    rpe: null,
    srpeAu: null,
  },
});

export function fieldSession(overrides: Partial<FieldSession> = {}): FieldSession {
  return {
    session: {
      ...sessionSummary(),
      location: 'Cancha 1',
      opponent: 'CASI',
      notes: null,
      createdAt: AT,
      updatedAt: AT,
      version: '1793586338688123',
    },
    columns: [
      { metricCode: 'dist_m', source: 'catapult', unit: 'm', direction: 'higher_is_better' },
      { metricCode: 'hsr_abs_m', source: 'catapult', unit: 'm', direction: 'higher_is_better' },
      { metricCode: 'vmax_ms', source: 'catapult', unit: 'ms', direction: 'higher_is_better' },
      { metricCode: 'contacts_n', source: 'catapult', unit: 'n', direction: 'neutral' },
    ] as FieldSession['columns'],
    players: [ALVAREZ, BIANCHI, CASTRO],
    references: [
      {
        metricCode: 'dist_m',
        unit: 'm',
        value: 6000,
        method: 'pod',
        validFrom: '2026-01-01',
        source: 'Catapult de primera',
      },
    ] as FieldSession['references'],
    ...overrides,
  };
}
