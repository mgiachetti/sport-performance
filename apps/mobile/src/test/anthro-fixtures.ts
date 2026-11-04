import type { AnthroMeasurement, SyncChange } from '@sport-performance/contracts';
import type { SquadPlayer } from '../anthropometry/model.ts';
import { PLAYER_ID, uuid } from './fake-sync-server.ts';

export const DAY = '2026-11-03';
export const OTHER_PLAYER_ID =
  'b2222222-2222-4222-8222-222222222222' as AnthroMeasurement['playerId'];

/** A measurement as `GET /v1/anthro-measurements` renders it. */
export function anthroDto(overrides: Partial<AnthroMeasurement> = {}): AnthroMeasurement {
  return {
    id: uuid(),
    playerId: PLAYER_ID,
    testSessionId: null,
    measuredOn: DAY,
    heightCm: 165.4,
    sittingHeightCm: 85.2,
    weightKg: 55.1,
    skinfoldsSumMm: null,
    method: 'manual',
    evaluatorId: null,
    conditions: {},
    notes: null,
    maturation: {
      phvOffsetYears: -0.8,
      maturityOffsetEquation: 'mirwald_2002',
      predictedAdultHeightCm: 178.2,
      adultHeightPct: 92.8,
      growthVelocityCmYear: null,
      derivedAt: '2026-11-03T12:00:05.000Z',
    },
    createdAt: '2026-11-03T12:00:00.000Z',
    updatedAt: '2026-11-03T12:00:00.000Z',
    version: 'v1',
    ...overrides,
  } as AnthroMeasurement;
}

export function anthroUpsert(
  data: AnthroMeasurement,
  clientUuid: string | null = null,
): SyncChange {
  return {
    collection: 'anthro_measurement',
    op: 'upsert',
    id: data.id,
    clientUuid,
    data,
  } as SyncChange;
}

export function squadPlayer(overrides: Partial<SquadPlayer> = {}): SquadPlayer {
  return {
    id: PLAYER_ID,
    name: 'Juan Pérez',
    sex: 'male',
    birthDate: '2011-05-01' as SquadPlayer['birthDate'],
    stage: 'development',
    blocked: false,
    parentHeightsMissing: false,
    ...overrides,
  };
}
