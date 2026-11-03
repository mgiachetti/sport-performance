import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { player, playerCategory, testResult, testResultValue } from './schema/index.js';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  inContext,
  must,
  type MigratedTestDatabase,
  type RoleConnection,
  type TestContext,
} from './testing/database.js';
import { seedClubFixture, type ClubFixture, type FixtureUser } from './testing/tenant-fixture.js';

/**
 * `app.percentile_samples` (B-404, ADR 0060) through a real login of the API role. The
 * function is SECURITY DEFINER and returns other minors' test values, so its own guards are
 * the last barrier behind the permission matrix: no guardian, only a subject the caller
 * sees, only within a request, only the subject's club, opaque keys per request, and only
 * valid values of done results.
 */

interface SampleRow {
  player_key: number;
  is_subject: boolean;
  result_key: number;
  metric_code: string;
  age_band_code: string;
  attempt_number: number | null;
  value: number;
}

const SAMPLES_SQL = `select player_key, is_subject, result_key, metric_code, age_band_code,
         attempt_number, value
    from app.percentile_samples($1, array['cmj_height_cm'], '2026-01-01', '2026-12-31')
   order by result_key, attempt_number`;

/** Peers of the assigned player in M15, each with one valid CMJ (enough to shuffle keys). */
const PEER_VALUES = [36, 37, 38, 39, 40, 42];

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'no error';
}

