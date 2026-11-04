import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consent, membership, player, staffAssignment } from './schema/index.js';
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
 * Menarche of a girl (B-805, ADR 0089) through a real login of the API role:
 * the player, her guardian while she is a minor and the assigned medical
 * staff write it, all with a health consent, append-only, only for girls,
 * on the club's day; every one of them, and nobody else, reads it through
 * the logged function, and revoking the health consent hides it from all.
 */

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'no error';
}

interface Entry {
  id: string;
  client_uuid: string;
  player_id: string;
  status: string;
  occurred_on: string | null;
  precision: string | null;
  reported_on: string;
  reported_by: string;
  /** Text, exact to the microsecond (a `Date` would drop them). */
  created_at: string;
  created_by: string | null;
}

const READ = `select id, client_uuid, player_id, status::text, occurred_on::text, precision::text,
                    reported_on::text, reported_by::text, created_at::text, created_by
               from medical.read_menarche_reports($1::uuid[], $2::timestamptz, $3::uuid, $4, $5::uuid[], $6::uuid[])`;

describe.skipIf(!hasDatabase)('menarche in the medical schema (Postgres 16)', () => {
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
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);
  const code = (promise: Promise<unknown>) => pgCode(promise);

  /** Inserts a report as `who`, on the club's day and with its role unless told otherwise. */
  async function report(
    club: ClubFixture,
    who: FixtureUser,
    values: {
      playerId?: string;
      status?: 'not_yet' | 'occurred';
      occurredOn?: string | null;
      precision?: 'day' | 'month' | 'year' | null;
      reportedOn?: string;
      reportedBy?: string;
      clientUuid?: string;
      createdBy?: string;
    } = {},
    extra: TestContext = {},
  ): Promise<string> {
    const id = randomUUID();
    const status = values.status ?? 'not_yet';
    const role = who === 'coachM17' ? 'coach' : who;
    // `reported_by` takes only the roles that may tell it; the rest try as the medical staff.
    const reporter =
      role === 'player' || role === 'parent' || role === 'medical' ? role : 'medical';
    await run(as(club, who, extra), (client) =>
      client.query(
        `insert into medical.menarche_report
           (id, club_id, client_uuid, player_id, status, occurred_on, precision, reported_on,
            reported_by, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6::date, $7, coalesce($8::date, app.club_today()), $9, $10, $10)`,
        [
          id,
          club.clubId,
          values.clientUuid ?? randomUUID(),
          values.playerId ?? club.players.assigned,
          status,
          values.occurredOn ?? null,
          values.precision ?? null,
          values.reportedOn ?? null,
          values.reportedBy ?? reporter,
          values.createdBy ?? club.users[who],
        ],
      ),
    );
    return id;
  }

  async function read(
    context: TestContext,
    params: {
      players?: string[] | null;
      before?: [string, string];
      max?: number;
      clientUuids?: string[];
      ids?: string[];
    } = {},
  ): Promise<Entry[]> {
    return run(context, async (client) => {
      const { rows } = await client.query<Entry>(READ, [
        params.players ?? null,
        params.before?.[0] ?? null,
        params.before?.[1] ?? null,
        params.max ?? 101,
        params.clientUuids ?? null,
        params.ids ?? null,
      ]);
      return rows;
    });
  }

  async function logRows(requestId: string) {
    const { rows } = await t.pool.query<{
      action: string;
      resource: string;
      actor_role: string | null;
      player_id: string | null;
      record_ids: string[];
    }>(
      `select action::text, resource, actor_role, player_id, record_ids
         from medical.access_log where request_id = $1 order by occurred_at, resource`,
      [requestId],
    );
    return rows;
  }

  /** Revokes the health consent of the assigned player (a revocation is final). */
  async function revokeHealthConsent(club: ClubFixture): Promise<void> {
    await t.pool.query(
      `update consent set revoked_at = now(), revoked_by = $3
        where club_id = $1 and player_id = $2 and type = 'health' and revoked_at is null`,
      [club.clubId, club.players.assigned, club.users.parent],
    );
  }

  /** Signs a new health consent for the assigned player. */
  async function signHealthConsent(club: ClubFixture): Promise<void> {
    await t.db.insert(consent).values({
      clubId: club.clubId,
      playerId: club.players.assigned,
      type: 'health',
      documentVersion: '2026-01',
      signerKind: 'guardian',
      signedBy: club.users.parent,
    });
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'menarche-a');
    b = await seedClubFixture(t.db, 'menarche-b');
    for (const club of [a, b]) {
      // The fixture's medical user has no assignment: give it M15 (the assigned player).
      const [row] = await t.db
        .select({ id: membership.id })
        .from(membership)
        .where(and(eq(membership.clubId, club.clubId), eq(membership.userId, club.users.medical)));
      await t.db.insert(staffAssignment).values({
        clubId: club.clubId,
        membershipId: must(row).id,
        categoryId: must(club.rows.category) as never,
        validFrom: '2020-01-01' as never,
      });
      await signHealthConsent(club);
    }
    // Club A's players are girls (born 2011: minors); club B's stay boys.
    await t.db.update(player).set({ sex: 'female' }).where(eq(player.clubId, a.clubId));
    app = await connectAs(t, 'app');
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe('writes', () => {
    it('the player tells it herself, as its author, and the write is logged without values', async () => {
      const requestId = `req-${randomUUID()}`;
      const id = await report(a, 'player', { status: 'not_yet' }, { requestId });
      expect(await logRows(requestId)).toEqual([
        {
          action: 'insert',
          resource: 'menarche_report',
          actor_role: 'player',
          player_id: a.players.assigned,
          record_ids: [id],
        },
      ]);
    });

    it('her guardian (a minor) and the assigned medical staff tell it too', async () => {
      const byParent = await report(a, 'parent', {
        status: 'occurred',
        occurredOn: '2024-03-01',
        precision: 'month',
      });
      const byMedical = await report(a, 'medical', {
        status: 'occurred',
        occurredOn: '2024-03-12',
        precision: 'day',
      });
      const rows = await read(as(a, 'medical'), { ids: [byParent, byMedical] });
      expect(rows.map((r) => [r.id, r.reported_by, r.occurred_on, r.precision])).toEqual([
        [byMedical, 'medical', '2024-03-12', 'day'],
        [byParent, 'parent', '2024-03-01', 'month'],
      ]);
    });

    it('nobody else writes it: coach, S&C, administration, another player or an unassigned medical', async () => {
      for (const who of ['coach', 'sc', 'admin'] as const) {
        expect(await code(report(a, who)), who).toBe('42501');
      }
      // The other player is not the caller's own.
      expect(await code(report(a, 'player', { playerId: a.players.other }))).toBe('42501');
      // Not assigned (M17).
      expect(await code(report(a, 'medical', { playerId: a.players.other }))).toBe('42501');
      // Another club's player.
      expect(await code(report(b, 'medical', { playerId: a.players.assigned }))).toBe('42501');
    });

    it('signs as the acting user, with its validated role, on the club day', async () => {
      expect(await code(report(a, 'player', { createdBy: a.users.parent }))).toBe('42501');
      expect(await code(report(a, 'player', { reportedBy: 'medical' }))).toBe('42501');
      expect(await code(report(a, 'player', { reportedOn: '2020-01-01' }))).toBe('23514');
    });

    it('needs a current health consent for everyone, the medical staff too', async () => {
      await revokeHealthConsent(a);
      try {
        for (const who of ['player', 'parent', 'medical'] as const) {
          expect(await code(report(a, who)), who).toBe('42501');
        }
      } finally {
        await signHealthConsent(a);
      }
    });

    it('is only for girls', async () => {
      expect(await code(report(b, 'medical'))).toBe('23514');
      expect(await code(report(b, 'player'))).toBe('23514');
    });

    it('a date with menarche only, truncated to its precision, not after the report', async () => {
      expect(await code(report(a, 'player', { status: 'occurred' }))).toBe('23514');
      expect(
        await code(
          report(a, 'player', { status: 'not_yet', occurredOn: '2024-03-01', precision: 'month' }),
        ),
      ).toBe('23514');
      expect(
        await code(report(a, 'player', { status: 'occurred', occurredOn: '2024-03-01' })),
      ).toBe('23514');
      expect(
        await code(
          report(a, 'player', { status: 'occurred', occurredOn: '2024-03-05', precision: 'month' }),
        ),
      ).toBe('23514');
      expect(
        await code(
          report(a, 'player', { status: 'occurred', occurredOn: '2024-03-01', precision: 'year' }),
        ),
      ).toBe('23514');
      expect(
        await code(
          report(a, 'player', { status: 'occurred', occurredOn: '2999-01-01', precision: 'year' }),
        ),
      ).toBe('23514');
      expect(
        await code(
          report(a, 'player', { status: 'occurred', occurredOn: '2024-01-01', precision: 'year' }),
        ),
      ).toBe('no error');
    });

    it('is append-only: the API cannot update or delete it, and the owner cannot change it either', async () => {
      const id = await report(a, 'player');
      expect(
        await code(
          run(as(a, 'medical'), (client) =>
            client.query(`update medical.menarche_report set status = 'occurred' where id = $1`, [
              id,
            ]),
          ),
        ),
      ).toBe('42501');
      expect(
        await code(
          run(as(a, 'medical'), (client) =>
            client.query('delete from medical.menarche_report where id = $1', [id]),
          ),
        ),
      ).toBe('42501');
      expect(
        await code(
          t.pool.query(
            `update medical.menarche_report set reported_on = '2020-01-01' where id = $1`,
            [id],
          ),
        ),
      ).toBe('23514');
      // Only the authors go NULL (the account was deleted, ADR 0051).
      expect(
        await code(
          t.pool.query(
            'update medical.menarche_report set created_by = null, updated_by = null where id = $1',
            [id],
          ),
        ),
      ).toBe('no error');
    });
  });

  describe('reads', () => {
    it('the API reads no column of the table directly', async () => {
      expect(
        await code(
          run(as(a, 'medical'), (client) => client.query('select id from medical.menarche_report')),
        ),
      ).toBe('42501');
    });

    it('the player, her guardian and the assigned medical staff read it, newest first, and every read is logged', async () => {
      const clientUuid = randomUUID();
      const id = await report(a, 'player', { clientUuid });
      for (const who of ['player', 'parent', 'medical'] as const) {
        const requestId = `req-${randomUUID()}`;
        const rows = await read(as(a, who, { requestId }), { players: [a.players.assigned] });
        expect(rows[0]?.id, who).toBe(id);
        expect(rows.every((r) => r.player_id === a.players.assigned)).toBe(true);
        const log = await logRows(requestId);
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({
          action: 'read',
          resource: 'menarche_report',
          actor_role: who,
          player_id: a.players.assigned,
        });
        expect(log[0]?.record_ids).toContain(id);
      }
      // A repeated send is found by its client uuid.
      expect((await read(as(a, 'player'), { clientUuids: [clientUuid] })).map((r) => r.id)).toEqual(
        [id],
      );
      expect(await read(as(a, 'player'), { max: 1 })).toHaveLength(1);
    });

    it('pages newest first by (created_at, id)', async () => {
      const older = await report(a, 'player');
      const newer = await report(a, 'player');
      const [first] = await read(as(a, 'medical'), { players: [a.players.assigned], max: 1 });
      expect(first?.id).toBe(newer);
      const next = await read(as(a, 'medical'), {
        players: [a.players.assigned],
        before: [must(first).created_at, must(first).id],
        max: 1,
      });
      expect(next.map((r) => r.id)).toEqual([older]);
      expect(
        await code(
          run(as(a, 'medical'), (client) =>
            client.query(READ, [null, new Date(), null, 101, null, null]),
          ),
        ),
      ).toBe('22023');
    });

    it('the coach, the S&C staff and the administration cannot read it at all', async () => {
      for (const who of ['coach', 'sc', 'admin'] as const) {
        expect(await code(read(as(a, who), { players: [a.players.assigned] })), who).toBe('42501');
      }
    });

    it('without a health consent nobody reads it, the medical staff included', async () => {
      await report(a, 'player');
      await revokeHealthConsent(a);
      try {
        for (const who of ['player', 'parent', 'medical'] as const) {
          expect(await read(as(a, who), { players: [a.players.assigned] }), who).toEqual([]);
        }
      } finally {
        await signHealthConsent(a);
      }
    });

    it('another club sees nothing of it', async () => {
      await report(a, 'player');
      expect(await read(as(b, 'medical'), { players: [a.players.assigned] })).toEqual([]);
      expect(await read(as(b, 'medical'))).toEqual([]);
    });

    it('needs a request id and a valid page size', async () => {
      expect(await code(read(as(a, 'medical', { requestId: null })))).toBe('42501');
      expect(await code(read(as(a, 'medical'), { max: 0 }))).toBe('22023');
      expect(await code(read(as(a, 'medical'), { max: 102 }))).toBe('22023');
    });
  });
});
