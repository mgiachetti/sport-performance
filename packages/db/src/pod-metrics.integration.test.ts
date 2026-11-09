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
import { seedClubFixture, type ClubFixture, type FixtureUser } from './testing/tenant-fixture.js';

/**
 * The pod's metrics in the database (B-919, ADR 0110): `pod_metric_config`
 * (club configuration: every member reads, S&C and the administration
 * write), `pod_metric_run` (read like the player's values, written only by
 * the worker) and the pod values of `external_metric` (variant, algorithm
 * and run required; only the worker writes or deletes them, never a value of
 * another source).
 */

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'no error';
}

describe.skipIf(!hasDatabase)('pod metrics (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let distMetric: string;

  const as = (who: FixtureUser, club: ClubFixture = a): TestContext => ({
    clubId: club.clubId,
    userId: club.users[who],
    role: who === 'coachM17' ? 'coach' : who,
  });
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);
  const asWorker = <T>(club: ClubFixture, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(worker.pool, { clubId: club.clubId }, work);
  const count = (context: TestContext, sql: string, params: unknown[] = []) =>
    run(context, async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n ${sql}`,
        params,
      );
      return must(rows[0]).n;
    });

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'podmetrics-a');
    b = await seedClubFixture(t.db, 'podmetrics-b');
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
    const { rows } = await t.pool.query<{ id: string }>(
      `insert into metric_definition (club_id, code, unit, source, direction, is_canonical)
       values ($1, 'dist_m', 'm', 'field', 'higher_is_better', true) returning id`,
      [a.clubId],
    );
    distMetric = must(rows[0]).id;
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await t.drop();
  });

  describe('pod_metric_config', () => {
    it('every member reads it; S&C and the administration write it', async () => {
      for (const who of ['admin', 'sc', 'coach', 'medical', 'player', 'parent'] as const) {
        expect(await count(as(who), 'from pod_metric_config'), who).toBe(1);
      }
      const insert = (who: FixtureUser) =>
        run(as(who), (client) =>
          client.query(
            `insert into pod_metric_config (club_id, sport, algorithm_version, params, valid_from)
             values ($1, 'hockey', 'pod-metrics/1', '{}'::jsonb, '2026-01-01')`,
            [a.clubId],
          ),
        );
      expect(await code(insert('sc'))).toBe('no error');
      expect(await code(insert('coach'))).toBe('42501');
      expect(await code(insert('player'))).toBe('42501');
    });

    it('checks the algorithm version and the validity', async () => {
      const bad = (version: string, from: string, to: string | null) =>
        t.pool.query(
          `insert into pod_metric_config (club_id, algorithm_version, params, valid_from, valid_to)
           values ($1, $2, '{}'::jsonb, $3, $4)`,
          [a.clubId, version, from, to],
        );
      expect(await code(bad('pod metrics', '2026-01-01', null))).toBe('23514');
      expect(await code(bad('pod-metrics/1', '2026-01-01', '2026-01-01'))).toBe('23514');
    });
  });

  describe('pod_metric_run', () => {
    it('is read like the player values: own player, assigned staff, never another category', async () => {
      const run = 'from pod_metric_run where player_id = $1';
      const assigned = [a.players.assigned];
      expect(await count(as('admin'), run, assigned)).toBe(1);
      expect(await count(as('sc'), run, assigned)).toBe(1);
      expect(await count(as('coach'), run, assigned)).toBe(1);
      expect(await count(as('player'), run, assigned)).toBe(1);
      expect(await count(as('coachM17'), run, assigned)).toBe(0);
      expect(await count(as('admin', b), run, assigned)).toBe(0);
    });

    it('the application never writes it; the worker inserts, updates and deletes', async () => {
      expect(
        await code(
          run(as('admin'), (client) =>
            client.query(`update pod_metric_run set stale = true where club_id = $1`, [a.clubId]),
          ),
        ),
      ).toBe('42501');
      expect(
        await code(
          run(as('admin'), (client) =>
            client.query(`delete from pod_metric_run where club_id = $1`, [a.clubId]),
          ),
        ),
      ).toBe('42501');
      const id = await asWorker(a, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into pod_metric_run (club_id, player_id, training_session_id, local_date,
             method_variant, algorithm_version, definition_hash, inputs_hash, pod_raw_upload_ids,
             firmware_versions, gnss_firmware_versions, stats, computed_at)
           values ($1, $2, $3, '2026-03-10', 'pod_ppk', 'pod-metrics/1', repeat('c', 64),
                   repeat('d', 64), '{}', '{}', '{}', '{}'::jsonb, now())
           returning id`,
          [a.clubId, a.players.other, a.rows.training_session],
        );
        await client.query(`update pod_metric_run set stale = true where id = $1`, [
          must(rows[0]).id,
        ]);
        return must(rows[0]).id;
      });
      const deleted = await asWorker(a, (client) =>
        client.query(`delete from pod_metric_run where id = $1`, [id]),
      );
      expect(deleted.rowCount).toBe(1);
      // A reference Vmax without its rule (or the other way) is rejected.
      expect(
        await code(
          t.pool.query(
            `update pod_metric_run set reference_vmax_source = null where club_id = $1`,
            [a.clubId],
          ),
        ),
      ).toBe('23514');
    });
  });

  describe('pod values in external_metric', () => {
    const insertPod = (
      client: pg.ClientBase | pg.Pool,
      variant: string | null,
      version: string | null,
    ) =>
      client.query<{ id: string }>(
        `insert into external_metric (club_id, player_id, training_session_id,
           metric_definition_id, local_date, value, unit, source, external_ref, method_variant,
           algorithm_version, pod_metric_run_id)
         values ($1, $2, $3, $4, '2026-03-10', 4210, 'm', 'pod', 'pod_log:test', $5, $6, $7)
         returning id`,
        [
          a.clubId,
          a.players.assigned,
          a.rows.training_session,
          distMetric,
          variant,
          version,
          a.rows.pod_metric_run,
        ],
      );

    it('carry their variant and algorithm', async () => {
      expect(await code(insertPod(t.pool, null, null))).toBe('23514');
      expect(await code(insertPod(t.pool, 'pod_log', null))).toBe('23514');
      expect(
        await code(
          t.pool.query(
            `insert into external_metric (club_id, player_id, metric_definition_id, local_date,
               value, unit, source, method_variant, algorithm_version)
             values ($1, $2, $3, '2026-03-10', 1, 'm', 'catapult', 'pod_log', 'pod-metrics/1')`,
            [a.clubId, a.players.assigned, distMetric],
          ),
        ),
      ).toBe('23514');
    });

    it('only the worker writes them; it deletes a pod value, never another source', async () => {
      expect(
        await code(run(as('sc'), (client) => insertPod(client, 'pod_log', 'pod-metrics/1'))),
      ).toBe('42501');
      const podId = await asWorker(a, async (client) => {
        const { rows } = await insertPod(client, 'pod_log', 'pod-metrics/1');
        await client.query(`update external_metric set value = 4300 where id = $1`, [
          must(rows[0]).id,
        ]);
        return must(rows[0]).id;
      });
      // The S&C reads it but cannot edit it.
      expect(await count(as('sc'), 'from external_metric where id = $1', [podId])).toBe(1);
      const edited = await run(as('sc'), (client) =>
        client.query(`update external_metric set value = 1 where id = $1`, [podId]),
      );
      expect(edited.rowCount).toBe(0);
      const manual = await asWorker(a, (client) =>
        client.query(`delete from external_metric where id = $1`, [a.rows.external_metric]),
      );
      expect(manual.rowCount).toBe(0);
      const pod = await asWorker(a, (client) =>
        client.query(`delete from external_metric where id = $1`, [podId]),
      );
      expect(pod.rowCount).toBe(1);
    });
  });

  it('lists the clubs with pod metric work for the worker only', async () => {
    const { rows } = await worker.pool.query<{ c: string }>(
      'select c from app.worker_pod_metric_clubs() c',
    );
    expect(rows.map((r) => r.c)).toEqual(expect.arrayContaining([a.clubId, b.clubId]));
    expect(await code(app.pool.query('select app.worker_pod_metric_clubs()'))).toBe('42501');
  });
});
