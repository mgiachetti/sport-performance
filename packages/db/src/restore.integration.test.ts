import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RestoreToolError,
  recordRestoreEvent,
  verifyRestoredDatabase,
  writeRestoreDrillMarker,
  type RestoreVerificationReport,
} from './restore.js';
import { DATABASE_ROLES } from './roles.js';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  type MigratedTestDatabase,
  type RoleConnection,
} from './testing/database.js';
import { seedClubFixture } from './testing/tenant-fixture.js';

/**
 * Backups and recovery (B-702, migration 0051, ADR 0094): the `ops` schema
 * belongs to the owner only, markers and restore events are append-only, the
 * sync epoch changes with a recorded restore, and the verification of a
 * restored copy reads a migrated database right and catches a broken one.
 * A real PITR restore is not reproducible here: the drill markers stand for
 * it (the source holds both markers, so verifying it as if restored before
 * the second one must fail).
 */

const ROLES = Object.values(DATABASE_ROLES);

const statusOf = (report: RestoreVerificationReport, name: string) =>
  report.checks.find((c) => c.name === name)?.status;

async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'no error';
}

describe.skipIf(!hasDatabase)('backups and recovery tooling (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let auth: RoleConnection;

  beforeAll(async () => {
    t = await createMigratedDatabase();
    await seedClubFixture(t.db, 'restore-a');
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
    auth = await connectAs(t, 'auth');
  });

  afterAll(async () => {
    await Promise.all([app.close(), worker.close(), auth.close()]);
    await t.drop();
  });

  describe('the ops schema', () => {
    it('no connection role reaches it', async () => {
      const { rows } = await t.pool.query<{ role: string; privilege: string }>(
        `select r.rolname as role, p.privilege
           from pg_namespace s cross join pg_roles r
           cross join unnest(array['USAGE', 'CREATE']) as p(privilege)
          where s.nspname = 'ops' and r.rolname = any($1::text[])
            and has_schema_privilege(r.oid, s.oid, p.privilege)`,
        [ROLES],
      );
      expect(rows).toEqual([]);
      const tables = await t.pool.query<{ table: string; rls: boolean; granted: boolean }>(
        `select c.relname as table, c.relrowsecurity as rls,
                exists (select 1 from pg_roles r where r.rolname = any($1::text[])
                         and has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')) as granted
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'ops' and c.relkind = 'r' order by 1`,
        [ROLES],
      );
      expect(tables.rows).toEqual([
        // The state of the operational checks (B-703, ADR 0095) shares the schema.
        { table: 'check_state', rls: true, granted: false },
        { table: 'restore_drill_marker', rls: true, granted: false },
        { table: 'restore_event', rls: true, granted: false },
      ]);
      for (const role of [app, worker, auth]) {
        expect(await pgErrorCode(role.pool.query('select 1 from ops.restore_event'))).toBe('42501');
        expect(
          await pgErrorCode(
            role.pool.query(`insert into ops.restore_drill_marker (environment) values ('test')`),
          ),
        ).toBe('42501');
      }
    });

    it('markers and restore events are append-only, even for the owner', async () => {
      const marker = await writeRestoreDrillMarker(t.pool, {
        environment: 'test',
        label: 'before',
      });
      expect(marker).toMatchObject({ environment: 'test', label: 'before' });
      expect(
        await pgErrorCode(
          t.pool.query(`update ops.restore_drill_marker set label = 'x' where id = $1`, [
            marker.id,
          ]),
        ),
      ).toBe('42501');
      expect(
        await pgErrorCode(
          t.pool.query('delete from ops.restore_drill_marker where id = $1', [marker.id]),
        ),
      ).toBe('42501');
      expect(await pgErrorCode(t.pool.query('truncate ops.restore_drill_marker'))).toBe('42501');
      expect(await pgErrorCode(t.pool.query('truncate ops.restore_event'))).toBe('42501');
    });

    it('refuses bad input before writing', async () => {
      await expect(writeRestoreDrillMarker(t.pool, { environment: 'Prod uction' })).rejects.toThrow(
        RestoreToolError,
      );
      await expect(
        writeRestoreDrillMarker(t.pool, { environment: 'test', label: 'x'.repeat(201) }),
      ).rejects.toThrow(RestoreToolError);
      await expect(
        recordRestoreEvent(t.pool, {
          kind: 'drill',
          environment: 'test',
          recoveryTargetAt: new Date(),
          reason: '  ',
        }),
      ).rejects.toThrow(RestoreToolError);
    });

    it('only the owner uses the tools: a connection role is refused', async () => {
      await expect(writeRestoreDrillMarker(app.pool, { environment: 'test' })).rejects.toThrow(
        RestoreToolError,
      );
      await expect(verifyRestoredDatabase(worker.pool)).rejects.toThrow(RestoreToolError);
    });
  });

  describe('verification', () => {
    it('passes the migrated database restored "now", with every check and the row counts', async () => {
      const before = await writeRestoreDrillMarker(t.pool, { environment: 'test' });
      const { rows } = await t.pool.query<{ now: Date }>('select clock_timestamp() as now');
      const target = rows[0]?.now ?? new Date();
      const report = await verifyRestoredDatabase(t.pool, {
        recoveryTargetAt: target,
        presentMarkerIds: [before.id],
      });
      expect(report.checks.filter((c) => c.status === 'fail')).toEqual([]);
      expect(report.ok).toBe(true);
      for (const name of [
        'recovery_finished',
        'migrations',
        'job_queue',
        'row_level_security',
        'triggers',
        'drill_markers',
        'recovery_point',
      ]) {
        expect(statusOf(report, name), name).toBe('pass');
      }
      // Roles are cluster-wide: other databases' logins may or may not exist; never missing.
      expect(statusOf(report, 'connection_roles')).not.toBe('fail');
      expect(report.latestWriteAt).not.toBeNull();
      expect(report.secondsBetweenLatestWriteAndTarget).toBeGreaterThanOrEqual(0);
      const tables = new Map(report.tables.map((r) => [r.table, r.rows]));
      expect(tables.get('public.club')).toBeGreaterThanOrEqual(1);
      expect(tables.get('public.player')).toBeGreaterThanOrEqual(1);
      expect(tables.has('medical.injury')).toBe(true);
      expect(tables.has('support.access_log')).toBe(true);
      expect(tables.get('ops.restore_drill_marker')).toBeGreaterThanOrEqual(1);
      // Counts and names only: nothing of a row's content.
      expect(JSON.stringify(report)).not.toMatch(/@/);
    });

    it('fails when the copy holds a marker written after the target', async () => {
      const before = await writeRestoreDrillMarker(t.pool, {
        environment: 'test',
        label: 'before',
      });
      const { rows } = await t.pool.query<{ now: Date }>('select clock_timestamp() as now');
      const target = rows[0]?.now ?? new Date();
      const after = await writeRestoreDrillMarker(t.pool, { environment: 'test', label: 'after' });
      // The source itself holds both: verified as a copy at `target`, it is not one.
      const report = await verifyRestoredDatabase(t.pool, {
        recoveryTargetAt: target,
        presentMarkerIds: [before.id],
        absentMarkerIds: [after.id],
        clockSkewMs: 0,
        countRows: false,
      });
      expect(report.ok).toBe(false);
      expect(statusOf(report, 'drill_markers')).toBe('fail');
      expect(statusOf(report, 'recovery_point')).toBe('fail');
      expect(report.tables).toEqual([]);
    });

    it('fails a copy with a disabled trigger or a club table without forced RLS', async () => {
      await t.pool.query('alter table public.player disable trigger player_set_updated_at');
      await t.pool.query('alter table medical.injury no force row level security');
      try {
        const report = await verifyRestoredDatabase(t.pool, { countRows: false });
        expect(report.ok).toBe(false);
        expect(report.checks.find((c) => c.name === 'triggers')?.detail).toContain(
          'public.player.player_set_updated_at',
        );
        expect(report.checks.find((c) => c.name === 'row_level_security')?.detail).toContain(
          'medical.injury',
        );
      } finally {
        await t.pool.query('alter table public.player enable trigger player_set_updated_at');
        await t.pool.query('alter table medical.injury force row level security');
      }
      expect((await verifyRestoredDatabase(t.pool, { countRows: false })).ok).toBe(true);
    });
  });

  describe('the sync epoch', () => {
    it('is empty until a restore is recorded, then the latest event; only the API reads it', async () => {
      const epoch = async () =>
        (await app.pool.query<{ epoch: string }>('select app.sync_epoch() as epoch')).rows[0]
          ?.epoch;
      expect(await epoch()).toBe('');
      const first = await recordRestoreEvent(t.pool, {
        kind: 'drill',
        environment: 'test',
        recoveryTargetAt: new Date(Date.now() - 60_000),
        reason: 'Simulacro trimestral',
      });
      expect(await epoch()).toBe(first.id);
      const second = await recordRestoreEvent(t.pool, {
        kind: 'incident',
        environment: 'test',
        recoveryTargetAt: new Date(Date.now() - 30_000),
        reason: 'Migración fallida',
      });
      expect(await epoch()).toBe(second.id);
      expect(await pgErrorCode(worker.pool.query('select app.sync_epoch()'))).toBe('42501');
      expect(await pgErrorCode(auth.pool.query('select app.sync_epoch()'))).toBe('42501');
      const report = await verifyRestoredDatabase(t.pool, { countRows: false });
      expect(report.database.restoreEventsRecorded).toBe(2);
    });

    it('refuses a target in the future of the record', async () => {
      expect(
        await pgErrorCode(
          recordRestoreEvent(t.pool, {
            kind: 'drill',
            environment: 'test',
            recoveryTargetAt: new Date(Date.now() + 3_600_000),
            reason: 'Simulacro',
          }),
        ),
      ).toBe('23514');
    });
  });

  describe('the declared environment', () => {
    it('refuses to write for another environment than the database declares', async () => {
      const { rows } = await t.pool.query<{ db: string }>('select current_database() as db');
      const database = rows[0]?.db ?? '';
      await t.pool.query(`alter database "${database}" set app.deployment_environment = 'staging'`);
      const fresh = t.temporary.pool({ max: 1 });
      try {
        await expect(writeRestoreDrillMarker(fresh, { environment: 'production' })).rejects.toThrow(
          /declares environment "staging"/,
        );
        const marker = await writeRestoreDrillMarker(fresh, { environment: 'staging' });
        expect(marker.environment).toBe('staging');
        const report = await verifyRestoredDatabase(fresh, { countRows: false });
        expect(report.database.environment).toBe('staging');
      } finally {
        await t.temporary.closePool(fresh);
        await t.pool.query(`alter database "${database}" reset app.deployment_environment`);
      }
    });
  });
});
