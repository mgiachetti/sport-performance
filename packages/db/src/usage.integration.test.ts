import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
 * Usage metrics in the database (B-707, ADR 0093): `app.record_usage` records
 * the caller's own use (membership and role from the validated context, day
 * from the club's zone), adds to a repeated use and ignores a superadmin's
 * support; only the administration reads; the application writes nothing
 * directly; the worker folds and deletes.
 */

describe.skipIf(!hasDatabase)('usage metrics (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let superadmin: string;

  const as = (club: ClubFixture, user: keyof ClubFixture['users'], role: string): TestContext => ({
    clubId: club.clubId,
    userId: club.users[user],
    role,
  });

  const record = (context: TestContext, surface = 'panel', client = 'web') =>
    inContext(app.pool, context, (c) =>
      c.query('select app.record_usage($1, $2)', [surface, client]),
    );

  async function activity(club: ClubFixture) {
    const { rows } = await t.pool.query<{
      membership_id: string;
      role: string;
      local_date: string;
      surface: string;
      client: string;
      events_n: number;
      created_by: string | null;
    }>(
      `select membership_id, role::text, local_date::text, surface::text, client::text, events_n,
              created_by
         from usage_activity where club_id = $1 and local_date = (now() at time zone
              (select time_zone from club where id = $1))::date
        order by role::text, surface::text, client::text`,
      [club.clubId],
    );
    return rows;
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'usage-a');
    b = await seedClubFixture(t.db, 'usage-b');
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
    superadmin = must(
      (
        await t.pool.query<{ id: string }>(
          `insert into "user" (name, email, is_superadmin)
           values ('Soporte', 'soporte@usage.example.com', true) returning id`,
        )
      ).rows[0],
    ).id;
  });

  beforeEach(async () => {
    // The fixture's row is of a past day; each test starts with no use today.
    await t.pool.query(
      `delete from usage_activity where local_date >= (now() - interval '2 days')::date`,
    );
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await t.close();
  });

  it('records the caller’s own use, on the club day, and adds to a repeated one', async () => {
    await record(as(a, 'coach', 'coach'));
    await record(as(a, 'coach', 'coach'));
    await record(as(a, 'coach', 'coach'), 'panel', 'app');
    await record(as(a, 'player', 'player'), 'player_home', 'app');
    const rows = await activity(a);
    const coachMembership = must(
      (
        await t.pool.query<{ id: string }>(
          `select id from membership where club_id = $1 and user_id = $2`,
          [a.clubId, a.users.coach],
        )
      ).rows[0],
    ).id;
    expect(rows).toEqual([
      expect.objectContaining({ role: 'coach', surface: 'panel', client: 'app', events_n: 1 }),
      expect.objectContaining({
        membership_id: coachMembership,
        role: 'coach',
        surface: 'panel',
        client: 'web',
        events_n: 2,
        created_by: a.users.coach,
      }),
      expect.objectContaining({
        role: 'player',
        surface: 'player_home',
        client: 'app',
        events_n: 1,
      }),
    ]);
    expect(await activity(b)).toEqual([]);
  });

  it('does not record a superadmin’s support access', async () => {
    await record({
      clubId: a.clubId,
      userId: superadmin,
      role: 'superadmin',
      supportReason: 'Revisión del piloto',
    });
    expect(await activity(a)).toEqual([]);
  });

  it('refuses without a validated context, and a role the user does not hold', async () => {
    expect((await pgErrorOf(record({}))).code).toBe('42501');
    expect((await pgErrorOf(record({ clubId: a.clubId, userId: a.users.coach }))).code).toBe(
      '42501',
    );
    // A coach claiming admin has no validated role.
    expect((await pgErrorOf(record(as(a, 'coach', 'admin')))).code).toBe('42501');
    // A member of club A in club B's context.
    expect(
      (await pgErrorOf(record({ clubId: b.clubId, userId: a.users.coach, role: 'coach' }))).code,
    ).toBe('42501');
    expect(await activity(a)).toEqual([]);
    expect(await activity(b)).toEqual([]);
  });

  it('rejects an unknown surface or client', async () => {
    expect((await pgErrorOf(record(as(a, 'coach', 'coach'), 'ranking'))).code).toBe('22P02');
    expect((await pgErrorOf(record(as(a, 'coach', 'coach'), 'panel', 'ios'))).code).toBe('22P02');
  });

  it('only the administration reads; nobody in the application writes directly', async () => {
    await record(as(a, 'coach', 'coach'));
    const count = (context: TestContext, table: string) =>
      inContext(app.pool, context, async (c) => {
        const { rows } = await c.query<{ n: number }>(`select count(*)::int as n from ${table}`);
        return must(rows[0]).n;
      });
    for (const table of ['usage_activity', 'usage_weekly']) {
      expect(await count(as(a, 'admin', 'admin'), table)).toBeGreaterThan(0);
      for (const [user, role] of [
        ['coach', 'coach'],
        ['sc', 'sc'],
        ['medical', 'medical'],
        ['player', 'player'],
        ['parent', 'parent'],
      ] as const) {
        expect(await count(as(a, user, role), table), `${role} ${table}`).toBe(0);
      }
    }
    const membershipId = must(
      (
        await t.pool.query<{ id: string }>(
          `select id from membership where club_id = $1 and user_id = $2`,
          [a.clubId, a.users.admin],
        )
      ).rows[0],
    ).id;
    expect(
      (
        await pgErrorOf(
          inContext(app.pool, as(a, 'admin', 'admin'), (c) =>
            c.query(
              `insert into usage_activity (club_id, membership_id, role, local_date, surface, client)
               values ($1, $2, 'admin', current_date, 'panel', 'web')`,
              [a.clubId, membershipId],
            ),
          ),
        )
      ).code,
    ).toBe('42501');
    expect(
      (
        await pgErrorOf(
          inContext(app.pool, as(a, 'admin', 'admin'), (c) =>
            c.query('update usage_activity set events_n = 99'),
          ),
        )
      ).code,
    ).toBe('42501');
    expect(
      (
        await pgErrorOf(
          inContext(app.pool, as(a, 'admin', 'admin'), (c) =>
            c.query('delete from usage_activity'),
          ),
        )
      ).code,
    ).toBe('42501');
  });

  it('the worker folds a week into counts and deletes its activity rows', async () => {
    const coachMembership = must(
      (
        await t.pool.query<{ id: string }>(
          `select id from membership where club_id = $1 and user_id = $2`,
          [a.clubId, a.users.coach],
        )
      ).rows[0],
    ).id;
    await inContext(worker.pool, { clubId: a.clubId }, async (c) => {
      await c.query(
        `insert into usage_weekly (club_id, week_start, surface, client, role, active_members_n,
                                   member_days_n, events_n)
         values ($1, '2025-12-01', 'panel', 'web', 'coach', 1, 1, 1)`,
        [a.clubId],
      );
      const deleted = await c.query('delete from usage_activity where membership_id = $1', [
        coachMembership,
      ]);
      expect(deleted.rowCount).toBeGreaterThan(0);
    });
    // A week that does not start on Monday, or counts that do not add up, are rejected.
    expect(
      (
        await pgErrorOf(
          inContext(worker.pool, { clubId: a.clubId }, (c) =>
            c.query(
              `insert into usage_weekly (club_id, week_start, surface, client, role,
                                         active_members_n, member_days_n, events_n)
               values ($1, '2025-12-02', 'panel', 'web', 'coach', 1, 1, 1)`,
              [a.clubId],
            ),
          ),
        )
      ).constraint,
    ).toBe('usage_weekly_monday');
    expect(
      (
        await pgErrorOf(
          inContext(worker.pool, { clubId: a.clubId }, (c) =>
            c.query(
              `insert into usage_weekly (club_id, week_start, surface, client, role,
                                         active_members_n, member_days_n, events_n)
               values ($1, '2025-12-08', 'panel', 'web', 'coach', 1, 8, 8)`,
              [a.clubId],
            ),
          ),
        )
      ).constraint,
    ).toBe('usage_weekly_counts');
  });

  it('the activity goes with the membership', async () => {
    const userId = must(
      (
        await t.pool.query<{ id: string }>(
          `insert into "user" (name, email) values ('Tutora', 'tutora@usage-b.example.com') returning id`,
        )
      ).rows[0],
    ).id;
    await t.pool.query(
      `insert into membership (club_id, user_id, role) values ($1, $2, 'parent')`,
      [b.clubId, userId],
    );
    await record({ clubId: b.clubId, userId, role: 'parent' }, 'guardian_home', 'app');
    expect(await activity(b)).toHaveLength(1);
    // Deleting the account (B-329) cascades to the membership and its use.
    await t.pool.query('delete from "user" where id = $1', [userId]);
    expect(await activity(b)).toEqual([]);
  });
});
