import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consent, membership, staffAssignment } from './schema/index.js';
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
import { and, eq } from 'drizzle-orm';

/**
 * Pain reports of the wellness (B-609, ADR 0078) through a real login of the
 * API role: only the player writes their own answer (data and health
 * consents), append-only, with the areas in the same transaction; only the
 * assigned medical staff and the holder read it, always logged; the coach,
 * the S&C staff and the administration never do.
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
  local_date: string;
  has_pain: boolean;
  comment: string | null;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  areas: { region: string; side: string; intensity: number }[];
}

const READ = `select id, client_uuid, player_id, local_date::text, has_pain, comment, reviewed_at,
                    reviewed_by, areas
               from medical.read_pain_reports($1::uuid[], $2::date, $3::date, $4, $5::timestamptz, $6, $7, $8, $9)`;

describe.skipIf(!hasDatabase)('pain reports in the medical schema (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let c: ClubFixture;

  const as = (club: ClubFixture, who: FixtureUser, extra: TestContext = {}): TestContext => ({
    clubId: club.clubId,
    userId: club.users[who],
    role: who === 'coachM17' ? 'coach' : who,
    ...extra,
  });
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);

  async function today(club: ClubFixture): Promise<string> {
    return run(as(club, 'admin'), async (client) => {
      const { rows } = await client.query<{ d: string }>('select app.club_today()::text as d');
      return must(rows[0]).d;
    });
  }

  /** Inserts a report (and its areas) as `who`, in one transaction. Returns its id. */
  async function report(
    club: ClubFixture,
    who: FixtureUser,
    answer: {
      playerId?: string;
      hasPain: boolean;
      areas?: [region: string, side: string, intensity: number][];
      comment?: string | null;
      localDate?: string;
      clientUuid?: string;
      createdBy?: string;
    },
    extra: TestContext = {},
  ): Promise<string> {
    const id = randomUUID();
    const playerId = answer.playerId ?? club.players.assigned;
    const author = answer.createdBy ?? club.users[who];
    await run(as(club, who, extra), async (client) => {
      await client.query(
        `insert into medical.pain_report
           (id, club_id, client_uuid, player_id, local_date, has_pain, comment, created_by, updated_by)
         values ($1, $2, $3, $4, coalesce($5::date, app.club_today()), $6, $7, $8, $8)`,
        [
          id,
          club.clubId,
          answer.clientUuid ?? randomUUID(),
          playerId,
          answer.localDate ?? null,
          answer.hasPain,
          answer.comment ?? null,
          author,
        ],
      );
      for (const [region, side, intensity] of answer.areas ?? []) {
        await client.query(
          `insert into medical.pain_report_area
             (id, club_id, client_uuid, player_id, report_id, body_region, side, intensity, created_by, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
          [randomUUID(), club.clubId, randomUUID(), playerId, id, region, side, intensity, author],
        );
      }
    });
    return id;
  }

  const code = (promise: Promise<unknown>) => pgCode(promise);

  async function read(
    context: TestContext,
    params: {
      players?: string[] | null;
      from?: string | null;
      to?: string | null;
      pending?: boolean;
      before?: [string, string] | null;
      max?: number;
      clientUuids?: string[] | null;
      ids?: string[] | null;
    } = {},
  ): Promise<Entry[]> {
    return run(context, async (client) => {
      const { rows } = await client.query<Entry>(READ, [
        params.players ?? null,
        params.from ?? null,
        params.to ?? null,
        params.pending ?? false,
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
      changed_columns: string[] | null;
    }>(
      `select action::text, resource, actor_role, player_id, record_ids, changed_columns
         from medical.access_log where request_id = $1 order by occurred_at, resource`,
      [requestId],
    );
    return rows;
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'pain-a');
    b = await seedClubFixture(t.db, 'pain-b');
    c = await seedClubFixture(t.db, 'pain-c');
    for (const club of [a, b, c]) {
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
      await t.db.insert(consent).values({
        clubId: club.clubId,
        playerId: club.players.assigned,
        type: 'health',
        documentVersion: '2026-01',
        signerKind: 'guardian',
        signedBy: club.users.parent,
      });
    }
    app = await connectAs(t, 'app');
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe('writes', () => {
    it('the player answers with pain, the areas go in and every row is logged', async () => {
      const requestId = `req-${randomUUID()}`;
      const id = await report(
        a,
        'player',
        {
          hasPain: true,
          areas: [
            ['knee', 'left', 6],
            ['lumbar_spine', 'central', 3],
          ],
          comment: 'Desde el partido del sábado',
        },
        { requestId },
      );
      const log = await logRows(requestId);
      expect(log.map((row) => [row.action, row.resource, row.actor_role, row.player_id])).toEqual([
        ['insert', 'pain_report', 'player', a.players.assigned],
        ['insert', 'pain_report_area', 'player', a.players.assigned],
        ['insert', 'pain_report_area', 'player', a.players.assigned],
      ]);
      expect(log[0]?.record_ids).toEqual([id]);
      expect(JSON.stringify(log)).not.toContain('sábado');
    });

    it('a no answers without areas; append-only, a new answer is another row', async () => {
      const first = await report(a, 'player', { hasPain: false });
      const second = await report(a, 'player', { hasPain: false });
      expect(first).not.toBe(second);
      // Nobody changes the answer: no grant on its columns, not even for the medical staff.
      for (const who of ['player', 'medical'] as const) {
        expect(
          await code(
            run(as(a, who), (client) =>
              client.query('update medical.pain_report set has_pain = true where id = $1', [first]),
            ),
          ),
        ).toBe('42501');
        expect(
          await code(
            run(as(a, who), (client) =>
              client.query('delete from medical.pain_report where id = $1', [first]),
            ),
          ),
        ).toBe('42501');
      }
    });

    it('only the player of the context, as the author, with data and health consents', async () => {
      // Another player of the club (no account of this user).
      expect(await code(report(a, 'player', { playerId: a.players.other, hasPain: false }))).toBe(
        '42501',
      );
      // On behalf of someone else.
      expect(await code(report(a, 'player', { hasPain: false, createdBy: a.users.parent }))).toBe(
        '42501',
      );
      // Nobody else writes it, not even the medical staff or the guardian.
      for (const who of ['parent', 'coach', 'sc', 'medical', 'admin'] as const) {
        expect(await code(report(a, who, { hasPain: false })), who).toBe('42501');
      }
      // Without the health consent.
      await t.pool.query(
        `update consent set revoked_at = now(), revoked_by = $3
          where club_id = $1 and player_id = $2 and type = 'health'`,
        [b.clubId, b.players.assigned, b.users.parent],
      );
      expect(await code(report(b, 'player', { hasPain: false }))).toBe('42501');
    });

    it('checks the answer: areas only with pain, at least one, valid sides and intensities', async () => {
      expect(await code(report(a, 'player', { hasPain: true }))).toBe('23514');
      expect(
        await code(report(a, 'player', { hasPain: false, areas: [['knee', 'left', 2]] })),
      ).toBe('23514');
      expect(await code(report(a, 'player', { hasPain: false, comment: 'nada' }))).toBe('23514');
      for (const area of [
        ['knee', 'central', 2],
        ['neck', 'left', 2],
        ['other', 'central', 2],
        ['knee', 'bilateral', 2],
        ['knee', 'left', 0],
        ['knee', 'left', 11],
      ] as [string, string, number][]) {
        expect(
          await code(report(a, 'player', { hasPain: true, areas: [area] })),
          String(area),
        ).toBe('23514');
      }
      expect(
        await code(
          report(a, 'player', {
            hasPain: true,
            areas: [
              ['knee', 'left', 2],
              ['knee', 'left', 5],
            ],
          }),
        ),
      ).toBe('23505');
      const places: [string, string, number][] = [
        'shoulder',
        'upper_arm',
        'elbow',
        'forearm',
        'wrist_hand',
        'pelvis_hip_groin',
        'thigh_anterior',
      ].flatMap((region) => [
        [region, 'left', 1] as [string, string, number],
        [region, 'right', 1] as [string, string, number],
      ]);
      expect(await code(report(a, 'player', { hasPain: true, areas: places.slice(0, 12) }))).toBe(
        'no error',
      );
      expect(await code(report(a, 'player', { hasPain: true, areas: places.slice(0, 13) }))).toBe(
        '23514',
      );
    });

    it('areas go in only with their report, never later', async () => {
      const id = await report(a, 'player', { hasPain: true, areas: [['ankle', 'right', 4]] });
      const late = run(as(a, 'player'), (client) =>
        client.query(
          `insert into medical.pain_report_area
             (id, club_id, client_uuid, player_id, report_id, body_region, side, intensity, created_by, updated_by)
           values ($1, $2, $3, $4, $5, 'foot', 'right', 2, $6, $6)`,
          [randomUUID(), a.clubId, randomUUID(), a.players.assigned, id, a.users.player],
        ),
      );
      expect(await code(late)).toBe('23514');
    });

    it('the assigned medical staff reviews once, signed by themselves', async () => {
      const id = await report(a, 'player', { hasPain: true, areas: [['foot', 'left', 7]] });
      const review = (who: FixtureUser, by: string, requestId?: string) =>
        run(as(a, who, requestId === undefined ? {} : { requestId }), async (client) => {
          const { rowCount } = await client.query(
            `update medical.pain_report set reviewed_at = now(), reviewed_by = $2, updated_by = $2
              where id = $1`,
            [id, by],
          );
          return rowCount;
        });
      // Not the medical staff: the row is not even found.
      expect(await review('coach', a.users.coach)).toBe(0);
      expect(await review('player', a.users.player)).toBe(0);
      // Nor filtered by a clinical column (that would read it).
      expect(
        await code(
          run(as(a, 'medical'), (client) =>
            client.query(
              'update medical.pain_report set updated_by = $2 where id = $1 and has_pain',
              [id, a.users.medical],
            ),
          ),
        ),
      ).toBe('42501');
      // Signed by someone else.
      expect(await code(review('medical', a.users.admin))).toBe('23514');
      // Dated other than now.
      expect(
        await code(
          run(as(a, 'medical'), (client) =>
            client.query(
              `update medical.pain_report
                  set reviewed_at = now() - interval '3 days', reviewed_by = $2, updated_by = $2
                where id = $1`,
              [id, a.users.medical],
            ),
          ),
        ),
      ).toBe('23514');
      const requestId = `req-${randomUUID()}`;
      expect(await review('medical', a.users.medical, requestId)).toBe(1);
      const [log] = await logRows(requestId);
      expect(log).toMatchObject({
        action: 'update',
        resource: 'pain_report',
        actor_role: 'medical',
      });
      expect(log?.changed_columns).toEqual(['reviewed_at', 'reviewed_by', 'updated_by']);
      // Final.
      expect(
        await code(
          run(as(a, 'medical'), (client) =>
            client.query(
              'update medical.pain_report set reviewed_at = null, reviewed_by = null where id = $1',
              [id],
            ),
          ),
        ),
      ).toBe('23514');
    });

    it('the medical staff of another club does not find the report', async () => {
      const own = await report(a, 'player', { hasPain: false });
      const rowCount = await run(
        as(b, 'medical'),
        async (client) =>
          (
            await client.query(
              `update medical.pain_report set reviewed_at = now(), reviewed_by = $2, updated_by = $2
              where id = $1`,
              [own, b.users.medical],
            )
          ).rowCount,
      );
      expect(rowCount).toBe(0);
    });
  });

  describe('reads', () => {
    it('no connection role reads the tables directly', async () => {
      for (const who of ['player', 'medical', 'admin'] as const) {
        for (const sql of [
          'select * from medical.pain_report',
          'select comment from medical.pain_report',
          'select * from medical.pain_report_area',
          'select id from medical.pain_report_area',
        ]) {
          expect(await code(run(as(a, who), (client) => client.query(sql))), `${who}: ${sql}`).toBe(
            '42501',
          );
        }
      }
    });

    it('the assigned medical staff reads every report with its areas, and the read is logged', async () => {
      const clientUuid = randomUUID();
      const id = await report(a, 'player', {
        hasPain: true,
        areas: [
          ['thigh_posterior', 'right', 8],
          ['knee', 'right', 2],
        ],
        comment: 'Isquio',
        clientUuid,
      });
      const requestId = `req-${randomUUID()}`;
      const rows = await read(as(a, 'medical', { requestId }));
      const entry = rows.find((row) => row.id === id);
      expect(entry).toMatchObject({
        client_uuid: clientUuid,
        player_id: a.players.assigned,
        local_date: await today(a),
        has_pain: true,
        comment: 'Isquio',
        reviewed_at: null,
      });
      // In the order of the vocabulary.
      expect(entry?.areas).toEqual([
        { region: 'thigh_posterior', side: 'right', intensity: 8 },
        { region: 'knee', side: 'right', intensity: 2 },
      ]);
      const log = await logRows(requestId);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        action: 'read',
        resource: 'pain_report',
        actor_role: 'medical',
        player_id: a.players.assigned,
      });
      expect(log[0]?.record_ids).toEqual([...rows.map((row) => row.id)].sort());
    });

    it('filters by client uuid, day, pending and keyset, newest first', async () => {
      const day = await today(a);
      const ids = [];
      for (let i = 0; i < 3; i += 1) ids.push(await report(a, 'player', { hasPain: false }));
      const all = await read(as(a, 'medical'), {
        players: [a.players.assigned],
        from: day,
        to: day,
      });
      // Newest first: the last three answers lead.
      expect(all.slice(0, 3).map((row) => row.id)).toEqual([...ids].reverse());
      const page = await read(as(a, 'medical'), { max: 2 });
      expect(page).toHaveLength(2);
      const rest = await read(as(a, 'medical'), {
        before: [
          must(
            (
              await t.pool.query<{ created_at: string }>(
                // Exact to the microsecond, as the API cursor carries it.
                'select created_at::text as created_at from medical.pain_report where id = $1',
                [must(page[1]).id],
              )
            ).rows[0],
          ).created_at,
          must(page[1]).id,
        ],
      });
      expect(rest.map((row) => row.id)).not.toContain(must(page[0]).id);
      expect(rest.map((row) => row.id)).not.toContain(must(page[1]).id);
      expect(rest.length + 2).toBe(all.length);
      const clientUuid = randomUUID();
      const replayed = await report(a, 'player', { hasPain: false, clientUuid });
      expect(
        (await read(as(a, 'player'), { clientUuids: [clientUuid] })).map((row) => row.id),
      ).toEqual([replayed]);
      expect((await read(as(a, 'medical'), { ids: [replayed] })).map((row) => row.id)).toEqual([
        replayed,
      ]);
      expect(await read(as(a, 'medical'), { from: '2000-01-01', to: '2000-01-02' })).toEqual([]);
      const pending = await read(as(a, 'medical'), { pending: true });
      expect(pending.every((row) => row.reviewed_at === null)).toBe(true);
      expect(await code(read(as(a, 'medical'), { max: 102 }))).toBe('22023');
    });

    it('the holder reads their own with a health consent; the rest of the staff never', async () => {
      const own = await read(as(a, 'player'));
      expect(own.length).toBeGreaterThan(0);
      expect(own.every((row) => row.player_id === a.players.assigned)).toBe(true);
      // The guardian of a minor, too (ADR 0029).
      expect((await read(as(a, 'parent'))).length).toBe(own.length);
      for (const who of ['coach', 'sc', 'admin'] as const) {
        expect(await code(read(as(a, who))), who).toBe('42501');
      }
      // Without a health consent (club B), the holder reads nothing, but the read is logged.
      const requestId = `req-${randomUUID()}`;
      expect(await read(as(b, 'player', { requestId }))).toEqual([]);
      expect(await logRows(requestId)).toHaveLength(1);
    });

    it('isolates clubs: another club never reads, even asking by player id', async () => {
      expect(await read(as(b, 'medical'), { players: [a.players.assigned] })).toEqual([]);
    });

    it('without a request id nothing is read', async () => {
      expect(await code(read(as(a, 'medical', { requestId: null })))).toBe('42501');
    });
  });
  describe('account deletion (ADR 0051)', () => {
    it('the player who answered deletes their account: the reports stay, without an author', async () => {
      const id = await report(c, 'player', {
        hasPain: true,
        areas: [['knee', 'left', 5]],
        comment: 'Molestia al bajar escaleras',
      });
      const playerUser = c.users.player;
      const outcome = await inContext(
        app.pool,
        { clubId: null, userId: playerUser, role: null },
        async (client) =>
          must(
            (
              await client.query<{ outcome: string }>(
                'select outcome from app.delete_own_account(false)',
              )
            ).rows[0],
          ).outcome,
      );
      expect(['deleted', 'anonymized']).toContain(outcome);
      const { rows } = await t.pool.query<{
        has_pain: boolean;
        comment: string | null;
        created_by: string | null;
        updated_by: string | null;
      }>(
        'select has_pain, comment, created_by, updated_by from medical.pain_report where id = $1',
        [id],
      );
      expect(rows).toEqual([
        {
          has_pain: true,
          comment: 'Molestia al bajar escaleras',
          created_by: null,
          updated_by: null,
        },
      ]);
      const areas = await t.pool.query<{ created_by: string | null; intensity: number }>(
        'select created_by, intensity from medical.pain_report_area where report_id = $1',
        [id],
      );
      expect(areas.rows).toEqual([{ created_by: null, intensity: 5 }]);
      // Still append-only: the author is never set to someone else.
      expect(
        await code(
          t.pool.query('update medical.pain_report set created_by = $2 where id = $1', [
            id,
            c.users.admin,
          ]),
        ),
      ).toBe('23514');
    });
  });
});
