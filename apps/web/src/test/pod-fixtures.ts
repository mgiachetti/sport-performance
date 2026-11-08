import type { Pod, PodAssignment, SessionPodPlayer } from '@sport-performance/contracts';
import { parsePlayerId } from '@sport-performance/domain';
import { SESSION_ID } from './training-fixtures';

/** Valid payloads of the pod endpoints (B-912; they go through the client's validation). */

const AT = '2026-11-01T12:00:00.000Z';
const VERSION = '1793586338688123';

export function pod(number: number, overrides: Partial<Pod> = {}): Pod {
  const suffix = String(number).padStart(12, '0');
  return {
    id: `0192e7a0-8888-7000-8000-${suffix}` as Pod['id'],
    deviceId: `0192e7a0-8889-7000-8000-${suffix}` as Pod['deviceId'],
    serialNumber: `SPP-${String(number).padStart(4, '0')}`,
    hardwareRevision: 'v0',
    number,
    shortId: number,
    label: null,
    status: 'active',
    statusChangedAt: AT,
    keyEpoch: 0,
    keysRevokedAt: null,
    borrowedFromClubId: null,
    health: {
      lastSeenAt: null,
      reportedAt: null,
      batteryCycles: null,
      batteryCapacityPct: null,
      nandBadBlocks: null,
      firmwareVersion: null,
      gnssFirmwareVersion: null,
    },
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function podAssignment(
  playerId: string,
  podOf: Pod,
  overrides: Partial<PodAssignment> = {},
): PodAssignment {
  return {
    id: `0192e7a0-9999-7000-8000-${playerId.slice(-12)}` as PodAssignment['id'],
    clientUuid: `0192e7a0-999a-7000-8000-${playerId.slice(-12)}` as PodAssignment['clientUuid'],
    podId: podOf.id,
    podNumber: podOf.number,
    playerId: parsePlayerId(playerId),
    trainingSessionId: SESSION_ID as PodAssignment['trainingSessionId'],
    startsAt: '2026-11-03T21:30:00.000Z',
    endsAt: null,
    note: null,
    reprocessRequestedAt: null,
    archivedAt: null,
    createdBy: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function sessionPodPlayer(
  playerId: string,
  names: { first: string; last: string },
  overrides: Partial<SessionPodPlayer> = {},
): SessionPodPlayer {
  return {
    playerId: parsePlayerId(playerId),
    firstName: names.first,
    lastName: names.last,
    missingConsents: [],
    canAssign: true,
    assignment: null,
    ...overrides,
  };
}
