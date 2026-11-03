import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  inContext,
  must,
  pgErrorOf,
  type MigratedTestDatabase,
  type RoleConnection,
  type TestContext,
} from './testing/database.js';
import { seedClubFixture, type ClubFixture } from './testing/tenant-fixture.js';

/**
 * Notifications in the database (B-328, ADR 0054): push tokens only through
 * their functions (registration bound to a live session of the caller, moved
 * between sessions, read by the worker only for members of its club), and
 * preferences and deliveries visible to their own user only.
 */

const token = (seed: string) => `ExponentPushToken[${seed.padEnd(22, 'x')}]`;

describe.skipIf(!hasDatabase)('notifications (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;

  const as = (club: ClubFixture, user: keyof ClubFixture['users'], role: string): TestContext => ({
    clubId: club.clubId,
    userId: club.users[user],
    role,
  });

  async function newSession(userId: string, expiresInS = 3600): Promise<string> {
    const { rows } = await t.pool.query<{ id: string }>(
      `insert into session (token, expires_at, user_id, client_type)
       values ($1, now() + make_interval(secs => $2), $3, 'mobile') returning id`,
      [randomUUID(), expiresInS, userId],
    );
    return must(rows[0]).id;
  }

  async function tokensOf(userId: string): Promise<string[]> {
    const { rows } = await t.pool.query<{ token: string }>(
      'select token from push_token where user_id = $1 order by token',
      [userId],
    );
    return rows.map((r) => r.token);
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'notif-a');
    b = await seedClubFixture(t.db, 'notif-b');
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await t.close();
  });

  describe('push tokens', () => {
    it('is reachable by no connection role directly', async () => {
      for (const role of [app, worker]) {
        expect((await pgErrorOf(role.pool.query('select 1 from push_token'))).code).toBe('42501');
      }
    });

    it('registers the token of a live session of the caller only', async () => {
      const own = await newSession(a.users.coach);
      const someoneElse = await newSession(a.users.sc);
      const expired = await newSession(a.users.coach, -10);
      const register = (session: string, value: string) =>
        inContext(app.pool, as(a, 'coach', 'coach'), (client) =>
          client.query(`select app.register_push_token($1, $2, 'ios')`, [session, value]),
        );
      await register(own, token('coach1'));
      expect(await tokensOf(a.users.coach)).toEqual([token('coach1')]);
      expect((await pgErrorOf(register(someoneElse, token('stolen')))).code).toBe('42501');
      expect((await pgErrorOf(register(expired, token('expired')))).code).toBe('42501');
      // Without a user in the context.
      expect(
        (
          await pgErrorOf(
            inContext(app.pool, {}, (client) =>
              client.query(`select app.register_push_token($1, $2, 'ios')`, [own, token('x1')]),
            ),
          )
        ).code,
      ).toBe('42501');
      // A malformed token never gets in.
      expect((await pgErrorOf(register(own, 'not-a-token'))).code).toBe('23514');
      // Registering again replaces the session's token.
      await register(own, token('coach2'));
      expect(await tokensOf(a.users.coach)).toEqual([token('coach2')]);
    });

    it('moves a token to the session that registers it last', async () => {
      const first = await newSession(a.users.player);
      const second = await newSession(a.users.parent);
      const shared = token('shared-phone');
      await inContext(app.pool, as(a, 'player', 'player'), (client) =>
        client.query(`select app.register_push_token($1, $2, 'android')`, [first, shared]),
      );
      await inContext(app.pool, as(a, 'parent', 'parent'), (client) =>
        client.query(`select app.register_push_token($1, $2, 'android')`, [second, shared]),
      );
      expect(await tokensOf(a.users.player)).toEqual([]);
      expect(await tokensOf(a.users.parent)).toEqual([shared]);
    });

    it('unregisters only the caller’s own session', async () => {
      const session = await newSession(a.users.medical);
      await inContext(app.pool, as(a, 'medical', 'medical'), (client) =>
        client.query(`select app.register_push_token($1, $2, 'ios')`, [session, token('medical')]),
      );
      const byOther = await inContext(app.pool, as(a, 'admin', 'admin'), (client) =>
        client.query<{ removed: boolean }>('select app.unregister_push_token($1) as removed', [
          session,
        ]),
      );
      expect(byOther.rows[0]?.removed).toBe(false);
      const byOwner = await inContext(app.pool, as(a, 'medical', 'medical'), (client) =>
        client.query<{ removed: boolean }>('select app.unregister_push_token($1) as removed', [
          session,
        ]),
      );
      expect(byOwner.rows[0]?.removed).toBe(true);
      expect(await tokensOf(a.users.medical)).toEqual([]);
    });

    it('goes with the session', async () => {
      const session = await newSession(a.users.coachM17);
      await inContext(app.pool, as(a, 'coachM17', 'coach'), (client) =>
        client.query(`select app.register_push_token($1, $2, 'ios')`, [session, token('m17')]),
      );
      await t.pool.query('delete from session where id = $1', [session]);
      expect(await tokensOf(a.users.coachM17)).toEqual([]);
    });

    it('gives the worker only the tokens of members of its club, and only for live sessions', async () => {
      const inA = await newSession(a.users.admin);
      const inB = await newSession(b.users.admin);
      await inContext(app.pool, as(a, 'admin', 'admin'), (client) =>
        client.query(`select app.register_push_token($1, $2, 'ios')`, [inA, token('admin-a')]),
      );
      await inContext(app.pool, as(b, 'admin', 'admin'), (client) =>
        client.query(`select app.register_push_token($1, $2, 'ios')`, [inB, token('admin-b')]),
      );
      const read = (club: ClubFixture | null) =>
        inContext(worker.pool, { clubId: club?.clubId ?? null }, async (client) => {
          const { rows } = await client.query<{ token: string }>(
            'select token from app.worker_push_tokens($1)',
            [[a.users.admin, b.users.admin]],
          );
          return rows.map((r) => r.token);
        });
      expect(await read(a)).toEqual([token('admin-a')]);
      expect(await read(b)).toEqual([token('admin-b')]);
      expect(await read(null)).toEqual([]);

      // The API cannot call the worker's functions, nor the worker the API's.
      expect(
        (
          await pgErrorOf(
            inContext(app.pool, as(a, 'admin', 'admin'), (client) =>
              client.query('select * from app.worker_push_tokens($1)', [[a.users.admin]]),
            ),
          )
        ).code,
      ).toBe('42501');
      expect(
        (
          await pgErrorOf(
            inContext(worker.pool, { clubId: a.clubId }, (client) =>
              client.query(`select app.register_push_token($1, $2, 'ios')`, [inA, token('w')]),
            ),
          )
        ).code,
      ).toBe('42501');

      // Forgetting a token: only one of a member of the job's club.
      const { rows } = await t.pool.query<{ id: string }>(
        'select id from push_token where token = $1',
        [token('admin-b')],
      );
      const idB = must(rows[0]).id;
      const forget = (club: ClubFixture) =>
        inContext(worker.pool, { clubId: club.clubId }, (client) =>
          client.query<{ removed: boolean }>('select app.worker_forget_push_token($1) as removed', [
            idB,
          ]),
        );
      expect((await forget(a)).rows[0]?.removed).toBe(false);
      expect((await forget(b)).rows[0]?.removed).toBe(true);
      expect(await tokensOf(b.users.admin)).toEqual([]);
    });
  });

  describe('preferences and deliveries', () => {
    it('each user reads and writes only their own preferences', async () => {
      await inContext(app.pool, as(a, 'coach', 'coach'), async (client) => {
        await client.query(
          `insert into notification_preference (club_id, user_id, kind, push) values ($1, $2, 'pre_training_summary', false)`,
          [a.clubId, a.users.coach],
        );
        const { rows } = await client.query<{ user_id: string }>(
          'select user_id from notification_preference',
        );
        expect(rows.map((r) => r.user_id)).toEqual([a.users.coach]);
      });
      // Not for someone else, even as admin.
      expect(
        (
          await pgErrorOf(
            inContext(app.pool, as(a, 'admin', 'admin'), (client) =>
              client.query(
                `insert into notification_preference (club_id, user_id, kind, push) values ($1, $2, 'critical_alert', false)`,
                [a.clubId, a.users.coach],
              ),
            ),
          )
        ).code,
      ).toBe('42501');
      // A parent has no notification kinds: no writes.
      expect(
        (
          await pgErrorOf(
            inContext(app.pool, as(a, 'parent', 'parent'), (client) =>
              client.query(
                `insert into notification_preference (club_id, user_id, kind, push) values ($1, $2, 'rpe_request', false)`,
                [a.clubId, a.users.parent],
              ),
            ),
          )
        ).code,
      ).toBe('42501');
    });

    it('deliveries are read by their recipient only and written by the worker only', async () => {
      await inContext(app.pool, as(a, 'coach', 'coach'), async (client) => {
        expect((await client.query('select 1 from notification')).rowCount).toBe(0);
        expect((await client.query('select 1 from push_ticket')).rowCount).toBe(0);
      });
      await inContext(app.pool, as(a, 'admin', 'admin'), async (client) => {
        expect((await client.query('select 1 from notification')).rowCount).toBe(1);
        expect((await client.query('select 1 from push_ticket')).rowCount).toBe(1);
      });
      expect(
        (
          await pgErrorOf(
            inContext(app.pool, as(a, 'admin', 'admin'), (client) =>
              client.query(`update notification set status = 'pending' where club_id = $1`, [
                a.clubId,
              ]),
            ),
          )
        ).code,
      ).toBe('42501');
      // The worker deletes past the retention.
      await inContext(worker.pool, { clubId: b.clubId }, async (client) => {
        const deleted = await client.query('delete from notification where id = $1', [
          must(b.rows.notification),
        ]);
        expect(deleted.rowCount).toBe(1);
        expect((await client.query('select 1 from push_ticket')).rowCount).toBe(0);
      });
    });

    it('rejects a delivery that is sent without a time or skipped without a reason', async () => {
      const insert = (status: string, skipReason: string | null, failureCode: string | null) =>
        t.pool.query(
          `insert into notification (club_id, user_id, kind, channel, dedupe_key, status, scheduled_for, skip_reason, failure_code)
           values ($1, $2, 'critical_alert', 'push', $3, $4, now(), $5, $6)`,
          [a.clubId, a.users.coach, `alert:${randomUUID()}`, status, skipReason, failureCode],
        );
      expect((await pgErrorOf(insert('sent', null, null))).constraint).toBe('notification_sent');
      expect((await pgErrorOf(insert('skipped', null, null))).constraint).toBe(
        'notification_skipped',
      );
      expect((await pgErrorOf(insert('pending', null, 'has spaces'))).constraint).toBe(
        'notification_failure_code',
      );
      await insert('skipped', 'preference_off', null);
    });
  });
});
