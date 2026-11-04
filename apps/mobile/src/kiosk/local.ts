import type { SyncOperationRequest } from '@sport-performance/contracts';
import {
  participationCarriesLoad,
  type LocalDate,
  type WellnessItem,
} from '@sport-performance/domain';
import type { LocalStore } from '../offline/local-store.ts';
import { rpeKey, type KioskLocalFacts } from './roster.ts';

/**
 * What the kiosk reads from and writes to the device's own database
 * (B-502, ADR 0069): the queue and the pulled rows, so that what this kiosk
 * loaded, or the sync brought, counts at once, without signal too.
 */

/**
 * The check-ins of `today` and the RPEs of `sessionIds` the device knows of:
 * queued by this kiosk (for any player, whether or not they came back) or
 * pulled (loaded from the player's own account or another kiosk).
 */
export async function kioskLocalFacts(
  store: LocalStore,
  membershipId: string,
  today: LocalDate,
  sessionIds: readonly string[],
): Promise<KioskLocalFacts> {
  const wellnessDone = new Set<string>();
  const rpeDone = new Set<string>();
  const notTakingPart = new Set<string>();
  for (const queued of await store.pending(membershipId, ['wellness.submit', 'rpe.submit'])) {
    if (queued.op === 'wellness.submit') {
      const { body } = queued.input as { body: { playerId?: string; localDate?: string } };
      if (body.playerId !== undefined && body.localDate === today) wellnessDone.add(body.playerId);
    } else {
      const { params, body } = queued.input as {
        params: { trainingSessionId: string };
        body: { playerId?: string };
      };
      if (body.playerId !== undefined) rpeDone.add(rpeKey(params.trainingSessionId, body.playerId));
    }
  }
  for (const row of await store.list(membershipId, 'wellness', { from: today, to: today })) {
    wellnessDone.add(row.data.playerId);
  }
  for (const sessionId of new Set(sessionIds)) {
    for (const row of await store.list(membershipId, 'participation', { parentId: sessionId })) {
      const key = rpeKey(sessionId, row.data.playerId);
      if (row.data.rpe !== null) rpeDone.add(key);
      else if (!participationCarriesLoad(row.data.status)) notTakingPart.add(key);
    }
  }
  return { wellnessDone, rpeDone, notTakingPart };
}

/** The check-in the kiosk queues for a player: for the club day it was answered on. */
export function kioskWellnessRequest(input: {
  readonly playerId: string;
  readonly today: LocalDate;
  readonly scores: Partial<Record<WellnessItem, number>>;
  readonly clientUuid: string;
}): SyncOperationRequest<'wellness.submit'> {
  return {
    body: {
      clientUuid: input.clientUuid,
      playerId: input.playerId,
      // Explicit: a queue that syncs after midnight still loads the day it was answered.
      localDate: input.today,
      scores: input.scores,
    },
  };
}

/** The RPE the kiosk queues for a player and a session. */
export function kioskRpeRequest(input: {
  readonly playerId: string;
  readonly sessionId: string;
  readonly rpe: number;
  readonly clientUuid: string;
}): SyncOperationRequest<'rpe.submit'> {
  return {
    params: { trainingSessionId: input.sessionId },
    body: { clientUuid: input.clientUuid, playerId: input.playerId, rpe: input.rpe },
  };
}
