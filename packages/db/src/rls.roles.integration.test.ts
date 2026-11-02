import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CategoryId } from '@sport-performance/domain';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';
import { assertConnectionRole, DatabaseRoleError, provisionLoginRole } from './roles.js';
import { authSchema, invitation, invitationCategory, membership, user } from './schema/index.js';
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
 * What each role sees and writes inside its own club (ADR 0026), the
 * validation of the claimed role, superadmin, the worker and Better Auth's
 * role. Isolation between clubs is in `rls.isolation.integration.test.ts`.
 */

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    // Drizzle wraps the driver error in `cause`.
    const failure = error as { code?: string; cause?: { code?: string } };
    return failure.code ?? failure.cause?.code;
  }
  return 'no error';
}

describe.skipIf(!hasDatabase)('RLS by role (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let superadminId: string;

  const as = (who: FixtureUser, role: string = roleOf(who)): TestContext => ({
    clubId: a.clubId,
    userId: a.users[who],
    role,
  });
  function roleOf(who: FixtureUser): string {
    return who === 'coachM17' ? 'coach' : who;
  }

  function run<T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) {
    return inContext(app.pool, context, work);
  }
  async function ids(context: TestContext, sql: string, params: unknown[] = []) {
    return run(context, async (client) => {
      const { rows } = await client.query<{ id: string }>(sql, params);
      return rows.map((r) => r.id).sort();
    });
  }
  const players = (context: TestContext) => ids(context, 'select id from player');
  const wellnessPlayers = (context: TestContext) =>
    ids(context, 'select player_id as id from wellness');

  function wellnessFor(playerId: string, localDate: string) {
    return (client: pg.ClientBase) =>
      client.query(
        `insert into wellness (club_id, player_id, local_date, item_count, sleep, fatigue, soreness)
         values ($1, $2, $3, 3, 4, 4, 4)`,
        [a.clubId, playerId, localDate],
      );
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'roles-a');
    b = await seedClubFixture(t.db, 'roles-b');
    superadminId = must(
      (
        await t.db
          .insert(user)
          .values({ name: 'Soporte', email: 'soporte@example.com', isSuperadmin: true })
          .returning({ id: user.id })
      )[0],
    ).id;
    app = await connectAs(t, 'app');
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe('the claimed role must be backed by the database', () => {
    it('admin sees every player of the club', async () => {
      expect(await players(as('admin'))).toEqual([a.players.assigned, a.players.other].sort());
    });

    it('a role without a matching active membership grants nothing', async () => {
      // A coach claiming admin, a player claiming coach, an unknown role.
      for (const context of [as('coach', 'admin'), as('player', 'coach'), as('admin', 'owner')]) {
        expect(await players(context)).toEqual([]);
        expect(await ids(context, 'select id from category')).toEqual([]);
      }
      // A member of club A claiming a role in club B.
      expect(await players({ ...as('admin'), clubId: b.clubId })).toEqual([]);
    });

    it('an ended membership grants nothing', async () => {
      const [ended] = await t.db
        .insert(user)
        .values({ name: 'Ex', email: 'ex@roles-a.example.com' })
        .returning({ id: user.id });
      await t.db.insert(membership).values({
        clubId: a.clubId,
        userId: must(ended).id,
        role: 'admin',
        startedAt: new Date('2024-01-01T00:00:00Z'),
        endedAt: new Date('2025-01-01T00:00:00Z'),
      });
      expect(await players({ clubId: a.clubId, userId: must(ended).id, role: 'admin' })).toEqual(
        [],
      );
    });

    it('rejects a malformed club id with an error, never a match', async () => {
      expect(await pgCode(players({ ...as('admin'), clubId: 'not-a-uuid' }))).toBe('22P02');
    });
  });

  describe('scoped roles', () => {
    it('player: only their own player, wellness and results', async () => {
      const context = as('player');
      expect(await players(context)).toEqual([a.players.assigned]);
      expect(await wellnessPlayers(context)).toEqual([a.players.assigned]);
      expect(await ids(context, 'select player_id as id from test_result')).toEqual([
        a.players.assigned,
      ]);
      expect(await ids(context, 'select id from test_result_value')).toEqual([
        must(a.rows.test_result_value),
      ]);
      // Catalogs are shared; staff tools are not.
      expect(await ids(context, 'select id from metric_definition')).toHaveLength(1);
      expect(await ids(context, 'select id from device')).toEqual([]);
      expect(await ids(context, 'select id from alert')).toEqual([]);
      expect(await ids(context, 'select user_id as id from membership')).toEqual([a.users.player]);
      expect(await ids(context, 'select id from "user"')).toEqual([a.users.player]);
    });

    it('player: reports their own wellness, never someone else’s, and cannot write tests', async () => {
      const context = as('player');
      await run(context, wellnessFor(a.players.assigned, '2026-03-12'));
      expect(await pgCode(run(context, wellnessFor(a.players.other, '2026-03-12')))).toBe('42501');
      const changed = await run(context, (client) =>
        client.query(`update test_result set notes = 'x' where player_id = $1`, [
          a.players.assigned,
        ]),
      );
      expect(changed.rowCount).toBe(0);
    });

    it('parent: only their child, signs consents as themselves', async () => {
      const context = as('parent');
      expect(await players(context)).toEqual([a.players.assigned]);
      expect(await pgCode(run(context, wellnessFor(a.players.assigned, '2026-03-13')))).toBe(
        '42501',
      );
      const sign = (signedBy: string, playerId: string) => (client: pg.ClientBase) =>
        client.query(
          `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
           values ($1, $2, 'image', '2026-01', 'guardian', $3)`,
          [a.clubId, playerId, signedBy],
        );
      await run(context, sign(a.users.parent, a.players.assigned));
      expect(await pgCode(run(context, sign(a.users.admin, a.players.assigned)))).toBe('42501');
      expect(await pgCode(run(context, sign(a.users.parent, a.players.other)))).toBe('42501');
    });

    it('coach: the players of their assigned categories only', async () => {
      expect(await players(as('coach'))).toEqual([a.players.assigned]);
      expect(await players(as('coachM17'))).toEqual([a.players.other]);
      expect(await wellnessPlayers(as('coachM17'))).toEqual([a.players.other]);
      // Club catalogs and the staff's names are visible to every staff member.
      expect(await ids(as('coach'), 'select id from category')).toHaveLength(2);
      const users = await ids(as('coach'), 'select id from "user"');
      expect(users).toEqual(expect.arrayContaining(Object.values(a.users)));
      expect(users).not.toEqual(expect.arrayContaining([b.users.admin]));
      expect(users).not.toContain(superadminId);
    });

    it('coach: plans sessions and drills, cannot manage people or tests', async () => {
      const context = as('coach');
      const sessionId = randomUUID();
      await run(context, async (client) => {
        await client.query(
          `insert into training_session (id, club_id, sport, kind, starts_at, local_date)
           values ($1, $2, 'rugby', 'training', now(), '2026-04-01')`,
          [sessionId, a.clubId],
        );
        await client.query(
          `insert into drill (club_id, training_session_id, name) values ($1, $2, 'Contacto')`,
          [a.clubId, sessionId],
        );
        const deleted = await client.query(
          'delete from drill where club_id = $1 and training_session_id = $2',
          [a.clubId, sessionId],
        );
        expect(deleted.rowCount).toBe(1);
      });
      expect(
        await pgCode(
          run(context, (client) =>
            client.query(
              `insert into membership (club_id, user_id, role) values ($1, $2, 'admin')`,
              [a.clubId, a.users.coach],
            ),
          ),
        ),
      ).toBe('42501');
      expect(
        await pgCode(
          run(context, (client) =>
            client.query(`delete from training_session where id = $1`, [sessionId]),
          ),
        ),
      ).toBe('42501');
    });

    it('sc assigned to the sport sees every category of it', async () => {
      expect(await players(as('sc'))).toEqual([a.players.assigned, a.players.other].sort());
    });

    it('an assignment that is no longer valid grants nothing', async () => {
      const [coach] = await t.db
        .insert(user)
        .values({ name: 'Coach viejo', email: 'old-coach@roles-a.example.com' })
        .returning({ id: user.id });
      const [m] = await t.db
        .insert(membership)
        .values({ clubId: a.clubId, userId: must(coach).id, role: 'coach' })
        .returning({ id: membership.id });
      await t.pool.query(
        `insert into staff_assignment (club_id, membership_id, sport, valid_from, valid_to)
         values ($1, $2, 'rugby', '2020-01-01', '2021-01-01')`,
        [a.clubId, must(m).id],
      );
      expect(await players({ clubId: a.clubId, userId: must(coach).id, role: 'coach' })).toEqual(
        [],
      );
    });

    it('medical without an assignment sees no players, but the staff tools', async () => {
      expect(await players(as('medical'))).toEqual([]);
      expect(await ids(as('medical'), 'select id from device')).toHaveLength(1);
    });

    it('admin manages memberships', async () => {
      const [person] = await t.db
        .insert(user)
        .values({ name: 'Nueva', email: 'nueva@roles-a.example.com' })
        .returning({ id: user.id });
      await run(as('admin'), (client) =>
        client.query(`insert into membership (club_id, user_id, role) values ($1, $2, 'coach')`, [
          a.clubId,
          must(person).id,
        ]),
      );
    });
  });

  describe('append-only and identity columns', () => {
    it('nobody deletes test_result_value', async () => {
      expect(
        await pgCode(
          run(as('admin'), (client) =>
            client.query('delete from test_result_value where id = $1', [
              must(a.rows.test_result_value),
            ]),
          ),
        ),
      ).toBe('42501');
    });

    it('identity and audit columns are not updatable', async () => {
      for (const column of ['id', 'club_id', 'created_at', 'created_by', 'client_uuid']) {
        expect(
          await pgCode(
            run(as('admin'), (client) =>
              client.query(`update player set ${column} = ${column} where id = $1`, [
                a.players.assigned,
              ]),
            ),
          ),
          column,
        ).toBe('42501');
      }
    });
  });

  describe('without a club in the context', () => {
    it('a user sees their memberships of every club and those clubs, nothing else', async () => {
      // The admin of A is also a parent in B.
      await t.db
        .insert(membership)
        .values({ clubId: b.clubId, userId: a.users.admin, role: 'parent' });
      const context = { userId: a.users.admin };
      expect(await ids(context, 'select club_id as id from membership')).toEqual(
        [a.clubId, b.clubId].sort(),
      );
      expect(await ids(context, 'select id from club')).toEqual([a.clubId, b.clubId].sort());
      expect(await players(context)).toEqual([]);
      expect(await ids(context, 'select id from category')).toEqual([]);
    });

    it('a superadmin lists and creates clubs, but sees no club data', async () => {
      const context = { userId: superadminId, supportReason: 'Alta de club' };
      expect(await ids(context, 'select id from club')).toEqual(
        expect.arrayContaining([a.clubId, b.clubId]),
      );
      expect(await players(context)).toEqual([]);
      await run(context, (client) =>
        client.query(
          `insert into club (slug, name, short_name) values ('nuevo-club', 'Nuevo club', 'NC')`,
        ),
      );
      // A regular user cannot.
      expect(
        await pgCode(
          run({ userId: a.users.admin }, (client) =>
            client.query(
              `insert into club (slug, name, short_name) values ('otro-club', 'Otro club', 'OC')`,
            ),
          ),
        ),
      ).toBe('42501');
    });
  });

  describe('invitations (B-309, ADR 0028)', () => {
    const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
    const DAY_MS = 24 * 60 * 60 * 1000;

    /** A pending invitation of club A written as the owner; returns its token hash. */
    async function invite(email: string, role: 'coach' | 'player', categoryId?: string) {
      const tokenHash = sha256(`token-${randomUUID()}`);
      const [row] = await t.db
        .insert(invitation)
        .values({
          clubId: a.clubId,
          email,
          role,
          tokenHash,
          expiresAt: new Date(Date.now() + 7 * DAY_MS),
          createdBy: a.users.admin,
        })
        .returning({ id: invitation.id });
      if (categoryId !== undefined) {
        await t.db.insert(invitationCategory).values({
          clubId: a.clubId,
          invitationId: must(row).id,
          categoryId: categoryId as CategoryId,
        });
      }
      return tokenHash;
    }

    async function newUser(email: string) {
      const [row] = await t.db
        .insert(user)
        .values({ name: email, email })
        .returning({ id: user.id });
      return must(row).id;
    }

    async function accept(context: TestContext, tokenHash: string) {
      return run(context, async (client) => {
        const { rows } = await client.query<{
          outcome: string;
          joined_membership_id: string | null;
          membership_created: boolean;
        }>('select * from app.accept_invitation($1)', [tokenHash]);
        return must(rows[0]);
      });
    }

    it('only the admin of the club (or a superadmin supporting it) sees and writes them', async () => {
      const own = [must(a.rows.invitation)];
      expect(await ids(as('admin'), 'select id from invitation')).toEqual(own);
      expect(
        await ids(
          {
            clubId: a.clubId,
            userId: superadminId,
            role: 'superadmin',
            supportReason: 'Soporte: invitaciones',
          },
          'select id from invitation',
        ),
      ).toEqual(own);
      for (const who of ['coach', 'sc', 'medical', 'player', 'parent'] as const) {
        expect(await ids(as(who), 'select id from invitation'), who).toEqual([]);
        expect(await ids(as(who), 'select id from invitation_category'), who).toEqual([]);
      }
      expect(
        await pgCode(
          run(as('coach'), (client) =>
            client.query(
              `insert into invitation (club_id, email, role, token_hash, expires_at)
               values ($1, 'x@example.com', 'player', $2, now() + interval '1 day')`,
              [a.clubId, sha256('coach-invite')],
            ),
          ),
        ),
      ).toBe('42501');
      await run(as('admin'), (client) =>
        client.query(
          `insert into invitation (club_id, email, role, token_hash, expires_at)
           values ($1, 'y@example.com', 'player', $2, now() + interval '1 day')`,
          [a.clubId, sha256('admin-invite')],
        ),
      );
    });

    it('finds an invitation by token hash only, without any context', async () => {
      const tokenHash = await invite('vista@example.com', 'player');
      const { rows } = await app.pool.query<Record<string, unknown>>(
        'select * from app.invitation_by_token($1)',
        [tokenHash],
      );
      expect(rows).toHaveLength(1);
      expect(must(rows[0])).toMatchObject({
        club_id: a.clubId,
        club_slug: a.slug,
        email: 'vista@example.com',
        role: 'player',
        accepted_at: null,
        revoked_at: null,
      });
      const unknown = await app.pool.query('select * from app.invitation_by_token($1)', [
        sha256('nope'),
      ]);
      expect(unknown.rowCount).toBe(0);
      // Still nothing through the tables.
      expect(await ids({}, 'select id from invitation')).toEqual([]);
    });

    it('accepts as the user of the context: membership, staff assignments, once', async () => {
      const email = 'nuevo-coach@example.com';
      const userId = await newUser(email);
      const tokenHash = await invite(email, 'coach', must(a.rows.category));

      const joined = await accept({ userId }, tokenHash);
      expect(joined).toMatchObject({ outcome: 'joined', membership_created: true });
      const membershipId = must(joined.joined_membership_id);
      const { rows: stored } = await t.pool.query<{
        role: string;
        invited_by: string;
        categories: string[];
        accepted_by: string;
      }>(
        `select m.role, m.invited_by,
                array(select sa.category_id::text from staff_assignment sa where sa.membership_id = m.id) as categories,
                (select i.accepted_by from invitation i where i.token_hash = $2) as accepted_by
           from membership m where m.id = $1`,
        [membershipId, tokenHash],
      );
      expect(must(stored[0])).toEqual({
        role: 'coach',
        invited_by: a.users.admin,
        categories: [a.rows.category],
        accepted_by: userId,
      });
      // The new coach now acts in the club with the validated role.
      expect(await players({ clubId: a.clubId, userId, role: 'coach' })).toEqual([
        a.players.assigned,
      ]);

      // A retry by the same user answers the same membership, without changes.
      expect(await accept({ userId }, tokenHash)).toEqual({
        outcome: 'joined',
        joined_membership_id: membershipId,
        membership_created: false,
      });
      const { rows: assignments } = await t.pool.query(
        'select 1 from staff_assignment where membership_id = $1',
        [membershipId],
      );
      expect(assignments).toHaveLength(1);
      // Anyone else: already used.
      const other = await newUser('otro-coach@example.com');
      expect(await accept({ userId: other }, tokenHash)).toMatchObject({ outcome: 'accepted' });
    });

    it('allows one open invitation per email and role, and one open assignment per category', async () => {
      await invite('unica@example.com', 'player');
      expect(await pgCode(invite('unica@example.com', 'player'))).toBe('23505');
      await invite('unica@example.com', 'coach');
      expect(
        await pgCode(
          t.pool.query(
            `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
             select club_id, membership_id, category_id, valid_from from staff_assignment
              where club_id = $1 and category_id is not null and valid_to is null limit 1`,
            [a.clubId],
          ),
        ),
      ).toBe('23505');
    });

    it('lets the API change only the revocation of an invitation', async () => {
      const tokenHash = await invite('revocable@example.com', 'player');
      await run(as('admin'), (client) =>
        client.query(
          'update invitation set revoked_at = now(), revoked_by = $2 where token_hash = $1',
          [tokenHash, a.users.admin],
        ),
      );
      for (const set of [
        `email = 'otro@example.com'`,
        `role = 'admin'`,
        `token_hash = token_hash`,
        `expires_at = now() + interval '1 year'`,
        `accepted_at = now()`,
        `accepted_by = created_by`,
      ]) {
        expect(
          await pgCode(
            run(as('admin'), (client) =>
              client.query(`update invitation set ${set} where token_hash = $1`, [tokenHash]),
            ),
          ),
          set,
        ).toBe('42501');
      }
    });

    it('does not duplicate an active membership with the same role', async () => {
      const tokenHash = await invite(`player@roles-a.example.com`, 'player');
      const result = await accept({ userId: a.users.player }, tokenHash);
      expect(result).toMatchObject({ outcome: 'joined', membership_created: false });
      const { rows } = await t.pool.query<{ n: number }>(
        `select count(*)::int as n from membership where user_id = $1 and club_id = $2 and role = 'player'`,
        [a.users.player, a.clubId],
      );
      expect(must(rows[0]).n).toBe(1);
    });

    it('refuses another email, expired and revoked invitations and unknown tokens', async () => {
      const userId = await newUser('otra-persona@example.com');
      const tokenHash = await invite('destinatario@example.com', 'player');
      expect(await accept({ userId }, tokenHash)).toMatchObject({ outcome: 'wrong_email' });
      expect(await accept({ userId }, sha256('unknown'))).toMatchObject({ outcome: 'not_found' });

      const late = await invite('otra-persona@example.com', 'player');
      await t.pool.query(
        `update invitation set created_at = now() - interval '2 days', expires_at = now() - interval '1 second'
          where token_hash = $1`,
        [late],
      );
      expect(await accept({ userId }, late)).toMatchObject({ outcome: 'expired' });

      const revoked = await invite('otra-persona@example.com', 'coach');
      await t.pool.query(`update invitation set revoked_at = now() where token_hash = $1`, [
        revoked,
      ]);
      expect(await accept({ userId }, revoked)).toMatchObject({ outcome: 'revoked' });

      const { rows } = await t.pool.query<{ n: number }>(
        'select count(*)::int as n from membership where user_id = $1',
        [userId],
      );
      expect(must(rows[0]).n).toBe(0);
    });

    it('needs a user and no club in the context, and only the API role may call it', async () => {
      const tokenHash = await invite('alguien@example.com', 'player');
      expect(await pgCode(accept({}, tokenHash))).toBe('42501');
      expect(await pgCode(accept(as('admin'), tokenHash))).toBe('42501');
      const worker = await connectAs(t, 'worker');
      try {
        expect(
          await pgCode(worker.pool.query('select * from app.accept_invitation($1)', [tokenHash])),
        ).toBe('42501');
        expect(
          await pgCode(worker.pool.query('select * from app.invitation_by_token($1)', [tokenHash])),
        ).toBe('42501');
      } finally {
        await worker.close();
      }
    });
  });

  describe('superadmin in a club', () => {
    const support = {
      clubId: '',
      userId: '',
      role: 'superadmin',
      supportReason: 'Soporte: ticket 42',
    };

    it('acts as admin of the club it supports', async () => {
      const context = { ...support, clubId: a.clubId, userId: superadminId };
      expect(await players(context)).toEqual([a.players.assigned, a.players.other].sort());
      expect(await players({ ...context, clubId: b.clubId })).toEqual(
        [b.players.assigned, b.players.other].sort(),
      );
    });

    it('requires the is_superadmin flag', async () => {
      expect(await players(as('admin', 'superadmin'))).toEqual([]);
      expect(
        await pgCode(
          run({ ...as('admin', 'superadmin'), supportReason: 'x' }, (client) =>
            client.query('select 1'),
          ),
        ),
      ).toBe('42501');
    });

    it('acts only after recording the support access of the transaction (ADR 0029)', async () => {
      // Without the record: nothing, in a club or without one.
      expect(await players({ clubId: a.clubId, userId: superadminId, role: 'superadmin' })).toEqual(
        [],
      );
      expect(await ids({ userId: superadminId }, 'select id from club')).toEqual([]);
      // A record for club B does not open club A, and a record without club does not
      // open any club.
      await run({ clubId: b.clubId, userId: superadminId, requestId: 'req-b' }, async (client) => {
        await client.query(`select app.begin_support_access('Soporte en B')`);
        await client.query(
          `select set_config('app.club_id', $1, true), set_config('app.role', 'superadmin', true)`,
          [a.clubId],
        );
        expect((await client.query('select id from player')).rowCount).toBe(0);
      });
      await run({ userId: superadminId, supportReason: 'Registro' }, async (client) => {
        await client.query(
          `select set_config('app.club_id', $1, true), set_config('app.role', 'superadmin', true)`,
          [a.clubId],
        );
        expect((await client.query('select id from player')).rowCount).toBe(0);
      });
      // The record of an earlier transaction does not carry over.
      expect(await players({ clubId: a.clubId, userId: superadminId, role: 'superadmin' })).toEqual(
        [],
      );
    });

    it('records who, which club, why, which request and when', async () => {
      const requestId = 'req-support-audit';
      await run({ ...support, clubId: a.clubId, userId: superadminId, requestId }, async (client) =>
        client.query('select 1'),
      );
      const { rows } = await t.pool.query<Record<string, unknown>>(
        `select user_id, club_id, reason, request_id, db_role, started_at is not null as timed
           from support.access_log where request_id = $1`,
        [requestId],
      );
      expect(rows).toEqual([
        {
          user_id: superadminId,
          club_id: a.clubId,
          reason: support.supportReason,
          request_id: requestId,
          db_role: app.login,
          timed: true,
        },
      ]);
    });

    it('needs a reason and a request id', async () => {
      for (const context of [
        { ...support, clubId: a.clubId, userId: superadminId, supportReason: ' ' },
        { ...support, clubId: a.clubId, userId: superadminId, requestId: null },
      ]) {
        expect(await pgCode(run(context, (client) => client.query('select 1')))).toMatch(
          /^(23514|42501)$/,
        );
      }
    });

    it('the support log is append-only and out of reach of the application', async () => {
      for (const sql of ['select * from support.access_log', 'delete from support.access_log']) {
        expect(
          await pgCode(
            run({ ...support, clubId: a.clubId, userId: superadminId }, (client) =>
              client.query(sql),
            ),
          ),
        ).toBe('42501');
      }
      for (const sql of [
        'update support.access_log set reason = $$x$$',
        'delete from support.access_log',
        'truncate support.access_log',
      ]) {
        expect(await pgCode(t.pool.query(sql)), sql).toBe('42501');
      }
    });

    it('the flag cannot be granted through the application roles', async () => {
      expect(
        await pgCode(
          run(as('admin'), (client) =>
            client.query('update "user" set is_superadmin = true where id = $1', [a.users.admin]),
          ),
        ),
      ).toBe('42501');
    });
  });

  describe('public club theme', () => {
    it('serves only the brand by slug, without any context', async () => {
      const { rows } = await app.pool.query<Record<string, unknown>>(
        'select * from app.club_theme($1)',
        [a.slug],
      );
      expect(rows).toHaveLength(1);
      expect(Object.keys(must(rows[0])).sort()).toEqual(
        [
          'id',
          'logo_file_id',
          'name',
          'primary_color',
          'secondary_color',
          'short_name',
          'slug',
          'updated_at',
        ].sort(),
      );
      expect((await app.pool.query('select * from app.club_theme($1)', ['nope'])).rowCount).toBe(0);
    });
  });

  describe('Better Auth role', () => {
    let auth: RoleConnection;

    beforeAll(async () => {
      auth = await connectAs(t, 'auth');
    });

    afterAll(async () => {
      await auth.close();
    });

    it('signs a user up through the Drizzle adapter as sport_performance_auth', async () => {
      const db = createDatabase(auth.pool);
      const betterAuthInstance = betterAuth({
        secret: randomBytes(32).toString('hex'),
        baseURL: 'http://localhost:3000',
        database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
        advanced: { database: { generateId: 'uuid' } },
        emailAndPassword: { enabled: true },
        user: {
          additionalFields: {
            isSuperadmin: { type: 'boolean', input: false, defaultValue: false },
          },
        },
        logger: { disabled: true },
      });
      const result = await betterAuthInstance.api.signUpEmail({
        body: { email: 'auth-role@example.com', password: 'una-clave-larga-123', name: 'Auth' },
      });
      expect(result.user.email).toBe('auth-role@example.com');
      const [stored] = await t.db
        .select({ isSuperadmin: user.isSuperadmin })
        .from(user)
        .where(eq(user.email, 'auth-role@example.com'));
      expect(stored?.isSuperadmin).toBe(false);
    });

    it('owns the sign-in attempt counters, which the API cannot see', async () => {
      await auth.pool.query(
        `insert into auth_rate_limit (key, count, window_ends_at) values ('test:key', 1, now() + interval '1 minute')`,
      );
      expect(
        (await auth.pool.query('delete from auth_rate_limit where key = $1', ['test:key']))
          .rowCount,
      ).toBe(1);
      expect(await pgCode(app.pool.query('select 1 from auth_rate_limit'))).toBe('42501');
      expect(await pgCode(auth.pool.query('select 1 from invitation'))).toBe('42501');
    });

    it('cannot read club data nor grant is_superadmin', async () => {
      expect(await pgCode(auth.pool.query('select 1 from player'))).toBe('42501');
      expect(await pgCode(auth.pool.query('select app.current_club_id()'))).toBe('42501');
      expect(
        await pgCode(
          auth.pool.query(
            `insert into "user" (name, email, is_superadmin) values ('X', 'x-super@example.com', true)`,
          ),
        ),
      ).toBe('42501');
      expect(
        await pgCode(
          auth.pool.query('update "user" set is_superadmin = true where id = $1', [a.users.admin]),
        ),
      ).toBe('42501');
    });
  });

  describe('logins', () => {
    it('assertConnectionRole accepts a proper login and rejects the owner', async () => {
      await assertConnectionRole(app.pool, 'app');
      await expect(assertConnectionRole(app.pool, 'worker')).rejects.toThrow(DatabaseRoleError);
      await expect(assertConnectionRole(t.pool, 'app')).rejects.toThrow(/superuser/);
    });

    it('provisioning is idempotent, rotates the password and refuses a second role', async () => {
      const login = `sp_test_rotate_${randomBytes(4).toString('hex')}`;
      const server = must(process.env.DATABASE_URL);
      const first = randomBytes(20).toString('hex');
      const second = randomBytes(20).toString('hex');
      try {
        await provisionLoginRole({ connectionString: server, login, password: first, role: 'app' });
        await provisionLoginRole({
          connectionString: server,
          login,
          password: second,
          role: 'app',
        });
        const url = new URL(t.connectionString);
        url.username = login;
        url.password = second;
        const { Client } = (await import('pg')).default;
        const client = new Client({ connectionString: url.toString() });
        await client.connect();
        await assertConnectionRole(client, 'app');
        await client.end();
        url.password = first;
        const stale = new Client({ connectionString: url.toString() });
        expect(await pgCode(stale.connect())).toBe('28P01');
        // A login belongs to exactly one role: the union of two roles' policies would
        // defeat the scoping (for example app + worker).
        await expect(
          provisionLoginRole({ connectionString: server, login, password: second, role: 'worker' }),
        ).rejects.toThrow(/exactly one role/);
      } finally {
        await t.pool.query(`drop role if exists "${login}"`);
      }
    });
  });
});
