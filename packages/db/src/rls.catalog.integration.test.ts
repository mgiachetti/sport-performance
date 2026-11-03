import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE_ROLES } from './roles.js';
import {
  createMigratedDatabase,
  hasDatabase,
  type MigratedTestDatabase,
} from './testing/database.js';

/**
 * The shape of RLS, roles and grants read from the migrated database's
 * catalog (ADR 0006, ADR 0026). Every table is enumerated from the catalog,
 * so a table added later without RLS or with a broad grant fails here.
 */

const ROLES = Object.values(DATABASE_ROLES);
/** Global tables: the identity of Better Auth, its attempt counters and the tenant root. */
const GLOBAL_TABLES = [
  'account',
  'auth_rate_limit',
  'club',
  'known_device',
  'push_token',
  'session',
  'user',
  'verification',
];
/** What Better Auth's role reaches (ADR 0028: the attempt counters; ADR 0033: known devices). */
const AUTH_TABLES = [
  'account',
  'auth_rate_limit',
  'known_device',
  'session',
  'user',
  'verification',
];
/**
 * The only club tables the application may DELETE from: `drill` (a plan, ADR 0026) and
 * `player_position` (a current attribute, replaced when a profile is edited, ADR 0035);
 * the worker, only its derived tables.
 */
const DELETABLE = {
  [DATABASE_ROLES.app]: ['drill', 'player_position'],
  [DATABASE_ROLES.auth]: AUTH_TABLES,
  // The worker's derived cache and its outbox (ADR 0046): rebuilt from the source rows.
  // The deliveries of notifications past their retention (ADR 0054).
  [DATABASE_ROLES.worker]: [
    'derived_refresh',
    'notification',
    'player_load_daily',
    'player_wellness_daily',
    'push_ticket',
  ],
};
const IMMUTABLE_COLUMNS = ['id', 'club_id', 'created_at', 'created_by', 'client_uuid'];

interface TableRow {
  table: string;
  has_club_id: boolean;
  rls: boolean;
  forced: boolean;
}

