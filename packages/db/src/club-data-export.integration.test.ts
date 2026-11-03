import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { TENANT_SETTING_NAMES } from './roles.js';
import { seedClubFixture, type ClubFixture, type FixtureUser } from './testing/tenant-fixture.js';

/**
 * CSV export of the club's data (B-608, ADR 0072): who asks and reads under
 * RLS, the ZIP file following its export, the worker's list of clubs to
 * serve, the wake-up notification and what erasing a player does to the
 * exports that include them.
 */

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    return failure.code ?? failure.cause?.code;
  }
  return 'no error';
}

describe.skipIf(!hasDatabase)('club data export (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let c: ClubFixture;

  const as = (club: ClubFixture, who: FixtureUser, role?: string): TestContext => ({
    clubId: club.clubId,
    userId: club.users[who],
    role: role ?? (who === 'coachM17' ? 'coach' : who),
  });
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);

  /** Inserts a queued export as the caller of `context`, with their own id and role. */
  const ask = (context: TestContext, overrides: Record<string, unknown> = {}) =>
    run(context, async (client) => {
      const values = {
        requested_by: context.userId,
        requester_role: context.role,
        status: 'queued',
        ...overrides,
      };
      const { rows } = await client.query<{ id: string }>(
        `insert into club_data_export (club_id, requested_by, requester_role, status, datasets, requested_on, player_ids)
         values ($1, $2, $3::membership_role, $4::club_data_export_status, '{players}', '2026-03-01', $5)
         returning id`,
        [
          context.clubId,
          values.requested_by,
          values.requester_role,
          values.status,
          [a.players.assigned],
        ],
      );
      return must(rows[0]).id;
    });

  const visible = (context: TestContext, table: 'club_data_export' | 'file', kind = '') =>
    run(context, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        table === 'file'
          ? `select id from file where kind::text = $1 order by id`
          : 'select id from club_data_export order by id',
        table === 'file' ? [kind] : [],
      );
      return rows.map((r) => r.id);
    });

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'export-a');
    b = await seedClubFixture(t.db, 'export-b');
    c = await seedClubFixture(t.db, 'export-c');
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await t.close();
  });

  it('only S&C and the administration ask, as themselves and for a new request', async () => {
    expect(await pgCode(ask(as(a, 'admin')))).toBe('no error');
    expect(await pgCode(ask(as(a, 'sc')))).toBe('no error');
    for (const who of ['coach', 'medical', 'player', 'parent'] as const) {
      expect(await pgCode(ask(as(a, who))), who).toBe('42501');
    }
    // Support does not take a club's data out.
    expect(await pgCode(ask(as(a, 'admin', 'superadmin'), { requester_role: 'admin' }))).toBe(
      '42501',
    );
    // In someone else's name, with another role, or already generated.
    expect(await pgCode(ask(as(a, 'sc'), { requested_by: a.users.admin }))).toBe('42501');
    expect(await pgCode(ask(as(a, 'sc'), { requester_role: 'admin' }))).toBe('42501');
    expect(await pgCode(ask(as(a, 'admin'), { status: 'running' }))).toBe('42501');
  });

  it('the requester reads their own exports, the administration every one of the club', async () => {
    const mine = await ask(as(a, 'sc'));
    const all = await visible(as(a, 'admin'), 'club_data_export');
    expect(all).toContain(mine);
    expect(all).toContain(must(a.rows.club_data_export));
    const ofSc = await visible(as(a, 'sc'), 'club_data_export');
    expect(ofSc).toContain(mine);
    expect(ofSc).not.toContain(must(a.rows.club_data_export));
    for (const who of ['coach', 'medical', 'player', 'parent'] as const) {
      expect(await visible(as(a, who), 'club_data_export'), who).toEqual([]);
    }
    expect(await visible(as(b, 'admin'), 'club_data_export')).not.toContain(mine);
  });

  it('the API never changes an export: only the worker does', async () => {
    const id = await ask(as(a, 'admin'));
    expect(
      await pgCode(
        run(as(a, 'admin'), (client) =>
          client.query(`update club_data_export set status = 'failed' where id = $1`, [id]),
        ),
      ),
    ).toBe('42501');
    await inContext(worker.pool, { clubId: a.clubId }, async (client) => {
      const result = await client.query(
        `update club_data_export set status = 'running', started_at = now(), attempts = 1 where id = $1`,
        [id],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it('the ZIP is read by whoever reads its export', async () => {
    const exportFile = must(
      (
        await t.pool.query<{ file_id: string }>(
          'select file_id from club_data_export where id = $1',
          [a.rows.club_data_export],
        )
      ).rows[0],
    ).file_id;
    expect(await visible(as(a, 'admin'), 'file', 'data_export')).toContain(exportFile);
    for (const who of ['sc', 'coach', 'medical', 'player', 'parent'] as const) {
      expect(await visible(as(a, who), 'file', 'data_export'), who).not.toContain(exportFile);
    }
    // Other kinds keep their scopes: the CMJ video of the assigned player.
    expect(await visible(as(a, 'coach'), 'file', 'cmj_video')).toEqual([must(a.rows.file)]);
  });

  it('lists for the worker the clubs with an export to take, and nothing else', async () => {
    const clubs = async () =>
      inContext(worker.pool, {}, async (client) => {
        const { rows } = await client.query<{ club: string }>(
          'select c as club from app.worker_data_export_clubs() c',
        );
        return rows.map((r) => r.club);
      });
    await t.pool
      .query(`update club_data_export set status = 'failed', started_at = coalesce(started_at, now()),
                          completed_at = now(), error_code = 'generation_failed'
                         where status in ('queued', 'running')`);
    expect(await clubs()).toEqual([]);
    const queued = await ask(as(b, 'admin'));
    expect(await clubs()).toEqual([b.clubId]);
    await t.pool.query(
      `update club_data_export set status = 'running', started_at = now(), attempts = 1 where id = $1`,
      [queued],
    );
    expect(await clubs()).toEqual([]);
    // A worker that died half way: taken again after the stale window.
    await t.pool.query(
      `update club_data_export set started_at = now() - interval '31 minutes' where id = $1`,
      [queued],
    );
    expect(await clubs()).toEqual([b.clubId]);
    expect(
      await pgCode(
        run(as(b, 'admin'), (client) => client.query('select app.worker_data_export_clubs()')),
      ),
    ).toBe('42501');
  });

  it('wakes the worker up on commit with the club', async () => {
    const listener = await worker.pool.connect();
    try {
      const payloads: string[] = [];
      listener.on('notification', (message) => {
        if (message.channel === 'sport_performance_data_export' && message.payload) {
          payloads.push(message.payload);
        }
      });
      await listener.query('listen sport_performance_data_export');
      await ask(as(a, 'sc'));
      for (let i = 0; i < 50 && payloads.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(payloads).toEqual([a.clubId]);
    } finally {
      await listener.query('unlisten *');
      listener.release();
    }
  });

  it('erasing a player deletes the ZIPs that include them and takes them out of every export', async () => {
    const target = b.players.assigned;
    const exportId = must(b.rows.club_data_export);
    const queued = await ask(as(b, 'sc'));
    await t.pool.query(
      `update club_data_export set player_ids = $2, availability = $3 where id = $1`,
      [
        queued,
        [target, b.players.other],
        { [target]: { training: 'available', match: 'available' } },
      ],
    );
    // The fixture's guardian asked for the erasure of the assigned player.
    await run(as(b, 'admin'), (client) =>
      client.query('select app.erase_player($1)', [must(b.rows.data_subject_request)]),
    );

    const { rows } = await t.pool.query<{
      id: string;
      player_ids: string[];
      availability: Record<string, unknown> | null;
      file_status: string | null;
      expires_at: Date | null;
    }>(
      `select e.id, e.player_ids, e.availability, f.status::text as file_status, f.expires_at
         from club_data_export e left join file f on f.club_id = e.club_id and f.id = e.file_id
        where e.id = any ($1)`,
      [[exportId, queued]],
    );
    const ready = must(rows.find((r) => r.id === exportId));
    expect(ready.player_ids).toEqual([b.players.other]);
    expect(ready.file_status).toBe('deleted');
    expect(must(ready.expires_at).getTime()).toBeLessThanOrEqual(Date.now());
    const pending = must(rows.find((r) => r.id === queued));
    expect(pending.player_ids).toEqual([b.players.other]);
    expect(pending.availability).toEqual({});
    // The other club's export is untouched.
    const { rows: other } = await t.pool.query<{ status: string }>(
      `select f.status::text as status from club_data_export e join file f on f.club_id = e.club_id and f.id = e.file_id
        where e.id = $1`,
      [a.rows.club_data_export],
    );
    expect(must(other[0]).status).toBe('ready');
  });
  it('an erasure racing the worker that marks a ZIP ready still deletes that ZIP', async () => {
    // An export being generated with the player, its ZIP stored and `pending`.
    const { rows: started } = await t.pool.query<{ id: string }>(
      `insert into club_data_export (club_id, requested_by, requester_role, status, datasets,
                                     requested_on, player_ids, attempts, started_at)
       values ($1, $2, 'admin', 'running', '{players}', '2026-03-01', $3, 1, now())
       returning id`,
      [c.clubId, c.users.admin, [c.players.assigned, c.players.other]],
    );
    const exportId = must(started[0]).id;
    const { rows: stored } = await t.pool.query<{ id: string }>(
      `insert into file (club_id, kind, status, content_type, size_bytes, checksum_sha256,
                         file_name, expires_at)
       values ($1, 'data_export', 'pending', 'application/zip', 2048,
               '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=', 'datos.zip',
               now() + interval '1 day')
       returning id`,
      [c.clubId],
    );
    const fileId = must(stored[0]).id;

    // The worker's final transaction marks both ready and has not committed yet.
    const final = await worker.pool.connect();
    let erasure: Promise<unknown> | undefined;
    try {
      await final.query('begin');
      await final.query(`select set_config('${TENANT_SETTING_NAMES.clubId}', $1, true)`, [
        c.clubId,
      ]);
      await final.query(
        `select 1 from club_data_export where club_id = $1 and id = $2 for update`,
        [c.clubId, exportId],
      );
      await final.query(
        `update file set status = 'ready', uploaded_at = now(), expires_at = now() + interval '7 days'
          where club_id = $1 and id = $2`,
        [c.clubId, fileId],
      );
      await final.query(
        `update club_data_export set status = 'ready', completed_at = now(), file_id = $3,
                row_counts = '{"players": 2}'
          where club_id = $1 and id = $2`,
        [c.clubId, exportId, fileId],
      );

      // The erasure starts meanwhile and waits on the export the worker holds.
      erasure = run(as(c, 'admin'), (client) =>
        client.query('select app.erase_player($1)', [must(c.rows.data_subject_request)]),
      );
      erasure.catch(() => undefined);
      let waiting = false;
      for (let i = 0; i < 250 && !waiting; i += 1) {
        const { rows } = await t.pool.query<{ waiting: boolean }>(
          `select exists (select 1 from pg_stat_activity
                           where datname = current_database() and wait_event_type = 'Lock'
                             and query like '%erase_player%') as waiting`,
        );
        waiting = must(rows[0]).waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await final.query('commit');
    } catch (error) {
      await final.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      final.release();
    }
    await erasure;

    const { rows } = await t.pool.query<{ player_ids: string[]; file_status: string }>(
      `select e.player_ids, f.status::text as file_status
         from club_data_export e join file f on f.club_id = e.club_id and f.id = e.file_id
        where e.id = $1`,
      [exportId],
    );
    expect(must(rows[0]).player_ids).toEqual([c.players.other]);
    expect(must(rows[0]).file_status).toBe('deleted');
  });
});
