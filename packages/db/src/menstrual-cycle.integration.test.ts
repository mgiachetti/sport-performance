import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { club, consent, membership, player, staffAssignment } from './schema/index.js';
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
 * Menstrual cycle tracking (B-806, ADR 0087) through a real login of the API
 * role: three keys (the club's module, the `data` + `health` +
 * `menstrual_cycle` consents and the player's own opt-in), only the player
 * writes, she reads all of hers, and beyond her only the assigned `medical` or
 * `sc` members she authorized, while every key holds. Never the coach, the
 * administration or the guardian. Every read and write is logged.
 */

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'no error';
}

interface LogEntry {
  id: string;
  player_id: string;
  local_date: string;
  flow: string;
  symptoms: string[];
  note: string | null;
}

describe.skipIf(!hasDatabase)('menstrual cycle in the medical schema (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  const memberships: Record<string, Partial<Record<FixtureUser, string>>> = {};

  const as = (fixture: ClubFixture, who: FixtureUser, extra: TestContext = {}): TestContext => ({
    clubId: fixture.clubId,
    userId: fixture.users[who],
    role: who === 'coachM17' ? 'coach' : who,
    ...extra,
  });
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);
  const code = (promise: Promise<unknown>) => pgCode(promise);
  const membershipOf = (fixture: ClubFixture, who: FixtureUser) =>
    must(memberships[fixture.clubId]?.[who]);

  async function setModule(fixture: ClubFixture, on: boolean) {
    await t.db
      .update(club)
      .set({ settings: { modules: { menstrual_cycle: on } } as never })
      .where(eq(club.id, fixture.clubId));
  }

  async function enroll(
    fixture: ClubFixture,
    who: FixtureUser = 'player',
    extra: TestContext = {},
  ) {
    const id = randomUUID();
    await run(as(fixture, who, extra), (client) =>
      client.query(
        `insert into medical.menstrual_cycle_enrollment (id, club_id, player_id, created_by, updated_by)
         values ($1, $2, $3, $4, $4)`,
        [id, fixture.clubId, fixture.players.assigned, fixture.users[who]],
      ),
    );
    return id;
  }

  async function logDay(
    fixture: ClubFixture,
    day: { flow: string; symptoms?: string[]; note?: string | null; localDate?: string },
    who: FixtureUser = 'player',
    extra: TestContext = {},
  ) {
    const id = randomUUID();
    await run(as(fixture, who, extra), (client) =>
      client.query(
        `insert into medical.menstrual_cycle_log
           (id, club_id, client_uuid, player_id, local_date, flow, symptoms, note, created_by, updated_by)
         values ($1, $2, $3, $4, coalesce($5::date, app.club_today()), $6, $7::medical.menstrual_symptom[], $8, $9, $9)`,
        [
          id,
          fixture.clubId,
          randomUUID(),
          fixture.players.assigned,
          day.localDate ?? null,
          day.flow,
          day.symptoms ?? [],
          day.note ?? null,
          fixture.users[who],
        ],
      ),
    );
    return id;
  }

  async function share(fixture: ClubFixture, viewer: FixtureUser, extra: TestContext = {}) {
    const id = randomUUID();
    await run(as(fixture, 'player', extra), (client) =>
      client.query(
        `insert into medical.menstrual_cycle_share
           (id, club_id, player_id, viewer_membership_id, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $5)`,
        [
          id,
          fixture.clubId,
          fixture.players.assigned,
          membershipOf(fixture, viewer),
          fixture.users.player,
        ],
      ),
    );
    return id;
  }

  async function readLogs(context: TestContext, players: string[] | null = null) {
    return run(context, async (client) => {
      const { rows } = await client.query<LogEntry>(
        `select id, player_id, local_date::text, flow, symptoms, note
           from medical.read_menstrual_cycle_logs($1::uuid[])`,
        [players],
      );
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

  async function signConsent(fixture: ClubFixture, type: string) {
    await t.pool.query(
      `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
       values ($1, $2, $3::consent_type, '2026-11', 'guardian', $4)`,
      [fixture.clubId, fixture.players.assigned, type, fixture.users.parent],
    );
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'cycle-a');
    b = await seedClubFixture(t.db, 'cycle-b');
    for (const fixture of [a, b]) {
      const rows = await t.db
        .select({ id: membership.id, userId: membership.userId })
        .from(membership)
        .where(eq(membership.clubId, fixture.clubId));
      memberships[fixture.clubId] = Object.fromEntries(
        Object.entries(fixture.users).map(([who, userId]) => [
          who,
          rows.find((row) => row.userId === userId)?.id,
        ]),
      );
      // The fixture's medical user has no assignment: give it M15 (the assigned player).
      await t.db.insert(staffAssignment).values({
        clubId: fixture.clubId,
        membershipId: membershipOf(fixture, 'medical') as never,
        categoryId: must(fixture.rows.category) as never,
        validFrom: '2020-01-01' as never,
      });
      await t.db
        .update(player)
        .set({ sex: 'female' })
        .where(and(eq(player.clubId, fixture.clubId), eq(player.id, fixture.players.assigned)));
      await t.db.insert(consent).values(
        (['data', 'health'] as const).map((type) => ({
          clubId: fixture.clubId,
          playerId: fixture.players.assigned,
          type,
          documentVersion: '2026-01',
          signerKind: 'guardian' as const,
          signedBy: fixture.users.parent,
        })),
      );
    }
    app = await connectAs(t, 'app');
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe('opt-in', () => {
    it('needs the module, the specific consent and the player herself', async () => {
      // Module off (the default) and no specific consent.
      expect(await code(enroll(a))).toBe('42501');
      await setModule(a, true);
      expect(await code(enroll(a))).toBe('42501');
      await signConsent(a, 'menstrual_cycle');
      // Nobody but the player turns it on: not the guardian who signed, not the staff.
      for (const who of ['parent', 'coach', 'sc', 'medical', 'admin'] as const) {
        expect(await code(enroll(a, who)), who).toBe('42501');
      }
      const requestId = `req-${randomUUID()}`;
      const id = await enroll(a, 'player', { requestId });
      expect(await logRows(requestId)).toEqual([
        expect.objectContaining({
          action: 'insert',
          resource: 'menstrual_cycle_enrollment',
          actor_role: 'player',
          player_id: a.players.assigned,
          record_ids: [id],
        }),
      ]);
      // One opt-in at a time.
      expect(await code(enroll(a))).toBe('23505');
    });

    it('only for a female player', async () => {
      await setModule(b, true);
      await signConsent(b, 'menstrual_cycle');
      await t.db
        .update(player)
        .set({ sex: 'male' })
        .where(and(eq(player.clubId, b.clubId), eq(player.id, b.players.assigned)));
      expect(await code(enroll(b))).toBe('42501');
      await t.db
        .update(player)
        .set({ sex: 'female' })
        .where(and(eq(player.clubId, b.clubId), eq(player.id, b.players.assigned)));
      expect(await code(enroll(b))).toBe('no error');
    });
  });

  describe('days', () => {
    it('the player logs her days, append-only, and the write is logged without values', async () => {
      const requestId = `req-${randomUUID()}`;
      const id = await logDay(
        a,
        { flow: 'heavy', symptoms: ['cramps', 'fatigue'], note: 'Dolor fuerte a la mañana' },
        'player',
        { requestId },
      );
      const log = await logRows(requestId);
      expect(log).toEqual([
        expect.objectContaining({
          action: 'insert',
          resource: 'menstrual_cycle_log',
          record_ids: [id],
        }),
      ]);
      expect(JSON.stringify(log)).not.toContain('mañana');
      for (const sql of [
        'update medical.menstrual_cycle_log set flow = $2 where id = $1',
        'delete from medical.menstrual_cycle_log where id = $1 and $2::text is not null',
      ]) {
        expect(
          await code(run(as(a, 'player'), (client) => client.query(sql, [id, 'light']))),
          sql,
        ).toBe('42501');
      }
    });

    it('checks the day: each symptom once, a short non-blank note', async () => {
      expect(await code(logDay(a, { flow: 'light', symptoms: ['cramps', 'cramps'] }))).toBe(
        '23514',
      );
      expect(await code(logDay(a, { flow: 'light', note: '  ' }))).toBe('23514');
      expect(await code(logDay(a, { flow: 'light', note: 'x'.repeat(281) }))).toBe('23514');
      expect(await code(logDay(a, { flow: 'clots' }))).toBe('22P02');
    });

    it('nobody else logs a day, and not without the opt-in', async () => {
      for (const who of ['parent', 'coach', 'sc', 'medical', 'admin'] as const) {
        expect(await code(logDay(a, { flow: 'none' }, who)), who).toBe('42501');
      }
    });
  });

  describe('authorizations and reads', () => {
    it('the player lists whom she may authorize: the assigned medical and S&C members', async () => {
      const candidates = await run(as(a, 'player'), async (client) => {
        const { rows } = await client.query<{ membership_id: string; role: string }>(
          'select membership_id, role from medical.menstrual_cycle_viewer_candidates($1)',
          [a.players.assigned],
        );
        return rows;
      });
      expect(candidates.map((row) => row.membership_id).sort()).toEqual(
        [membershipOf(a, 'medical'), membershipOf(a, 'sc')].sort(),
      );
      // Only the player asks.
      expect(
        await code(
          run(as(a, 'medical'), (client) =>
            client.query('select * from medical.menstrual_cycle_viewer_candidates($1)', [
              a.players.assigned,
            ]),
          ),
        ),
      ).toBe('42501');
    });

    it('the player reads all of hers; the staff nothing until she authorizes them', async () => {
      const own = await readLogs(as(a, 'player'));
      expect(own.length).toBeGreaterThan(0);
      expect(own[0]).toMatchObject({ flow: 'heavy', symptoms: ['cramps', 'fatigue'] });
      expect(await readLogs(as(a, 'medical'))).toEqual([]);
      expect(await readLogs(as(a, 'sc'))).toEqual([]);
      for (const who of ['coach', 'admin', 'parent'] as const) {
        expect(await code(readLogs(as(a, who))), who).toBe('42501');
      }
    });

    it('an authorization goes only to an assigned medical or S&C member', async () => {
      for (const who of ['coach', 'admin', 'parent', 'coachM17'] as const) {
        expect(await code(share(a, who)), who).toBe('23514');
      }
      // A member of another club is never one of hers.
      expect(
        await code(
          run(as(a, 'player'), (client) =>
            client.query(
              `insert into medical.menstrual_cycle_share
                 (id, club_id, player_id, viewer_membership_id, created_by, updated_by)
               values ($1, $2, $3, $4, $5, $5)`,
              [
                randomUUID(),
                a.clubId,
                a.players.assigned,
                membershipOf(b, 'medical'),
                a.users.player,
              ],
            ),
          ),
        ),
      ).toBe('23514');
      // Only the player authorizes.
      expect(
        await code(
          run(as(a, 'parent'), (client) =>
            client.query(
              `insert into medical.menstrual_cycle_share
                 (id, club_id, player_id, viewer_membership_id, created_by, updated_by)
               values ($1, $2, $3, $4, $5, $5)`,
              [
                randomUUID(),
                a.clubId,
                a.players.assigned,
                membershipOf(a, 'medical'),
                a.users.parent,
              ],
            ),
          ),
        ),
      ).toBe('42501');
    });

    it('the authorized member reads, logged; the other one still does not', async () => {
      const shareId = await share(a, 'medical');
      expect(await code(share(a, 'medical'))).toBe('23505');
      const requestId = `req-${randomUUID()}`;
      const rows = await readLogs(as(a, 'medical', { requestId }));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.player_id === a.players.assigned)).toBe(true);
      expect(await logRows(requestId)).toEqual([
        expect.objectContaining({
          action: 'read',
          resource: 'menstrual_cycle_log',
          actor_role: 'medical',
          player_id: a.players.assigned,
        }),
      ]);
      expect(await readLogs(as(a, 'sc'))).toEqual([]);
      const shared = await run(as(a, 'medical'), async (client) => {
        const { rows: list } = await client.query<{ player_id: string; share_id: string }>(
          'select player_id, share_id from medical.menstrual_cycle_shared_with_me()',
        );
        return list;
      });
      expect(shared).toEqual([{ player_id: a.players.assigned, share_id: shareId }]);
      // The player sees whom she authorized, with the role and the name.
      const shares = await run(as(a, 'player'), async (client) => {
        const { rows: list } = await client.query<{ viewer_role: string; viewer_name: string }>(
          'select viewer_role, viewer_name from medical.read_menstrual_cycle_shares($1)',
          [[a.players.assigned]],
        );
        return list;
      });
      expect(shares).toEqual([{ viewer_role: 'medical', viewer_name: 'medical cycle-a' }]);
    });

    it('another club never reads, even asking by player id', async () => {
      expect(await readLogs(as(b, 'medical'), [a.players.assigned])).toEqual([]);
      expect(await readLogs(as(b, 'player'), [a.players.assigned])).toEqual([]);
    });

    it('a revoked consent, the module off or a revoked authorization stop the reads', async () => {
      await setModule(a, false);
      expect(await readLogs(as(a, 'medical'))).toEqual([]);
      // The player still reads hers.
      expect((await readLogs(as(a, 'player'))).length).toBeGreaterThan(0);
      await setModule(a, true);
      expect((await readLogs(as(a, 'medical'))).length).toBeGreaterThan(0);

      await t.pool.query(
        `update consent set revoked_at = now(), revoked_by = $3
          where club_id = $1 and player_id = $2 and type::text = 'menstrual_cycle'`,
        [a.clubId, a.players.assigned, a.users.parent],
      );
      expect(await readLogs(as(a, 'medical'))).toEqual([]);
      // Nor does she log without it.
      expect(await code(logDay(a, { flow: 'none' }))).toBe('42501');
      await signConsent(a, 'menstrual_cycle');
      expect((await readLogs(as(a, 'medical'))).length).toBeGreaterThan(0);

      const scShare = await share(a, 'sc');
      expect((await readLogs(as(a, 'sc'))).length).toBeGreaterThan(0);
      // Only the player revokes, once, signed by herself, now.
      const revoke = (who: FixtureUser, by: string, at = 'now()') =>
        run(as(a, who), async (client) => {
          const { rowCount } = await client.query(
            `update medical.menstrual_cycle_share
                set revoked_at = ${at}, revoked_by = $2, updated_by = $3 where id = $1`,
            [scShare, by, a.users[who]],
          );
          return rowCount;
        });
      expect(await revoke('sc', a.users.sc)).toBe(0);
      expect(await code(revoke('player', a.users.admin))).toBe('23514');
      expect(await code(revoke('player', a.users.player, "now() - interval '1 day'"))).toBe(
        '23514',
      );
      expect(await revoke('player', a.users.player)).toBe(1);
      expect(await code(revoke('player', a.users.player))).toBe('23514');
      expect(await readLogs(as(a, 'sc'))).toEqual([]);
    });

    it('turning it off revokes every authorization; on again starts with nobody', async () => {
      const [enrollment] = await run(as(a, 'player'), async (client) => {
        const { rows } = await client.query<{ id: string }>(
          'select id from medical.read_menstrual_cycle_enrollments($1) where ended_at is null',
          [[a.players.assigned]],
        );
        return rows;
      });
      const end = (who: FixtureUser) =>
        run(as(a, who), async (client) => {
          const { rowCount } = await client.query(
            `update medical.menstrual_cycle_enrollment
                set ended_at = now(), ended_by = $2, updated_by = $2 where id = $1`,
            [must(enrollment).id, a.users[who]],
          );
          return rowCount;
        });
      expect(await end('medical')).toBe(0);
      expect(await end('parent')).toBe(0);
      expect(await end('player')).toBe(1);
      expect(await code(end('player'))).toBe('23514');
      expect(await readLogs(as(a, 'medical'))).toEqual([]);
      expect(await code(logDay(a, { flow: 'none' }))).toBe('42501');
      await enroll(a);
      expect(await readLogs(as(a, 'medical'))).toEqual([]);
      const active = await run(as(a, 'player'), async (client) => {
        const { rows } = await client.query(
          'select * from medical.read_menstrual_cycle_shares($1)',
          [[a.players.assigned]],
        );
        return rows;
      });
      expect(active).toEqual([]);
    });

    it('no connection role reads the tables directly, and nothing is read without a request', async () => {
      for (const who of ['player', 'medical', 'admin'] as const) {
        for (const sql of [
          'select * from medical.menstrual_cycle_log',
          'select id from medical.menstrual_cycle_log',
          'select player_id from medical.menstrual_cycle_enrollment',
          'select viewer_membership_id from medical.menstrual_cycle_share',
        ]) {
          expect(await code(run(as(a, who), (client) => client.query(sql))), `${who}: ${sql}`).toBe(
            '42501',
          );
        }
      }
      expect(await code(readLogs(as(a, 'player', { requestId: null })))).toBe('42501');
    });
  });
});