describe.skipIf(!hasDatabase)('RLS, roles and grants in the catalog (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let tables: TableRow[];

  beforeAll(async () => {
    t = await createMigratedDatabase();
    tables = (
      await t.pool.query<TableRow>(
        `select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                exists (select 1 from pg_attribute a
                         where a.attrelid = c.oid and a.attname = 'club_id' and not a.attisdropped) as has_club_id
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p')
          order by 1`,
      )
    ).rows;
  });

  afterAll(async () => {
    await t.close();
  });

  it('only the known global tables lack club_id', () => {
    expect(tables.filter((r) => !r.has_club_id).map((r) => r.table)).toEqual(GLOBAL_TABLES);
  });

  it('every table has RLS enabled and forced', () => {
    const missing = tables.filter((r) => !r.rls || !r.forced).map((r) => r.table);
    expect(missing).toEqual([]);
  });

  it('every club table isolates by club with a restrictive policy for the app and the worker', async () => {
    const { rows } = await t.pool.query<{
      table: string;
      policy: string;
      roles: string[];
      qual: string;
    }>(
      `select tablename as table, policyname as policy, roles::text[] as roles, qual
         from pg_policies
        where schemaname = 'public' and permissive = 'RESTRICTIVE' and cmd = 'ALL'`,
    );
    for (const table of tables.filter((r) => r.has_club_id).map((r) => r.table)) {
      for (const role of [DATABASE_ROLES.app, DATABASE_ROLES.worker]) {
        const policy = rows.find((p) => p.table === table && p.roles.includes(role));
        expect(policy, `${table} restrictive policy for ${role}`).toBeDefined();
        expect(policy?.qual, `${table} ${role}`).toContain('app.current_club_id()');
      }
    }
  });

  it('every policy targets one of the connection roles, never PUBLIC', async () => {
    const { rows } = await t.pool.query<{ policy: string; roles: string[] }>(
      `select policyname as policy, roles::text[] as roles from pg_policies where schemaname = 'public'`,
    );
    for (const row of rows) {
      expect(
        row.roles.every((r) => (ROLES as string[]).includes(r)),
        row.policy,
      ).toBe(true);
    }
  });

  it('the connection roles cannot log in, bypass RLS or own anything', async () => {
    const { rows } = await t.pool.query<Record<string, unknown>>(
      `select rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
         from pg_roles where rolname = any($1::text[]) order by 1`,
      [ROLES],
    );
    expect(rows).toHaveLength(ROLES.length);
    for (const row of rows) {
      expect(row).toEqual({
        rolname: row.rolname,
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
      });
    }
    const owned = await t.pool.query(
      `select 1 from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = any($1::text[])
       union all
       select 1 from pg_proc p join pg_roles r on r.oid = p.proowner where r.rolname = any($1::text[])
       union all
       select 1 from pg_namespace s join pg_roles r on r.oid = s.nspowner where r.rolname = any($1::text[])`,
      [ROLES],
    );
    expect(owned.rowCount).toBe(0);
  });

  it('grants no TRUNCATE, REFERENCES or TRIGGER, and DELETE only where planned', async () => {
    const { rows } = await t.pool.query<{ role: string; table: string; privilege: string }>(
      `select r.rolname as role, c.relname as table, p.privilege
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join pg_roles r
         cross join unnest(array['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p(privilege)
        where n.nspname in ('public', 'drizzle') and c.relkind in ('r', 'p', 'v', 'm')
          and r.rolname = any($1::text[])
          and has_table_privilege(r.oid, c.oid, p.privilege)
        order by 1, 2, 3`,
      [ROLES],
    );
    const expected = Object.entries(DELETABLE)
      .flatMap(([role, list]) => list.map((table) => ({ role, table, privilege: 'DELETE' })))
      .sort((x, y) => `${x.role}.${x.table}`.localeCompare(`${y.role}.${y.table}`));
    expect(rows).toEqual(expected);
    expect(rows.some((r) => r.table === 'test_result_value')).toBe(false);
  });

  it('identity and audit columns of club tables are never updatable', async () => {
    const { rows } = await t.pool.query<{ role: string; table: string; column: string }>(
      `select r.rolname as role, c.relname as table, a.attname as column
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
         cross join pg_roles r
        where n.nspname = 'public' and c.relkind = 'r'
          and r.rolname = any($1::text[])
          and a.attname = any($2::text[])
          and exists (select 1 from pg_attribute k where k.attrelid = c.oid and k.attname = 'club_id')
          and has_column_privilege(r.oid, c.oid, a.attnum, 'UPDATE')`,
      [ROLES, IMMUTABLE_COLUMNS],
    );
    expect(rows).toEqual([]);
  });

  it('the API and the worker have no access to sessions, accounts, verifications, attempt counters or known devices', async () => {
    const { rows } = await t.pool.query<{ role: string; table: string }>(
      `select r.rolname as role, c.relname as table
         from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join pg_roles r
        where n.nspname = 'public' and c.relname = any($2::text[])
          and r.rolname = any($1::text[])
          and has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE')`,
      [
        [DATABASE_ROLES.app, DATABASE_ROLES.worker],
        ['session', 'account', 'verification', 'auth_rate_limit', 'known_device', 'push_token'],
      ],
    );
    expect(rows).toEqual([]);
  });

  it('Better Auth only reaches the identity tables', async () => {
    const { rows } = await t.pool.query<{ table: string }>(
      `select c.relname as table
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and has_table_privilege($1, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
        order by 1`,
      [DATABASE_ROLES.auth],
    );
    expect(rows.map((r) => r.table)).toEqual(AUTH_TABLES);
  });

  it('schemas: no CREATE anywhere, no access to the migrations journal or the policy builder', async () => {
    const { rows } = await t.pool.query<{ role: string; schema: string; privilege: string }>(
      `select r.rolname as role, s.nspname as schema, p.privilege
         from pg_namespace s
         cross join pg_roles r
         cross join unnest(array['USAGE', 'CREATE']) as p(privilege)
        where s.nspname in ('public', 'app', 'app_admin', 'drizzle')
          and r.rolname = any($1::text[])
          and has_schema_privilege(r.oid, s.oid, p.privilege)
        order by 1, 2, 3`,
      [ROLES],
    );
    expect(rows).toEqual([
      { role: DATABASE_ROLES.app, schema: 'app', privilege: 'USAGE' },
      { role: DATABASE_ROLES.app, schema: 'public', privilege: 'USAGE' },
      { role: DATABASE_ROLES.auth, schema: 'public', privilege: 'USAGE' },
      { role: DATABASE_ROLES.worker, schema: 'app', privilege: 'USAGE' },
      { role: DATABASE_ROLES.worker, schema: 'public', privilege: 'USAGE' },
    ]);
  });

  it('SECURITY DEFINER functions pin their search_path and are not executable by PUBLIC', async () => {
    const { rows } = await t.pool.query<{
      fn: string;
      config: string[] | null;
      public_exec: boolean;
    }>(
      `select n.nspname || '.' || p.proname as fn, p.proconfig as config,
              has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef and n.nspname in ('public', 'app', 'app_admin')
        order by 1`,
    );
    expect(rows.map((r) => r.fn)).toEqual([
      'app.accept_invitation',
      'app.assigned_category_ids',
      'app.begin_support_access',
      'app.club_theme',
      'app.club_today',
      'app.current_consent_types',
      'app.current_role',
      'app.delete_own_account',
      'app.erase_player',
      'app.export_player_data',
      'app.guardian_children',
      'app.invitation_by_token',
      'app.is_superadmin',
      'app.percentile_samples',
      'app.player_takes_access_codes',
      'app.redeem_player_access',
      'app.register_push_token',
      'app.review_guardian',
      'app.support_access_entries',
      'app.sync_lock_rows',
      'app.sync_stamp_fields',
      'app.unregister_push_token',
      'app.visible_player_ids',
      'app.worker_clubs',
      'app.worker_forget_push_token',
      'app.worker_push_tokens',
      'app.worker_report_clubs',
      'public.alert_event_record',
      'public.alert_refresh_mark',
      'public.alert_refresh_trigger',
      'public.change_history_record',
      'public.derived_refresh_mark',
      'public.derived_refresh_trigger',
      'public.gym_set_program_guard',
      'public.player_sport_matches',
      'public.sync_change_record',
      'public.unit_matches_metric',
    ]);
    for (const row of rows) {
      expect(row.config, row.fn).toContain('search_path=pg_catalog, pg_temp');
      expect(row.public_exec, row.fn).toBe(false);
    }
  });

  it('only the worker reaches the job queue, without DDL (ADR 0046)', async () => {
    const schemas = await t.pool.query<{ role: string; privilege: string }>(
      `select r.rolname as role, p.privilege
         from pg_roles r cross join unnest(array['USAGE', 'CREATE']) as p(privilege)
        where r.rolname = any($1::text[]) and has_schema_privilege(r.oid, 'pgboss', p.privilege)
        order by 1, 2`,
      [ROLES],
    );
    expect(schemas.rows).toEqual([{ role: DATABASE_ROLES.worker, privilege: 'USAGE' }]);
    const tables = await t.pool.query<{ table: string; privilege: string }>(
      `select c.relname as table, p.privilege
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER']) as p(privilege)
        where n.nspname = 'pgboss' and c.relkind in ('r', 'p')
          and has_table_privilege($1, c.oid, p.privilege)`,
      [DATABASE_ROLES.worker],
    );
    expect(tables.rows).toEqual([]);
    const job = await t.pool.query<{ worker: boolean }>(
      `select has_table_privilege($1, 'pgboss.job', 'SELECT, INSERT, UPDATE, DELETE') as worker`,
      [DATABASE_ROLES.worker],
    );
    expect(job.rows[0]?.worker).toBe(true);
    const functions = await t.pool.query<{ fn: string }>(
      `select p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'pgboss' and (has_function_privilege('public', p.oid, 'EXECUTE')
              or has_function_privilege($1, p.oid, 'EXECUTE')
              or has_function_privilege($2, p.oid, 'EXECUTE'))`,
      [DATABASE_ROLES.app, DATABASE_ROLES.auth],
    );
    expect(functions.rows).toEqual([]);
  });

  it('the append-only guard of test_result_value covers every column of the table', async () => {
    // Review of #135: a column added later (HLC, tombstones, B-323) must be frozen by
    // test_result_value_guard or listed here as mutable on purpose.
    const mutable = ['updated_at', 'updated_by'];
    const { rows } = await t.pool.query<{ column: string; source: string }>(
      `select a.attname as column, pg_get_functiondef('public.test_result_value_guard'::regproc) as source
         from pg_attribute a
        where a.attrelid = 'public.test_result_value'::regclass and a.attnum > 0 and not a.attisdropped`,
    );
    const unguarded = rows
      .filter((r) => !mutable.includes(r.column) && !r.source.includes(`NEW.${r.column}`))
      .map((r) => r.column);
    expect(unguarded).toEqual([]);
  });

  it('the context functions read the settings the API writes', async () => {
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `select set_config('app.club_id', '7a3f0f0e-0000-4000-8000-000000000001', true),
                set_config('app.user_id', 'u-1', true), set_config('app.role', 'coach', true)`,
      );
      const { rows } = await client.query<{ club: string; user: string }>(
        'select app.current_club_id() as club, app.current_user_id() as user',
      );
      expect(rows[0]).toEqual({ club: '7a3f0f0e-0000-4000-8000-000000000001', user: 'u-1' });
      await client.query('commit');
      // After the transaction the settings read '' and the functions NULL.
      const after = await client.query<{
        club: string | null;
        user: string | null;
        role: string | null;
      }>(
        'select app.current_club_id() as club, app.current_user_id() as user, app.current_role() as role',
      );
      expect(after.rows[0]).toEqual({ club: null, user: null, role: null });
    } finally {
      client.release();
    }
  });
});
