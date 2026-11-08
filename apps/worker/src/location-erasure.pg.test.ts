/**
 * Erasure of position data through the worker's login (B-913, ADR 0106): the
 * pending erasures of a club are completed with their counts, the change
 * history records the completion with the reason and no data, another club is
 * not touched, and a second run finds nothing to do.
 */
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import {
  LOCATION_ERASURE_CHANGE_REASON,
  parseClubId,
  type ClubId,
} from '@sport-performance/domain';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listLocationErasureClubs, runClubLocationErasures } from './location-erasure.js';

const serverUrl = process.env.DATABASE_URL;
const hasDatabase = serverUrl !== undefined && serverUrl.trim() !== '';
if (!hasDatabase && process.env.CI !== undefined && process.env.CI !== '') {
  throw new Error('DATABASE_URL is required in CI: the worker tests run against real Postgres.');
}

const logger = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('location erasure (Postgres 16)', () => {
  let temporary: TemporaryDatabase;
  let owner: pg.Pool;
  let worker: pg.Pool;
  let clubA: ClubId;
  let clubB: ClubId;
  const players: Record<string, string> = {};

  async function club(slug: string): Promise<ClubId> {
    const { rows } = await owner.query<{ id: ClubId }>(
      `insert into club (slug, name, short_name) values ($1, $1, upper($1)) returning id`,
      [slug],
    );
    return parseClubId(rows[0]?.id);
  }

  async function player(clubId: ClubId, name: string): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(
      `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Pérez', '2008-03-01', 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, name],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('player not created');
    // What the revocation of the location consent queues (trigger consent_location_erasure).
    await owner.query(
      `insert into location_erasure (club_id, player_id, reason, status)
       values ($1, $2, 'consent_revoked', 'pending')`,
      [clubId, id],
    );
    return id;
  }

  beforeAll(async () => {
    if (serverUrl === undefined) return;
    temporary = await createTemporaryDatabase({ serverUrl, prefix: 'sp_worker_location' });
    owner = temporary.pool({ max: 2 });
    const workerLogin = await temporary.login('worker');
    worker = temporary.pool({ connectionString: workerLogin.connectionString, max: 2 });
    clubA = await club('location-a');
    clubB = await club('location-b');
    players.a1 = await player(clubA, 'Juan');
    players.a2 = await player(clubA, 'Pedro');
    players.b1 = await player(clubB, 'Luis');
  }, 120_000);

  afterAll(async () => {
    await worker.end();
    await owner.end();
    await temporary.drop();
  });

  it('lists the clubs with a pending erasure', async () => {
    expect((await listLocationErasureClubs(worker)).sort()).toEqual([clubA, clubB].sort());
  });

  it("completes a club's erasures with the counts only, and records them in the history", async () => {
    const report = await runClubLocationErasures({ pool: worker, logger }, clubA, {
      jobId: 'test-1',
    });
    expect(report).toEqual({ completed: 2, deleted: 0, more: false });
    const { rows } = await owner.query<{
      club_id: string;
      player_id: string;
      status: string;
      deleted_rows: Record<string, number> | null;
      completed: boolean;
    }>(
      `select club_id, player_id, status::text, deleted_rows, completed_at is not null as completed
         from location_erasure order by club_id, player_id`,
    );
    expect(rows.filter((r) => r.club_id === clubA)).toEqual(
      [players.a1, players.a2].sort().map((playerId) => ({
        club_id: clubA,
        player_id: playerId,
        status: 'completed',
        deleted_rows: {},
        completed: true,
      })),
    );
    // Another club's erasure waits for its own job.
    expect(rows.filter((r) => r.club_id === clubB).map((r) => r.status)).toEqual(['pending']);

    const history = await owner.query<{
      player_id: string;
      source: string;
      reason: string;
      request_id: string;
      changed_columns: string[];
    }>(
      `select player_id, source::text, reason, request_id, changed_columns from change_history
        where table_name = 'location_erasure' order by player_id`,
    );
    expect(history.rows).toEqual(
      [players.a1, players.a2].sort().map((playerId) => ({
        player_id: playerId,
        source: 'worker',
        reason: LOCATION_ERASURE_CHANGE_REASON,
        request_id: 'job:test-1',
        changed_columns: ['completed_at', 'deleted_rows', 'status'],
      })),
    );
    expect(await listLocationErasureClubs(worker)).toEqual([clubB]);
  });

  it('a second run of the same club finds nothing to do', async () => {
    expect(await runClubLocationErasures({ pool: worker, logger }, clubA)).toEqual({
      completed: 0,
      deleted: 0,
      more: false,
    });
  });
});
