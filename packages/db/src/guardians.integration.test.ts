import { createHash, randomUUID } from 'node:crypto';
import type { PlayerId } from '@sport-performance/domain';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  guardian,
  invitation,
  membership,
  player,
  playerAccessCode,
  user,
} from './schema/index.js';
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
 * Guardians and accounts of minors at the database (B-310, ADR 0042): who
 * sees and writes player access codes and player invitations, redeeming a
 * code (`app.redeem_player_access`) and accepting an invitation about a
 * player (`app.accept_invitation`), through the API's real role.
 */

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    return failure.code ?? failure.cause?.code;
  }
  return 'no error';
}

interface Redeemed {
  outcome: string;
  player_user_id: string | null;
  player_club_id: string | null;
  player_membership_id: string | null;
  user_created: boolean;
  access_code_id: string | null;
}

describe.skipIf(!hasDatabase)('guardians and player access (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  /** A minor of club A without an account, child of the fixture's parent. */
  let child: PlayerId;

  const as = (who: FixtureUser): TestContext => ({
    clubId: a.clubId,
    userId: a.users[who],
    role: who === 'coachM17' ? 'coach' : who,
  });
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);
  const ids = (context: TestContext, sql: string, params: unknown[] = []) =>
    run(context, async (client) => {
      const { rows } = await client.query<{ id: string }>(sql, params);
      return rows.map((r) => r.id).sort();
    });

  async function issue(playerId: string, by: string, label: string, expiresInS = 900) {
    const [row] = await t.db
      .insert(playerAccessCode)
      .values({
        clubId: a.clubId,
        playerId: playerId as PlayerId,
        codeHash: sha256(`code-${label}`),
        tokenHash: sha256(`token-${label}`),
        expiresAt: new Date(Date.now() + expiresInS * 1000),
        createdBy: by,
      })
      .returning({ id: playerAccessCode.id });
    return must(row).id;
  }

  const redeem = (codeHash: string | null, tokenHash: string | null, context: TestContext = {}) =>
    run(context, async (client) => {
      const { rows } = await client.query<Redeemed>(
        'select * from app.redeem_player_access($1, $2)',
        [codeHash, tokenHash],
      );
      return must(rows[0]);
    });

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'guardians-a');
    b = await seedClubFixture(t.db, 'guardians-b');
    child = must(
      (
        await t.db
          .insert(player)
          .values({
            clubId: a.clubId,
            firstName: 'Sofía',
            lastName: 'Gómez',
            birthDate: '2013-08-10' as never,
            sex: 'female',
            sport: 'rugby',
            joinedOn: '2024-03-01' as never,
          })
          .returning({ id: player.id })
      )[0],
    ).id;
    await t.db.insert(guardian).values({
      clubId: a.clubId,
      playerId: child,
      userId: a.users.parent,
      relationship: 'mother',
      validFrom: '2024-03-01' as never,
    });
    app = await connectAs(t, 'app');
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe('player_access_code', () => {
    it('only the administration and the guardians of the player see the codes', async () => {
      const own = [must(a.rows.player_access_code)];
      expect(await ids(as('admin'), 'select id from player_access_code')).toEqual(own);
      expect(await ids(as('parent'), 'select id from player_access_code')).toEqual(own);
      for (const who of ['coach', 'sc', 'medical', 'player'] as const) {
        expect(await ids(as(who), 'select id from player_access_code'), who).toEqual([]);
      }
    });

    it('a guardian issues codes for their children only, and only revokes them', async () => {
      const insert = (playerId: string, label: string) =>
        run(as('parent'), (client) =>
          client.query(
            `insert into player_access_code (club_id, player_id, code_hash, token_hash, expires_at, created_by)
             values ($1, $2, $3, $4, now() + interval '15 minutes', $5) returning id`,
            [a.clubId, playerId, sha256(`c-${label}`), sha256(`t-${label}`), a.users.parent],
          ),
        );
      expect(await pgCode(insert(a.players.other, 'other'))).toBe('42501');
      expect(await pgCode(insert(child, 'child'))).toBe('no error');
      expect(
        await pgCode(
          run(as('parent'), (client) =>
            client.query(`update player_access_code set code_hash = $1 where player_id = $2`, [
              sha256('changed'),
              child,
            ]),
          ),
        ),
      ).toBe('42501');
      expect(
        await pgCode(
          run(as('coach'), (client) =>
            client.query(
              `insert into player_access_code (club_id, player_id, code_hash, token_hash, expires_at)
               values ($1, $2, $3, $4, now() + interval '15 minutes')`,
              [a.clubId, a.players.assigned, sha256('c-coach'), sha256('t-coach')],
            ),
          ),
        ),
      ).toBe('42501');
      // Leave no open code of the child behind for the redeem tests.
      await t.pool.query(
        `update player_access_code set revoked_at = now() where player_id = $1 and revoked_at is null`,
        [child],
      );
    });

    it('caps the expiry at one hour and keeps one open code per player', async () => {
      expect(await pgCode(issue(child, a.users.parent, 'too-long', 2 * 60 * 60))).toBe('23514');
      await issue(child, a.users.parent, 'open-1');
      expect(await pgCode(issue(child, a.users.parent, 'open-2'))).toBe('23505');
      await t.pool.query(
        `update player_access_code set revoked_at = now() where player_id = $1 and revoked_at is null`,
        [child],
      );
    });
  });

  describe('app.redeem_player_access', () => {
    it('creates the account without email, links it and opens the membership, once', async () => {
      const issued = await issue(child, a.users.parent, 'redeem-1');
      const first = await redeem(sha256('code-redeem-1'), null);
      expect(first).toMatchObject({
        outcome: 'redeemed',
        player_club_id: a.clubId,
        user_created: true,
        access_code_id: issued,
      });
      const account = must(first.player_user_id);
      const stored = await t.pool.query<{ email: string; name: string; user_id: string }>(
        `select u.email, u.name, p.user_id from player p join "user" u on u.id = p.user_id where p.id = $1`,
        [child],
      );
      expect(stored.rows[0]).toEqual({
        email: `player.${child}@no-email.invalid`,
        name: 'Sofía Gómez',
        user_id: account,
      });
      const memberships = await t.pool.query<{ id: string; role: string; invited_by: string }>(
        `select id, role, invited_by from membership where user_id = $1`,
        [account],
      );
      expect(memberships.rows).toEqual([
        { id: first.player_membership_id, role: 'player', invited_by: a.users.parent },
      ]);
      // Single use: the same code, and its link, are spent.
      expect((await redeem(sha256('code-redeem-1'), null)).outcome).toBe('consumed');
      expect((await redeem(null, sha256('token-redeem-1'))).outcome).toBe('consumed');
    });

    it('reuses the account and the membership on the next code, by link too', async () => {
      await issue(child, a.users.parent, 'redeem-2');
      const second = await redeem(null, sha256('token-redeem-2'));
      expect(second).toMatchObject({ outcome: 'redeemed', user_created: false });
      const count = await t.pool.query<{ n: string }>(
        `select count(*) as n from membership m join player p on p.user_id = m.user_id where p.id = $1`,
        [child],
      );
      expect(count.rows[0]?.n).toBe('1');
    });

    it('refuses unknown, revoked and expired codes', async () => {
      expect((await redeem(sha256('nope'), null)).outcome).toBe('not_found');
      const revoked = await issue(child, a.users.parent, 'revoked');
      await t.pool.query(
        `update player_access_code set revoked_at = now(), revoked_by = created_by where id = $1`,
        [revoked],
      );
      expect((await redeem(sha256('code-revoked'), null)).outcome).toBe('revoked');
      const expired = await issue(child, a.users.parent, 'expired');
      await t.pool.query(
        `update player_access_code set created_at = now() - interval '20 minutes',
                expires_at = now() - interval '5 minutes' where id = $1`,
        [expired],
      );
      expect((await redeem(sha256('code-expired'), null)).outcome).toBe('expired');
      await t.pool.query(`update player_access_code set revoked_at = now() where id = $1`, [
        expired,
      ]);
    });

    it('checks the issuer again: a guardian of an adult or an ended link gives no access', async () => {
      await issue(child, a.users.parent, 'adult');
      await t.pool.query(
        `update player set birth_date = now()::date - interval '18 years' where id = $1`,
        [child],
      );
      expect((await redeem(sha256('code-adult'), null)).outcome).toBe('not_allowed');
      await t.pool.query(`update player set birth_date = '2013-08-10' where id = $1`, [child]);
      // The code was not spent by the refusal: valid again now that the child is a minor.
      expect((await redeem(sha256('code-adult'), null)).outcome).toBe('redeemed');

      await issue(child, a.users.parent, 'ended-link');
      await t.pool.query(
        `update guardian set valid_to = valid_from where player_id = $1 and user_id = $2`,
        [child, a.users.parent],
      );
      expect((await redeem(sha256('code-ended-link'), null)).outcome).toBe('not_allowed');
      await t.pool.query(
        `update guardian set valid_to = null where player_id = $1 and user_id = $2`,
        [child, a.users.parent],
      );
      await t.pool.query(
        `update player_access_code set revoked_at = now() where player_id = $1 and revoked_at is null and consumed_at is null`,
        [child],
      );

      // An admin's code works for any player; a player who left cannot be signed in.
      await issue(a.players.other, a.users.admin, 'admin');
      // A leave (B-315) sets the day, the reason and the archive together (`player_leave`).
      await t.pool.query(
        `update player set left_on = '2025-01-01', left_reason = 'quit', archived_at = now()
          where id = $1`,
        [a.players.other],
      );
      expect((await redeem(sha256('code-admin'), null)).outcome).toBe('not_allowed');
      await t.pool.query(
        `update player set left_on = null, left_reason = null, archived_at = null where id = $1`,
        [a.players.other],
      );
      expect((await redeem(sha256('code-admin'), null)).outcome).toBe('redeemed');
    });

    it('never opens an account with an email: only the player own account without email', async () => {
      // Review of #159: a session is the user's in every club, so a code of club A must not
      // sign in an account that is also someone in club B (or a superadmin).
      const [linked] = await t.db
        .insert(player)
        .values({
          clubId: a.clubId,
          firstName: 'Con',
          lastName: 'Email',
          birthDate: '2013-01-01' as never,
          sex: 'male',
          sport: 'rugby',
          joinedOn: '2024-03-01' as never,
          userId: a.users.coach,
        })
        .returning({ id: player.id });
      const withEmail = must(linked).id;
      const takes = (playerId: string, context: TestContext = as('admin')) =>
        run(context, async (client) => {
          const { rows } = await client.query<{ takes: boolean | null }>(
            'select app.player_takes_access_codes($1) as takes',
            [playerId],
          );
          return rows[0]?.takes;
        });
      expect(await takes(withEmail)).toBe(false);
      // The child has their account without email (redeemed above); another club sees nothing.
      expect(await takes(child)).toBe(true);
      expect(await takes(child, as('parent'))).toBe(true);
      expect(await takes(child, { clubId: b.clubId, userId: b.users.admin, role: 'admin' })).toBe(
        null,
      );

      await issue(withEmail, a.users.admin, 'with-email');
      expect((await redeem(sha256('code-with-email'), null)).outcome).toBe('has_account');
      // Not spent, and nothing was written for the account.
      const code = await t.pool.query<{ consumed_at: string | null }>(
        'select consumed_at from player_access_code where code_hash = $1',
        [sha256('code-with-email')],
      );
      expect(code.rows[0]?.consumed_at).toBeNull();
      const memberships = await t.pool.query<{ role: string }>(
        `select role from membership where club_id = $1 and user_id = $2 and role = 'player'`,
        [a.clubId, a.users.coach],
      );
      expect(memberships.rows).toEqual([]);

      // The reserved address of another player, or a superadmin with this player's, neither.
      const original = must(
        (
          await t.pool.query<{ email: string }>('select email from "user" where id = $1', [
            a.users.coach,
          ])
        ).rows[0],
      ).email;
      await t.pool.query(`update "user" set email = $1 where id = $2`, [
        `player.${randomUUID()}@no-email.invalid`,
        a.users.coach,
      ]);
      expect((await redeem(sha256('code-with-email'), null)).outcome).toBe('has_account');
      await t.pool.query(`update "user" set email = $1, is_superadmin = true where id = $2`, [
        `player.${withEmail}@no-email.invalid`,
        a.users.coach,
      ]);
      expect(await takes(withEmail)).toBe(false);
      expect((await redeem(sha256('code-with-email'), null)).outcome).toBe('has_account');
      await t.pool.query(`update player_access_code set revoked_at = now() where player_id = $1`, [
        withEmail,
      ]);
      await t.pool.query(`update player set user_id = null where id = $1`, [withEmail]);
      await t.pool.query(`update "user" set email = $1, is_superadmin = false where id = $2`, [
        original,
        a.users.coach,
      ]);
    });

    it('runs only without a club and with exactly one hash', async () => {
      expect(await pgCode(redeem(sha256('x'), null, as('admin')))).toBe('42501');
      expect(await pgCode(redeem(sha256('x'), sha256('y')))).toBe('22023');
      expect(await pgCode(redeem(null, null))).toBe('22023');
    });
  });

  describe('invitations about a player', () => {
    it('a guardian creates, sees and revokes only player invitations of their children', async () => {
      const insert = (role: string, playerId: string, label: string) =>
        run(as('parent'), (client) =>
          client.query<{ id: string }>(
            `insert into invitation (club_id, email, role, player_id, token_hash, expires_at, created_by)
             values ($1, $2, $3, $4, $5, now() + interval '1 day', $6) returning id`,
            [
              a.clubId,
              `${label}@example.com`,
              role,
              playerId,
              sha256(`inv-${label}`),
              a.users.parent,
            ],
          ),
        );
      expect(await pgCode(insert('player', a.players.other, 'other'))).toBe('42501');
      // RLS refuses it before the CHECK of the role does.
      expect(await pgCode(insert('coach', child, 'coach'))).toBe('42501');
      const created = await insert('player', child, 'child');
      const id = must(created.rows[0]).id;
      // The fixture's coach invitation stays invisible to the guardian.
      expect(await ids(as('parent'), 'select id from invitation')).toEqual([id]);
      await run(as('parent'), (client) =>
        client.query(`update invitation set revoked_at = now(), revoked_by = $1 where id = $2`, [
          a.users.parent,
          id,
        ]),
      );
      for (const who of ['coach', 'player'] as const) {
        expect(await ids(as(who), 'select id from invitation'), who).toEqual([]);
      }
    });

    async function accepting(email: string, role: string, playerId: string, extra = {}) {
      const tokenHash = sha256(`accept-${email}-${role}-${randomUUID()}`);
      await t.db.insert(invitation).values({
        clubId: a.clubId,
        email,
        role: role as never,
        playerId: playerId as PlayerId,
        tokenHash,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdBy: a.users.admin,
        ...extra,
      });
      const [invitee] = await t.db
        .insert(user)
        .values({ name: email, email })
        .onConflictDoNothing()
        .returning({ id: user.id });
      const userId =
        invitee?.id ??
        must(
          (await t.pool.query<{ id: string }>('select id from "user" where email = $1', [email]))
            .rows[0],
        ).id;
      const accept = () =>
        run({ userId }, async (client) => {
          const { rows } = await client.query<{ outcome: string; joined_membership_id: string }>(
            'select * from app.accept_invitation($1)',
            [tokenHash],
          );
          return must(rows[0]);
        });
      return { userId, accept };
    }

    it('a player invitation makes the account the player own, unless it has another', async () => {
      const [fresh] = await t.db
        .insert(player)
        .values({
          clubId: a.clubId,
          firstName: 'Tomás',
          lastName: 'Ruiz',
          birthDate: '2012-02-02' as never,
          sex: 'male',
          sport: 'rugby',
          joinedOn: '2024-03-01' as never,
        })
        .returning({ id: player.id });
      const tomas = must(fresh).id;
      const invited = await accepting('tomas@example.com', 'player', tomas);
      expect((await invited.accept()).outcome).toBe('joined');
      const linked = await t.pool.query<{ user_id: string }>(
        'select user_id from player where id = $1',
        [tomas],
      );
      expect(linked.rows[0]?.user_id).toBe(invited.userId);
      // Already the account of another player (the child): refused, nothing written.
      const other = await accepting('otro@example.com', 'player', child);
      expect((await other.accept()).outcome).toBe('player_taken');
      const memberships = await t.db
        .select({ id: membership.id })
        .from(membership)
        .where(eq(membership.userId, other.userId));
      expect(memberships).toEqual([]);
    });

    it('a parent invitation about a player opens the guardian link', async () => {
      const invited = await accepting('padre@example.com', 'parent', child, {
        guardianRelationship: 'father',
      });
      expect((await invited.accept()).outcome).toBe('joined');
      const links = await t.pool.query<{ relationship: string; valid_to: string | null }>(
        'select relationship, valid_to from guardian where player_id = $1 and user_id = $2',
        [child, invited.userId],
      );
      expect(links.rows).toEqual([{ relationship: 'father', valid_to: null }]);
      expect(
        await pgCode(
          t.db.insert(invitation).values({
            clubId: a.clubId,
            email: 'sin-relacion@example.com',
            role: 'parent',
            playerId: child,
            tokenHash: sha256('no-relationship'),
            expiresAt: new Date(Date.now() + 86_400_000),
          }),
        ),
      ).toBe('23514');
    });

    it('a player cannot become their own guardian', async () => {
      // The child's account (without email, from the redeem tests) opens a parent
      // invitation about the child: refused, no membership nor link written.
      const own = await accepting(`player.${child}@no-email.invalid`, 'parent', child, {
        guardianRelationship: 'other',
      });
      expect((await own.accept()).outcome).toBe('own_guardian');
      const links = await t.pool.query<{ id: string }>(
        'select id from guardian where player_id = $1 and user_id = $2',
        [child, own.userId],
      );
      expect(links.rows).toEqual([]);
      const parents = await t.pool.query<{ id: string }>(
        `select id from membership where user_id = $1 and role = 'parent'`,
        [own.userId],
      );
      expect(parents.rows).toEqual([]);
    });

    it('a player of another club is never a target (composite foreign key)', async () => {
      expect(
        await pgCode(
          t.db.insert(invitation).values({
            clubId: a.clubId,
            email: 'cross@example.com',
            role: 'player',
            playerId: b.players.other,
            tokenHash: sha256('cross-club'),
            expiresAt: new Date(Date.now() + 86_400_000),
          }),
        ),
      ).toBe('23503');
    });
  });

  it('a guardian link may end on the day it starts (empty range), never before', async () => {
    const [row] = await t.db
      .insert(guardian)
      .values({
        clubId: a.clubId,
        playerId: a.players.other,
        userId: a.users.parent,
        relationship: 'other',
        validFrom: '2026-05-01' as never,
        validTo: '2026-05-01' as never,
      })
      .returning({ id: guardian.id });
    expect(row).toBeDefined();
    expect(
      await pgCode(
        t.db.insert(guardian).values({
          clubId: a.clubId,
          playerId: a.players.other,
          userId: a.users.parent,
          relationship: 'other',
          validFrom: '2026-05-02' as never,
          validTo: '2026-05-01' as never,
        }),
      ),
    ).toBe('23514');
  });
});
