import type {
  Drill,
  Participation,
  SessionRosterEntry,
  TrainingSession,
  TrainingSessionDetail,
} from '@sport-performance/contracts';
import { parsePlayerId } from '@sport-performance/domain';
import { M15_RUGBY } from './fixtures';

/** Valid payloads of the training endpoints (they go through the client's validation). */

const AT = '2026-11-01T12:00:00.000Z';
const VERSION = '1793586338688123';

export const SESSION_ID = '0192e7a0-4444-7000-8000-000000000001';
export const P1 = parsePlayerId('0192e7a0-5555-7000-8000-000000000001');
export const P2 = parsePlayerId('0192e7a0-5555-7000-8000-000000000002');
export const P3 = parsePlayerId('0192e7a0-5555-7000-8000-000000000003');

export function trainingSession(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: SESSION_ID as TrainingSession['id'],
    sport: 'rugby',
    kind: 'training',
    categoryId: M15_RUGBY.id,
    title: null,
    // 18:30 in Buenos Aires (UTC−3).
    startsAt: '2026-11-03T21:30:00.000Z',
    localDate: '2026-11-03' as TrainingSession['localDate'],
    plannedDurationMin: 90,
    location: null,
    opponent: null,
    notes: null,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function drill(id: string, name: string, overrides: Partial<Drill> = {}): Drill {
  return {
    id: id as Drill['id'],
    trainingSessionId: SESSION_ID as Drill['trainingSessionId'],
    name,
    sortOrder: 0,
    durationMin: null,
    contactLevel: 'none',
    notes: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function sessionDetail(
  overrides: Partial<TrainingSession> = {},
  drills: readonly Drill[] = [],
): TrainingSessionDetail {
  return { ...trainingSession(overrides), drills: [...drills] };
}

export function participation(
  playerId: string,
  overrides: Partial<Participation> = {},
): Participation {
  return {
    id: `0192e7a0-6666-7000-8000-${playerId.slice(-12)}` as Participation['id'],
    trainingSessionId: SESSION_ID as Participation['trainingSessionId'],
    playerId: parsePlayerId(playerId),
    status: 'full',
    minutes: 90,
    contactsN: null,
    rpe: null,
    rpeReportedAt: null,
    srpeAu: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function rosterEntry(
  playerId: string,
  names: { first: string; last: string },
  overrides: Partial<SessionRosterEntry> = {},
): SessionRosterEntry {
  return {
    player: {
      id: parsePlayerId(playerId),
      firstName: names.first,
      lastName: names.last,
      archivedAt: null,
    },
    inCategory: true,
    participation: null,
    availability: { status: 'available', staffNotes: [] },
    hasDataConsent: true,
    canRecord: true,
    ...overrides,
  };
}
