import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  inContext,
  pgErrorOf,
  type MigratedTestDatabase,
  type RoleConnection,
} from './testing/database.js';
import { seedClubFixture, type ClubFixture } from './testing/tenant-fixture.js';

/**
 * Operational monitoring in the database (B-703, ADR 0095, migration
 * `0045_ops_monitoring`): `ops.check_state` is reached by nobody but the
 * SECURITY DEFINER functions (the worker records, the API reads), the record
 * function decides what to announce in one statement, and the backlog the
 * worker reads across clubs carries counts only.
 */

interface Recorded {
  code: string;
  status: string;
  previous_status: string | null;
  notify: boolean;
}

const check = (code: string, status: string, value: number | null, detail = {}) => ({
  code,
  status,
  value,
  detail,
});

describe.skipIf(!hasDatabase)('operational monitoring (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let auth: RoleConnection;
  let club: ClubFixture;

  const record = async (checks: unknown[], renotify = '1 hour') =>
    (
      await worker.pool.query<Recorded>(
        `select code, status, previous_status, notify
           from app.worker_record_ops_checks($1::jsonb, $2::interval)`,
        [JSON.stringify(checks), renotify],
      )
    ).rows;

  beforeAll(async () => {
    t = await createMigratedDatabase();
    club = await seedClubFixture(t.db, 'ops-a');
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
    auth = await connectAs(t, 'auth');
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await auth.close();
    await t.close();
  });

  it('no connection role reaches the ops schema or its table', async () => {
    const { rows } = await t.pool.query<{ role: string; usage: boolean; table: boolean }>(
      `select r.rolname as role,
              has_schema_privilege(r.oid, 'ops', 'USAGE, CREATE') as usage,
              has_table_privilege(r.oid, 'ops.check_state', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
                as table
         from pg_roles r where r.rolname like 'sport_performance_%' and not r.rolcanlogin
        order by 1`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row, row.role).toMatchObject({ usage: false, table: false });
    const rls = await t.pool.query<{ rls: boolean; forced: boolean }>(
      `select relrowsecurity as rls, relforcerowsecurity as forced from pg_class
        where oid = 'ops.check_state'::regclass`,
    );
    expect(rls.rows[0]).toEqual({ rls: true, forced: true });
    for (const role of [app, worker, auth]) {
      expect((await pgErrorOf(role.pool.query('select 1 from ops.check_state'))).code).toBe(
        '42501',
      );
    }
  });

  it('each function is executable only by its role', async () => {
    const calls = {
      backlog: 'select * from app.worker_ops_backlog(now())',
      record: `select * from app.worker_record_ops_checks('[]'::jsonb, interval '1 hour')`,
      status: 'select * from app.ops_status()',
    };
    expect((await pgErrorOf(app.pool.query(calls.backlog))).code).toBe('42501');
    expect((await pgErrorOf(app.pool.query(calls.record))).code).toBe('42501');
    expect((await pgErrorOf(worker.pool.query(calls.status))).code).toBe('42501');
    for (const call of Object.values(calls)) {
      expect((await pgErrorOf(auth.pool.query(call))).code).toBe('42501');
    }
    await expect(worker.pool.query(calls.backlog)).resolves.toBeDefined();
    await expect(app.pool.query(calls.status)).resolves.toBeDefined();
  });

  it('announces a failing check when it starts, when it changes and after the renotify interval', async () => {
    const first = await record([check('job_backlog_s', 'warning', 400), check('a_ok_n', 'ok', 0)]);
    expect(first).toEqual([
      { code: 'a_ok_n', status: 'ok', previous_status: null, notify: false },
      { code: 'job_backlog_s', status: 'warning', previous_status: null, notify: true },
    ]);
    // Still failing, within the interval: quiet.
    const again = await record([check('job_backlog_s', 'warning', 500), check('a_ok_n', 'ok', 0)]);
    expect(again.find((r) => r.code === 'job_backlog_s')).toMatchObject({
      previous_status: 'warning',
      notify: false,
    });
    // Escalates: announced.
    const worse = await record([
      check('job_backlog_s', 'critical', 2000),
      check('a_ok_n', 'ok', 0),
    ]);
    expect(worse.find((r) => r.code === 'job_backlog_s')?.notify).toBe(true);
    // Past the interval: announced again.
    await t.pool.query(
      `update ops.check_state set notified_at = now() - interval '2 hours' where code = 'job_backlog_s'`,
    );
    const later = await record([
      check('job_backlog_s', 'critical', 2100),
      check('a_ok_n', 'ok', 0),
    ]);
    expect(later.find((r) => r.code === 'job_backlog_s')?.notify).toBe(true);
    // Recovers: not announced, and the next failure is announced at once.
    const ok = await record([check('job_backlog_s', 'ok', 0), check('a_ok_n', 'ok', 0)]);
    expect(ok.find((r) => r.code === 'job_backlog_s')).toEqual({
      code: 'job_backlog_s',
      status: 'ok',
      previous_status: 'critical',
      notify: false,
    });
    const { rows } = await t.pool.query<{ notified_at: Date | null; value: number }>(
      `select notified_at, value from ops.check_state where code = 'job_backlog_s'`,
    );
    expect(rows[0]).toEqual({ notified_at: null, value: 0 });
  });

  it('keeps the status since across passes of the same status and drops checks no longer reported', async () => {
    await record([check('job_failed_recent_n', 'warning', 1), check('a_ok_n', 'ok', 0)]);
    const since = async () =>
      (
        await t.pool.query<{ status_since: Date }>(
          `select status_since from ops.check_state where code = 'job_failed_recent_n'`,
        )
      ).rows[0]?.status_since;
    const before = await since();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await record([check('job_failed_recent_n', 'warning', 2), check('a_ok_n', 'ok', 0)]);
    expect(await since()).toEqual(before);
    await record([check('job_failed_recent_n', 'warning', 2)]);
    const { rows } = await t.pool.query<{ code: string }>('select code from ops.check_state');
    expect(rows.map((r) => r.code)).toEqual(['job_failed_recent_n']);
  });

  it('refuses malformed passes', async () => {
    const bad = async (checks: unknown, renotify = '1 hour') =>
      (
        await pgErrorOf(
          worker.pool.query(`select * from app.worker_record_ops_checks($1::jsonb, $2::interval)`, [
            JSON.stringify(checks),
            renotify,
          ]),
        )
      ).code;
    expect(await bad({ code: 'x' })).toBe('22023');
    expect(await bad([], '10 seconds')).toBe('22023');
    expect(await bad([check('Bad Code', 'ok', 0)])).toBe('23514');
    expect(await bad([check('job_backlog_s', 'broken', 0)])).toBe('22P02');
    expect(await bad([check('job_backlog_s', 'ok', null)])).toBe('23514');
    expect(await bad([check('job_backlog_s', 'unknown', 3)])).toBe('23514');
    expect(await bad([check('job_backlog_s', 'ok', -1)])).toBe('23514');
    expect(await bad([{ ...check('job_backlog_s', 'ok', 0), detail: [] }])).toBe('23514');
  });

  it('the API reads what the worker recorded, and the backlog counts across clubs', async () => {
    await record([check('job_dead_letter_n', 'warning', 2, { 'derived-refresh-club-dead': 2 })]);
    const { rows } = await app.pool.query<{ code: string; status: string; detail: unknown }>(
      'select code, status, detail from app.ops_status()',
    );
    expect(rows).toEqual([
      {
        code: 'job_dead_letter_n',
        status: 'warning',
        detail: { 'derived-refresh-club-dead': 2 },
      },
    ]);
    // Even inside a club context the API reads the same platform rows (no club data in them).
    const inClub = await inContext(
      app.pool,
      { clubId: club.clubId, userId: club.users.admin, role: 'admin' },
      (client) => client.query<{ code: string }>('select code from app.ops_status()'),
    );
    expect(inClub.rows.map((r) => r.code)).toEqual(['job_dead_letter_n']);

    await t.pool.query(
      `insert into derived_refresh (club_id, player_id, maturation, requested_at)
       select $1, p.id, true, now() - interval '30 minutes' from player p where p.club_id = $1 limit 1
       on conflict (club_id, player_id) do update set requested_at = excluded.requested_at`,
      [club.clubId],
    );
    const backlog = await worker.pool.query<{
      derived_refresh_pending_n: string;
      derived_refresh_oldest_s: number;
      reports_failed_n: string;
      exports_failed_n: string;
      notifications_failed_n: string;
    }>(`select * from app.worker_ops_backlog(now() - interval '1 day')`);
    const row = backlog.rows[0];
    expect(Number(row?.derived_refresh_pending_n)).toBeGreaterThanOrEqual(1);
    expect(row?.derived_refresh_oldest_s).toBeGreaterThanOrEqual(30 * 60);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'derived_refresh_oldest_s',
      'derived_refresh_pending_n',
      'exports_failed_n',
      'notifications_failed_n',
      'reports_failed_n',
    ]);
  });
});
