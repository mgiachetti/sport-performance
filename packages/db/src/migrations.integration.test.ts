import {
  ALERT_RULE_KINDS,
  CHANGE_OPERATIONS,
  CHANGE_SOURCES,
  CHANGE_TRACKED_TABLES,
  ALERT_SEVERITIES,
  ATTEMPT_AGGREGATIONS,
  COEFFICIENT_VERIFICATION_STATUSES,
  CONSENT_SIGNERS,
  GUARDIAN_RELATIONSHIPS,
  CONSENT_TYPES,
  DEVICE_BROWSERS,
  DEVICE_OPERATING_SYSTEMS,
  DOMINANT_SIDES,
  CONTACT_LEVELS,
  EXPOSURE_CONTEXTS,
  HEIGHT_SOURCES,
  FIXTURE_STATUSES,
  FIXTURE_VENUES,
  MATURITY_OFFSET_EQUATIONS,
  MEASUREMENT_METHODS,
  MEMBERSHIP_ROLES,
  SESSION_CLIENT_TYPES,
  PARENTS,
  PLAYER_LEAVE_REASONS,
  PARTICIPATION_STATUSES,
  SEXES,
  SPEED_ZONE_KINDS,
  SPORTS,
  STAGES,
  STAGE_BASES,
  STAGE_REASONS,
  TEST_NOT_DONE_REASONS,
  TEST_RESULT_STATUSES,
  TEST_SESSION_STATUSES,
  UNIT_CODES,
} from '@sport-performance/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import { createEmptyDatabase, hasDatabase, type TestDatabase } from './testing/database.js';
import { FULL_MIGRATION_TIMEOUT_MS } from './testing/temporary-database.js';

const GLOBAL_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'auth_rate_limit',
  'known_device',
  'club',
];