describe.skipIf(!hasDatabase)('app.percentile_samples (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;

  const as = (club: ClubFixture, who: FixtureUser, extra: TestContext = {}): TestContext => ({
    clubId: club.clubId,
    userId: club.users[who],
    role: who === 'coachM17' ? 'coach' : who,
    ...extra,
  });
  const samples = (context: TestContext, subject: string) =>
    inContext(
      app.pool,
      context,
      async (client: pg.PoolClient) => (await client.query<SampleRow>(SAMPLES_SQL, [subject])).rows,
    );

  async function addPeer(club: ClubFixture, value: number): Promise<string> {
    const peer = must(
      (
        await t.db
          .insert(player)
          .values({
            clubId: club.clubId,
            firstName: `Par ${String(value)}`,
            lastName: club.slug,
            birthDate: '2011-03-01' as never,
            sex: 'male',
            sport: 'rugby',
            joinedOn: '2020-01-01' as never,
          })
          .returning({ id: player.id })
      )[0],
    ).id;
    await t.db.insert(playerCategory).values({
      clubId: club.clubId,
      playerId: peer as never,
      categoryId: must(club.rows.category) as never,
      validFrom: '2020-01-01' as never,
    });
    return peer;
  }

  async function addResult(
    club: ClubFixture,
    playerId: string,
    result: {
      status: 'done' | 'not_done';
      values: { attempt: number; value: number; voided?: boolean }[];
    },
  ): Promise<void> {
    const resultId = must(
      (
        await t.db
          .insert(testResult)
          .values({
            clubId: club.clubId,
            playerId: playerId as never,
            testDefinitionId: must(club.rows.test_definition) as never,
            measuredOn: '2026-02-12' as never,
            status: result.status,
            ...(result.status === 'done'
              ? { method: 'video' as const }
              : { notDoneReason: 'absent' as const }),
          })
          .returning({ id: testResult.id })
      )[0],
    ).id;
    for (const entry of result.values) {
      await t.db.insert(testResultValue).values({
        clubId: club.clubId,
        testResultId: resultId,
        metricDefinitionId: must(club.rows.metric_definition) as never,
        attemptNumber: entry.attempt,
        value: entry.value,
        unit: 'cm',
        ...(entry.voided
          ? {
              voidedAt: new Date('2026-02-13T12:00:00Z'),
              voidedBy: club.users.sc,
              voidReason: 'mal medido',
            }
          : {}),
      });
    }
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'samples-a');
    b = await seedClubFixture(t.db, 'samples-b');
    for (const [index, value] of PEER_VALUES.entries()) {
      const peer = await addPeer(a, value);
      await addResult(a, peer, {
        status: 'done',
        // The first peer's second attempt was voided: it never leaves the function.
        values: [
          { attempt: 1, value },
          ...(index === 0 ? [{ attempt: 2, value: 99, voided: true }] : []),
        ],
      });
      if (index === 0) {
        // A result that was not done (with values loaded by mistake) is not a sample either.
        await addResult(a, peer, { status: 'not_done', values: [{ attempt: 1, value: 77 }] });
      }
    }
    // Club B has its own peer: it never shows up in club A.
    await addResult(b, await addPeer(b, 50), {
      status: 'done',
      values: [{ attempt: 1, value: 50 }],
    });
    app = await connectAs(t, 'app');
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  it('gives the staff of the subject the valid values of done results, with the subject marked', async () => {
    for (const who of ['coach', 'sc', 'admin', 'player'] as const) {
      const rows = await samples(as(a, who), a.players.assigned);
      expect(
        rows.map((row) => row.value).sort((x, y) => x - y),
        who,
      ).toEqual([...PEER_VALUES, 41.5].sort((x, y) => x - y));
      expect(
        rows.every((row) => row.metric_code === 'cmj_height_cm' && row.age_band_code === 'm15'),
      ).toBe(true);
      // Voided values and results that are not done are excluded.
      expect(rows.some((row) => row.value === 99 || row.value === 77)).toBe(false);
      // Only the subject's own rows are marked.
      expect(rows.filter((row) => row.is_subject).map((row) => row.value)).toEqual([41.5]);
      // One key per player, one per result: no ids leave the function.
      expect(new Set(rows.map((row) => row.player_key)).size).toBe(PEER_VALUES.length + 1);
    }
    const all = await inContext(app.pool, as(a, 'coach'), async (client) =>
      client.query(
        `select * from app.percentile_samples($1, array['cmj_height_cm'], '2026-01-01', '2026-12-31')`,
        [a.players.assigned],
      ),
    );
    // Only the window's id: no player nor result ids leave the function.
    expect(all.fields.map((f) => f.name).filter((name) => name.endsWith('_id'))).toEqual([
      'test_window_id',
    ]);
  });

  it('gives only the subject rows with only_subject', async () => {
    const rows = await inContext(app.pool, as(a, 'coach'), async (client) =>
      client.query<{ is_subject: boolean; value: number }>(
        `select is_subject, value from app.percentile_samples(
           $1, array['cmj_height_cm'], '1900-01-01', '2026-12-31', null, null, true)`,
        [a.players.assigned],
      ),
    );
    expect(rows.rows).toEqual([{ is_subject: true, value: 41.5 }]);
    // The guards still apply.
    expect(
      await pgCode(
        inContext(app.pool, as(a, 'parent'), (client) =>
          client.query(
            `select * from app.percentile_samples(
               $1, array['cmj_height_cm'], '2026-01-01', '2026-12-31', null, null, true)`,
            [a.players.assigned],
          ),
        ),
      ),
    ).toBe('42501');
  });

  it('numbers the players with keys that change on every request', async () => {
    const keysOf = async (requestId: string) => {
      const rows = await samples(as(a, 'coach', { requestId }), a.players.assigned);
      // result_key is stable inside the call; the player key of each result is what moves.
      return rows.map((row) => `${String(row.result_key)}:${String(row.player_key)}`).join(',');
    };
    const fixed = `req-${randomUUID()}`;
    expect(await keysOf(fixed)).toBe(await keysOf(fixed));
    const assignments = new Set<string>();
    for (let i = 0; i < 6; i += 1) {
      assignments.add(await keysOf(`req-${randomUUID()}`));
    }
    expect(assignments.size).toBeGreaterThan(1);
  });

  it('refuses a guardian, even of the subject', async () => {
    expect(await pgCode(samples(as(a, 'parent'), a.players.assigned))).toBe('42501');
  });

  it('refuses a coach whose assignment does not cover the subject', async () => {
    // coachM17 is assigned to M17; the assigned player is M15.
    expect(await pgCode(samples(as(a, 'coachM17'), a.players.assigned))).toBe('42501');
    // coach is assigned to M15; the other player is M17.
    expect(await pgCode(samples(as(a, 'coach'), a.players.other))).toBe('42501');
  });

  it("refuses a player asking for another player's comparison", async () => {
    expect(await pgCode(samples(as(a, 'player'), a.players.other))).toBe('42501');
  });

  it('refuses to run outside a request', async () => {
    expect(await pgCode(samples(as(a, 'coach', { requestId: null }), a.players.assigned))).toBe(
      '42501',
    );
    expect(
      await pgCode(
        samples({ clubId: a.clubId, userId: a.users.admin, role: null }, a.players.assigned),
      ),
    ).toBe('42501');
  });

  it('gives nothing for a subject of another club', async () => {
    expect(await samples(as(a, 'admin'), b.players.assigned)).toEqual([]);
    expect(await pgCode(samples(as(a, 'coach'), b.players.assigned))).toBe('42501');
  });

  it('rejects an invalid range of days', async () => {
    expect(
      await pgCode(
        inContext(app.pool, as(a, 'coach'), (client) =>
          client.query(
            `select * from app.percentile_samples($1, array['cmj_height_cm'], '2026-12-31', '2026-01-01')`,
            [a.players.assigned],
          ),
        ),
      ),
    ).toBe('22023');
  });
});
