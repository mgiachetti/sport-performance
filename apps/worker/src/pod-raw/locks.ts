import type { ClubId } from '@sport-performance/domain';
import type { ClubTransaction } from '../database.js';

/**
 * The trim of a pod's log and the erasure of a player's position data
 * (revoking `location`) never interleave for the same player: both take this
 * transaction lock per (club, player) before writing or deleting, always in
 * player id order (no deadlock between a trim of several players and an
 * erasure batch). Whoever comes second sees what the first committed: the
 * erasure deletes the trim's rows, or the trim sees the revocation and keeps
 * nothing of that player.
 */
export async function lockPlayersLocation(
  tx: ClubTransaction,
  clubId: ClubId,
  playerIds: Iterable<string>,
): Promise<void> {
  for (const playerId of [...new Set(playerIds)].sort()) {
    await tx.client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `pod-location:${clubId}:${playerId}`,
    ]);
  }
}

/**
 * Under the lock: the players whose position data may still be kept, those
 * with a live (never revoked) `location` consent and no pending erasure.
 */
export async function playersStillKeepingLocation(
  tx: ClubTransaction,
  clubId: ClubId,
  playerIds: readonly string[],
): Promise<Set<string>> {
  if (playerIds.length === 0) return new Set();
  const { rows } = await tx.client.query<{ id: string }>(
    `select p.id from player p
      where p.club_id = $1 and p.id = any ($2::uuid[])
        and exists (select 1 from consent c
                     where c.club_id = p.club_id and c.player_id = p.id
                       and c.type::text = 'location' and c.revoked_at is null)
        and not exists (select 1 from location_erasure e
                         where e.club_id = p.club_id and e.player_id = p.id
                           and e.status = 'pending')`,
    [clubId, [...playerIds]],
  );
  return new Set(rows.map((r) => r.id));
}