describe.skipIf(!hasDatabase)('migrations (Postgres 16)', () => {
  let database: TestDatabase;
  let client: pg.Client;

  beforeAll(async () => {
    database = await createEmptyDatabase();
    client = new pg.Client({ connectionString: database.connectionString });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await database.drop();
  });

  async function rows<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
    return (await client.query<T>(text, values)).rows;
  }

  it('runs on Postgres 16', async () => {
    const [row] = await rows<{ server_version_num: string }>('show server_version_num');
    expect(Number(row?.server_version_num)).toBeGreaterThanOrEqual(160000);
  });

  // A full run of every migration: minutes on a loaded runner (issue #147).
  it(
    'applies every migration on an empty database, concurrently and only once',
    { timeout: FULL_MIGRATION_TIMEOUT_MS },
    async () => {
      const reports = await Promise.all([
        runMigrations({ connectionString: database.connectionString }),
        runMigrations({ connectionString: database.connectionString }),
        runMigrations({ connectionString: database.connectionString }),
      ]);
      const total = reports[0].total;
      expect(total).toBeGreaterThanOrEqual(2);
      expect(reports.every((r) => r.total === total)).toBe(true);
      // Exactly one runner applied the migrations; the others waited on the lock.
      expect(reports.map((r) => r.applied).sort()).toEqual([0, 0, total]);

      const again = await runMigrations({ connectionString: database.connectionString });
      expect(again).toMatchObject({ applied: 0, total, unknown: 0 });
      expect(again.jobQueueVersion).toBeGreaterThan(0);
      expect(reports.every((r) => r.jobQueueVersion === again.jobQueueVersion)).toBe(true);
    },
  );

  it('gives every club table club_id, audit columns and a per-club client_uuid', async () => {
    const tables = await rows<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    );
    const tenantTables = tables.map((t) => t.table_name).filter((t) => !GLOBAL_TABLES.includes(t));
    expect(tenantTables.length).toBeGreaterThanOrEqual(31);

    const columns = await rows<{ table_name: string; column_name: string; is_nullable: string }>(
      `select table_name, column_name, is_nullable from information_schema.columns
       where table_schema = 'public'`,
    );
    const uniques = await rows<{ table_name: string; columns: string }>(
      `select c.conrelid::regclass::text as table_name,
              string_agg(a.attname, ',' order by k.ord) as columns
       from pg_constraint c
       cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
       where c.contype = 'u' and c.connamespace = 'public'::regnamespace
       group by c.oid, c.conrelid`,
    );

    for (const table of tenantTables) {
      const of = (name: string) =>
        columns.find((c) => c.table_name === table && c.column_name === name);
      expect(of('club_id')?.is_nullable, `${table}.club_id`).toBe('NO');
      for (const audit of ['created_at', 'updated_at', 'client_uuid']) {
        expect(of(audit)?.is_nullable, `${table}.${audit}`).toBe('NO');
      }
      expect(of('created_by'), `${table}.created_by`).toBeDefined();
      expect(of('updated_by'), `${table}.updated_by`).toBeDefined();
      const keys = uniques.filter((u) => u.table_name === `"${table}"` || u.table_name === table);
      expect(
        keys.map((k) => k.columns),
        table,
      ).toEqual(expect.arrayContaining(['club_id,id', 'club_id,client_uuid']));
    }
  });

  it('attaches the updated_at trigger to every table with updated_at', async () => {
    const missing = await rows<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
       where c.table_schema = 'public' and c.column_name = 'updated_at'
         and not exists (
           select 1 from pg_trigger t
           join pg_proc p on p.oid = t.tgfoid
           where t.tgrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
             and p.proname = 'set_updated_at' and not t.tgisinternal
         )`,
    );
    expect(missing).toEqual([]);
  });

  it('creates the enums from the domain constants (single source of truth)', async () => {
    const expected: Record<string, readonly string[]> = {
      sport: SPORTS,
      sex: SEXES,
      stage: STAGES,
      unit: UNIT_CODES,
      membership_role: MEMBERSHIP_ROLES,
      measurement_method: MEASUREMENT_METHODS,
      test_result_status: TEST_RESULT_STATUSES,
      test_not_done_reason: TEST_NOT_DONE_REASONS,
      attempt_aggregation: ATTEMPT_AGGREGATIONS,
      alert_severity: ALERT_SEVERITIES,
      alert_rule_kind: ALERT_RULE_KINDS,
      speed_zone_kind: SPEED_ZONE_KINDS,
      stage_basis: STAGE_BASES,
      stage_reason: STAGE_REASONS,
      maturity_offset_equation: MATURITY_OFFSET_EQUATIONS,
      session_kind: EXPOSURE_CONTEXTS,
      contact_level: CONTACT_LEVELS,
      participation_status: PARTICIPATION_STATUSES,
      consent_type: CONSENT_TYPES,
      consent_signer: CONSENT_SIGNERS,
      guardian_relationship: GUARDIAN_RELATIONSHIPS,
      coefficient_verification: COEFFICIENT_VERIFICATION_STATUSES,
      change_tracked_table: CHANGE_TRACKED_TABLES,
      change_operation: CHANGE_OPERATIONS,
      change_source: CHANGE_SOURCES,
      session_client_type: SESSION_CLIENT_TYPES,
      device_os: DEVICE_OPERATING_SYSTEMS,
      device_browser: DEVICE_BROWSERS,
      dominant_side: DOMINANT_SIDES,
      height_source: HEIGHT_SOURCES,
      parent_kind: PARENTS,
      player_leave_reason: PLAYER_LEAVE_REASONS,
      test_session_status: TEST_SESSION_STATUSES,
      fixture_venue: FIXTURE_VENUES,
      fixture_status: FIXTURE_STATUSES,
    };
    const enums = await rows<{ name: string; labels: string[] }>(
      `select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder)::text[] as labels
       from pg_type t join pg_enum e on e.enumtypid = t.oid
       where t.typnamespace = 'public'::regnamespace group by t.typname`,
    );
    const actual = Object.fromEntries(enums.map((e) => [e.name, e.labels]));
    for (const [name, values] of Object.entries(expected)) {
      expect(actual[name], name).toEqual([...values]);
    }
  });

  it('indexes every composite foreign key with club_id first', async () => {
    // Postgres does not index the referencing side of a foreign key; every
    // (club_id, x_id) key must be covered by an index starting with those columns,
    // or deletes on the parent and joins would scan the child table.
    const unindexed = await rows<{ constraint_name: string }>(
      `select c.conname as constraint_name
       from pg_constraint c
       where c.contype = 'f' and c.connamespace = 'public'::regnamespace
         and array_length(c.conkey, 1) = 2
         and not exists (
           select 1 from pg_index i
           where i.indrelid = c.conrelid
             and i.indkey[0] = c.conkey[1] and i.indkey[1] = c.conkey[2]
         )`,
    );
    expect(unindexed.map((u) => u.constraint_name)).toEqual([]);
  });
});
