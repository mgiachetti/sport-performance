import { randomUUID } from 'node:crypto';
import {
  AGE_OF_MAJORITY_YEARS,
  CONCUSSION_GRTP_STAGES,
  MEDICAL_ACCESS_ACTIONS,
} from '@sport-performance/domain';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE_ROLES } from './roles.js';
import { consent, player, playerCategory, staffAssignment, user } from './schema/index.js';
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
 * The `medical` schema (B-304, ADR 0008, ADR 0029) through real logins of the
 * connection roles: no read without a log row, writes only by the assigned
 * medical staff, availability without the cause for the rest, isolation
 * between clubs, an immutable log and the GRTP rules.
 */

const CLINICAL_TABLES = ['concussion', 'concussion_stage', 'hold', 'injury', 'note'];
const MEDICAL_TABLES = [...CLINICAL_TABLES, 'access_log'].sort();
const ENTRY_POINTS = [
  'availability',
  'may_write',
  'read_concussion_stages',
  'read_concussions',
  'read_holds',
  'read_injuries',
  'read_notes',
];

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'no error';
}

interface LogRow {
  actor_user_id: string | null;
  actor_role: string | null;
  db_role: string;
  action: string;
  resource: string;
  player_id: string | null;
  record_ids: string[];
  changed_columns: string[] | null;
  request_id: string | null;
  club_id: string;
}

describe.skipIf(!hasDatabase)('medical schema and audit (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let superadminId: string;
  /** M15 player of club A without a health consent. */
  let noConsent: string;

  const as = (club: ClubFixture, who: FixtureUser, extra: TestContext = {}): TestContext => ({
    clubId: club.clubId,
    userId: club.users[who],
    role: who === 'coachM17' ? 'coach' : who,
    ...extra,
  });
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);
  const code = (context: TestContext, sql: string, params: unknown[] = []) =>
    pgCode(run(context, (client) => client.query(sql, params)));

  async function select<T extends pg.QueryResultRow>(
    context: TestContext,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return run(context, async (client) => (await client.query<T>(sql, params)).rows);
  }

  async function logOf(requestId: string): Promise<LogRow[]> {
    const { rows } = await t.pool.query<LogRow>(
      `select actor_user_id, actor_role, db_role, action::text, resource, player_id, record_ids,
              changed_columns, request_id, club_id
         from medical.access_log where request_id = $1 order by occurred_at, player_id nulls first`,
      [requestId],
    );
    return rows;
  }

  const injurySql = `insert into medical.injury
      (id, club_id, player_id, onset_on, context, body_region, side, onset, mechanism, diagnosis)
      values ($1, $2, $3, '2026-03-10', 'match', 'knee', 'left', 'acute', 'contact', $4)`;

  /** An injury written by the medical staff of `club` for `playerId`; returns its id. */
  async function recordInjury(club: ClubFixture, playerId: string, diagnosis = 'Esguince LCM') {
    const id = randomUUID();
    await run(as(club, 'medical'), (client) =>
      client.query(injurySql, [id, club.clubId, playerId, diagnosis]),
    );
    return id;
  }

  async function recordHold(
    club: ClubFixture,
    playerId: string,
    hold: { training: string; match: string; from: string; to?: string; note?: string },
  ) {
    const id = randomUUID();
    await run(as(club, 'medical'), (client) =>
      client.query(
        `insert into medical.hold (id, club_id, player_id, training, match, valid_from, valid_to, staff_note)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          club.clubId,
          playerId,
          hold.training,
          hold.match,
          hold.from,
          hold.to ?? null,
          hold.note ?? null,
        ],
      ),
    );
    return id;
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'medical-a');
    b = await seedClubFixture(t.db, 'medical-b');
    for (const club of [a, b]) {
      // The fixture's medical user has no assignment: give it M15 (the assigned player).
      const { rows } = await t.pool.query<{ id: string }>(
        'select id from membership where club_id = $1 and user_id = $2',
        [club.clubId, club.users.medical],
      );
      await t.db.insert(staffAssignment).values({
        clubId: club.clubId,
        membershipId: must(rows[0]).id,
        categoryId: must(club.rows.category) as never,
        validFrom: '2020-01-01' as never,
      });
      await t.db.insert(consent).values({
        clubId: club.clubId,
        playerId: club.players.assigned,
        type: 'health',
        documentVersion: '2026-01',
        signerKind: 'guardian',
        signedBy: club.users.parent,
      });
    }
    noConsent = must(
      (
        await t.db
          .insert(player)
          .values({
            clubId: a.clubId,
            firstName: 'Tomás',
            lastName: 'Sin consentimiento',
            birthDate: '2011-08-01' as never,
            sex: 'male',
            joinedOn: '2020-01-01' as never,
          })
          .returning({ id: player.id })
      )[0],
    ).id;
    await t.db.insert(playerCategory).values({
      clubId: a.clubId,
      playerId: noConsent as never,
      categoryId: must(a.rows.category) as never,
      validFrom: '2020-01-01' as never,
    });
    superadminId = must(
      (
        await t.db
          .insert(user)
          .values({ name: 'Soporte', email: 'soporte@medical.example.com', isSuperadmin: true })
          .returning({ id: user.id })
      )[0],
    ).id;
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await t.close();
  });

  describe('catalog', () => {
    it('every medical table has RLS enabled and forced', async () => {
      const { rows } = await t.pool.query<{ table: string; rls: boolean; forced: boolean }>(
        `select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'medical' and c.relkind = 'r' order by 1`,
      );
      expect(rows.map((r) => r.table)).toEqual(MEDICAL_TABLES);
      expect(rows.filter((r) => !r.rls || !r.forced)).toEqual([]);
    });

    it('the API reads no clinical column: SELECT only on id, nothing on the log', async () => {
      const { rows } = await t.pool.query<{ role: string; table: string; column: string }>(
        `select r.rolname as role, c.relname as table, a.attname as column
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           cross join pg_roles r
          where n.nspname in ('medical', 'support') and c.relkind = 'r'
            and r.rolname = any($1::text[])
            and has_column_privilege(r.oid, c.oid, a.attnum, 'SELECT')
          order by 1, 2, 3`,
        [Object.values(DATABASE_ROLES)],
      );
      expect(rows).toEqual(
        CLINICAL_TABLES.map((table) => ({ role: DATABASE_ROLES.app, table, column: 'id' })),
      );
    });

    it('nobody deletes, truncates, references or triggers, and the logs take no writes', async () => {
      const { rows } = await t.pool.query<{ role: string; table: string; privilege: string }>(
        `select r.rolname as role, n.nspname || '.' || c.relname as table, p.privilege
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           cross join pg_roles r
           cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p(privilege)
          where n.nspname in ('medical', 'support') and c.relkind = 'r'
            and r.rolname = any($1::text[])
            and (has_table_privilege(r.oid, c.oid, p.privilege)
                 or (p.privilege = 'UPDATE' and has_any_column_privilege(r.oid, c.oid, 'UPDATE')))
          order by 1, 2, 3`,
        [Object.values(DATABASE_ROLES)],
      );
      const expected = CLINICAL_TABLES.flatMap((table) => [
        { role: DATABASE_ROLES.app, table: `medical.${table}`, privilege: 'INSERT' },
        // Clinical notes are append-only.
        ...(table === 'note'
          ? []
          : [{ role: DATABASE_ROLES.app, table: `medical.${table}`, privilege: 'UPDATE' }]),
      ]);
      expect(rows).toEqual(expected);
    });

    it('identity columns and the player of a medical row are never updatable', async () => {
      const { rows } = await t.pool.query(
        `select c.relname, a.attname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          where n.nspname = 'medical' and c.relkind = 'r'
            and a.attname in ('id', 'club_id', 'created_at', 'created_by', 'client_uuid', 'player_id')
            and has_column_privilege($1, c.oid, a.attnum, 'UPDATE')`,
        [DATABASE_ROLES.app],
      );
      expect(rows).toEqual([]);
    });

    it('only the API reaches the medical schema, and nobody the support schema', async () => {
      const { rows } = await t.pool.query<{ role: string; schema: string; privilege: string }>(
        `select r.rolname as role, s.nspname as schema, p.privilege
           from pg_namespace s cross join pg_roles r
           cross join unnest(array['USAGE', 'CREATE']) as p(privilege)
          where s.nspname in ('medical', 'support') and r.rolname = any($1::text[])
            and has_schema_privilege(r.oid, s.oid, p.privilege)`,
        [Object.values(DATABASE_ROLES)],
      );
      expect(rows).toEqual([{ role: DATABASE_ROLES.app, schema: 'medical', privilege: 'USAGE' }]);
    });

    it('the API executes only the entry points; definer functions pin their search_path', async () => {
      const { rows } = await t.pool.query<{
        fn: string;
        definer: boolean;
        config: string[] | null;
        public_exec: boolean;
        app_exec: boolean;
        worker_exec: boolean;
      }>(
        `select p.proname as fn, p.prosecdef as definer, p.proconfig as config,
                has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
                has_function_privilege($1, p.oid, 'EXECUTE') as app_exec,
                has_function_privilege($2, p.oid, 'EXECUTE') as worker_exec
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'medical' order by 1`,
        [DATABASE_ROLES.app, DATABASE_ROLES.worker],
      );
      expect(rows.filter((r) => r.app_exec).map((r) => r.fn)).toEqual(ENTRY_POINTS);
      for (const row of rows) {
        expect(row.public_exec, row.fn).toBe(false);
        expect(row.worker_exec, row.fn).toBe(false);
        expect(row.definer, row.fn).toBe(true);
        expect(row.config, row.fn).toContain('search_path=pg_catalog, pg_temp');
      }
    });

    it('every clinical table isolates by club and logs and stamps every write', async () => {
      const policies = await t.pool.query<{ table: string; qual: string }>(
        `select tablename as table, qual from pg_policies
          where schemaname = 'medical' and permissive = 'RESTRICTIVE' and cmd = 'ALL'
            and roles = array[$1]::name[]`,
        [DATABASE_ROLES.app],
      );
      const triggers = await t.pool.query<{ table: string; fn: string }>(
        `select c.relname as table, p.proname as fn from pg_trigger tg
           join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
           join pg_proc p on p.oid = tg.tgfoid
          where n.nspname = 'medical' and not tg.tgisinternal`,
      );
      for (const table of CLINICAL_TABLES) {
        expect(policies.rows.find((p) => p.table === table)?.qual, table).toContain(
          'app.current_club_id()',
        );
        const fns = triggers.rows.filter((r) => r.table === table).map((r) => r.fn);
        expect(fns, table).toEqual(expect.arrayContaining(['log_write', 'set_updated_at']));
      }
      const logTriggers = triggers.rows.filter((r) => r.table === 'access_log').map((r) => r.fn);
      expect(logTriggers).toEqual(['reject_log_change', 'reject_log_change']);
    });

    it('the log vocabulary is the domain one', async () => {
      const { rows } = await t.pool.query<{ labels: string[] }>(
        `select enum_range(null::medical.access_action)::text[] as labels`,
      );
      expect(rows[0]?.labels).toEqual([...MEDICAL_ACCESS_ACTIONS]);
    });

    it('a minor is under the age of majority of the domain', async () => {
      const { rows } = await t.pool.query<{ src: string }>(
        `select prosrc as src from pg_proc where oid = 'medical.is_minor(uuid)'::regprocedure`,
      );
      expect(rows[0]?.src).toContain(`interval '${String(AGE_OF_MAJORITY_YEARS)} years'`);
    });
  });

  describe('writes', () => {
    it('the assigned medical staff records an injury and the write is logged', async () => {
      const id = randomUUID();
      const requestId = `req-${randomUUID()}`;
      await run(as(a, 'medical', { requestId }), (client) =>
        client.query(injurySql, [id, a.clubId, a.players.assigned, 'Rotura de LCA']),
      );
      expect(await logOf(requestId)).toEqual([
        {
          actor_user_id: a.users.medical,
          actor_role: 'medical',
          db_role: app.login,
          action: 'insert',
          resource: 'injury',
          player_id: a.players.assigned,
          record_ids: [id],
          changed_columns: null,
          request_id: requestId,
          club_id: a.clubId,
        },
      ]);

      const updateRequest = `req-${randomUUID()}`;
      await run(as(a, 'medical', { requestId: updateRequest }), async (client) => {
        const updated = await client.query(
          `update medical.injury set returned_on = '2026-04-01', diagnosis = 'Rotura parcial de LCA', updated_by = $2 where id = $1`,
          [id, a.users.medical],
        );
        expect(updated.rowCount).toBe(1);
      });
      const [entry] = await logOf(updateRequest);
      expect(entry).toMatchObject({ action: 'update', record_ids: [id] });
      // Column names, never values.
      expect(entry?.changed_columns).toEqual(['diagnosis', 'returned_on', 'updated_by']);
      expect(JSON.stringify(await logOf(updateRequest))).not.toContain('LCA');
    });

    it('denies writes outside the assignment, without a health consent or by another role', async () => {
      const other = randomUUID();
      // Not assigned (M17).
      expect(await code(as(a, 'medical'), injurySql, [other, a.clubId, a.players.other, 'x'])).toBe(
        '42501',
      );
      // Assigned, without a health consent: no injury…
      expect(await code(as(a, 'medical'), injurySql, [other, a.clubId, noConsent, 'x'])).toBe(
        '42501',
      );
      // …but a block protects the player and needs no consent (matrix: medical_block).
      await recordHold(a, noConsent, {
        training: 'limited',
        match: 'unavailable',
        from: '2026-03-01',
        to: '2026-03-05',
      });
      for (const who of ['admin', 'coach', 'sc', 'player', 'parent'] as const) {
        expect(
          await code(as(a, who), injurySql, [randomUUID(), a.clubId, a.players.assigned, 'x']),
          who,
        ).toBe('42501');
      }
      expect(
        await code(
          { clubId: a.clubId, userId: superadminId, role: 'superadmin', supportReason: 'Soporte' },
          injurySql,
          [randomUUID(), a.clubId, a.players.assigned, 'x'],
        ),
      ).toBe('42501');
    });

    it('needs a request id', async () => {
      expect(
        await code(as(a, 'medical', { requestId: null }), injurySql, [
          randomUUID(),
          a.clubId,
          a.players.assigned,
          'x',
        ]),
      ).toBe('42501');
    });

    it('nothing is deleted and clinical notes are append-only', async () => {
      const injury = await recordInjury(a, a.players.assigned);
      expect(
        await code(as(a, 'medical'), 'delete from medical.injury where id = $1', [injury]),
      ).toBe('42501');
      const note = randomUUID();
      await run(as(a, 'medical'), (client) =>
        client.query(
          `insert into medical.note (id, club_id, player_id, body, injury_id) values ($1, $2, $3, 'Control a las 48 h', $4)`,
          [note, a.clubId, a.players.assigned, injury],
        ),
      );
      expect(
        await code(as(a, 'medical'), `update medical.note set body = 'x' where id = $1`, [note]),
      ).toBe('42501');
      // A correction amends the note, for the same player only.
      await run(as(a, 'medical'), (client) =>
        client.query(
          `insert into medical.note (club_id, player_id, body, amends_note_id) values ($1, $2, 'Control a las 72 h', $3)`,
          [a.clubId, a.players.assigned, note],
        ),
      );
      expect(
        await pgCode(
          t.pool.query(
            `insert into medical.note (club_id, player_id, body, amends_note_id) values ($1, $2, 'x', $3)`,
            [a.clubId, noConsent, note],
          ),
        ),
      ).toBe('23503');
    });

    it('a block is lifted by the user who lifts it, and stays lifted', async () => {
      const hold = await recordHold(a, a.players.assigned, {
        training: 'unavailable',
        match: 'unavailable',
        from: '2026-02-01',
      });
      expect(
        await code(
          as(a, 'medical'),
          `update medical.hold set valid_to = '2026-02-10', lifted_at = now(), lifted_by = $2 where id = $1`,
          [hold, a.users.admin],
        ),
      ).toBe('23514');
      await run(as(a, 'medical'), (client) =>
        client.query(
          `update medical.hold set valid_to = '2026-02-10', lifted_at = now(), lifted_by = $2 where id = $1`,
          [hold, a.users.medical],
        ),
      );
      expect(
        await code(
          as(a, 'medical'),
          `update medical.hold set valid_to = null, lifted_at = null, lifted_by = null where id = $1`,
          [hold],
        ),
      ).toBe('23514');
    });

    it('the API cannot read medical tables directly, not even the medical staff', async () => {
      for (const table of CLINICAL_TABLES) {
        for (const sql of [
          `select * from medical.${table}`,
          `select player_id from medical.${table}`,
        ]) {
          expect(await code(as(a, 'medical'), sql), sql).toBe('42501');
        }
      }
      expect(await code(as(a, 'medical'), 'select * from medical.access_log')).toBe('42501');
      // Nor probe values through an update's filter or expressions.
      for (const sql of [
        `update medical.injury set updated_at = now() where diagnosis like '%LCA%'`,
        'update medical.injury set expected_return_on = returned_on',
      ]) {
        expect(await code(as(a, 'medical'), sql), sql).toBe('42501');
      }
      // Inserting with RETURNING would read the row back.
      expect(
        await code(as(a, 'medical'), `${injurySql} returning diagnosis`, [
          randomUUID(),
          a.clubId,
          a.players.assigned,
          'x',
        ]),
      ).toBe('42501');
    });

    it('the worker does not reach the medical schema', async () => {
      for (const sql of ['select id from medical.injury', 'select * from medical.availability()']) {
        expect(
          await pgCode(inContext(worker.pool, { clubId: a.clubId }, (client) => client.query(sql))),
          sql,
        ).toBe('42501');
      }
    });
  });

  describe('reads', () => {
    let injuryA: string;
    let injuryB: string;
    let sharedNote: string;
    let medicalNote: string;

    beforeAll(async () => {
      injuryA = await recordInjury(a, a.players.assigned, 'Desgarro isquiotibial');
      injuryB = await recordInjury(b, b.players.assigned, 'Fractura de clavícula');
      sharedNote = randomUUID();
      medicalNote = randomUUID();
      await run(as(a, 'medical'), async (client) => {
        await client.query(
          `insert into medical.note (id, club_id, player_id, body, visibility) values ($1, $2, $3, 'Plan de vuelta para la familia', 'shared')`,
          [sharedNote, a.clubId, a.players.assigned],
        );
        await client.query(
          `insert into medical.note (id, club_id, player_id, body) values ($1, $2, $3, 'Nota interna')`,
          [medicalNote, a.clubId, a.players.assigned],
        );
      });
    });

    const injuryIds = (context: TestContext, args = '') =>
      select<{ id: string }>(context, `select id from medical.read_injuries(${args})`).then(
        (rows) => rows.map((r) => r.id),
      );

    it('the medical staff reads its assigned players, and every read is logged', async () => {
      const requestId = `req-${randomUUID()}`;
      const ids = await injuryIds(as(a, 'medical', { requestId }));
      expect(ids).toContain(injuryA);
      expect(ids).not.toContain(injuryB);
      const log = await logOf(requestId);
      expect(log.length).toBeGreaterThan(0);
      for (const entry of log) {
        expect(entry).toMatchObject({
          action: 'read',
          resource: 'injury',
          actor_user_id: a.users.medical,
          actor_role: 'medical',
          db_role: app.login,
          club_id: a.clubId,
        });
      }
      const own = log.find((r) => r.player_id === a.players.assigned);
      expect(own?.record_ids).toEqual(expect.arrayContaining([injuryA]));
      expect(new Set(log.flatMap((r) => r.record_ids))).toEqual(new Set(ids));
    });

    it('logs a read that finds nothing, and the players asked for', async () => {
      // The medical staff of B asks for a player of A: nothing comes back, the attempt stays.
      const requestId = `req-${randomUUID()}`;
      const ids = await injuryIds(
        as(b, 'medical', { requestId }),
        `array[$$${a.players.assigned}$$]::uuid[]`,
      );
      expect(ids).toEqual([]);
      expect(await logOf(requestId)).toEqual([
        expect.objectContaining({
          player_id: a.players.assigned,
          record_ids: [],
          club_id: b.clubId,
        }),
      ]);
      // A medical user without assignment: one row without player.
      const unassigned = `req-${randomUUID()}`;
      await t.pool.query(
        'delete from staff_assignment where membership_id in (select id from membership where user_id = $1)',
        [b.users.medical],
      );
      try {
        expect(await injuryIds(as(b, 'medical', { requestId: unassigned }))).toEqual([]);
        expect(await logOf(unassigned)).toEqual([
          expect.objectContaining({ player_id: null, record_ids: [], resource: 'injury' }),
        ]);
      } finally {
        const { rows } = await t.pool.query<{ id: string }>(
          'select id from membership where club_id = $1 and user_id = $2',
          [b.clubId, b.users.medical],
        );
        await t.db.insert(staffAssignment).values({
          clubId: b.clubId,
          membershipId: must(rows[0]).id,
          categoryId: must(b.rows.category) as never,
          validFrom: '2020-01-01' as never,
        });
      }
    });

    it.each(['admin', 'coach', 'coachM17', 'sc'] as const)(
      '%s cannot read any clinical record',
      async (who) => {
        for (const fn of [
          'read_injuries',
          'read_concussions',
          'read_concussion_stages',
          'read_holds',
          'read_notes',
        ]) {
          expect(await code(as(a, who), `select * from medical.${fn}()`), fn).toBe('42501');
        }
      },
    );

    it('a superadmin cannot read clinical records either', async () => {
      expect(
        await code(
          { clubId: a.clubId, userId: superadminId, role: 'superadmin', supportReason: 'Soporte' },
          'select * from medical.read_injuries()',
        ),
      ).toBe('42501');
    });

    it('the holder reads their own record with a health consent, only shared notes', async () => {
      for (const who of ['player', 'parent'] as const) {
        expect(await injuryIds(as(a, who)), who).toContain(injuryA);
        const notes = await select<{ id: string }>(
          as(a, who),
          'select id from medical.read_notes()',
        );
        expect(
          notes.map((n) => n.id),
          who,
        ).toEqual([sharedNote]);
        expect(await code(as(a, who), 'select * from medical.read_holds()'), who).toBe('42501');
      }
      const notes = await select<{ id: string }>(
        as(a, 'medical'),
        'select id from medical.read_notes()',
      );
      expect(notes.map((n) => n.id)).toEqual(expect.arrayContaining([sharedNote, medicalNote]));
    });

    it('without a current health consent, or once the player is of age for the guardian, nothing', async () => {
      await t.pool.query(
        `update consent set revoked_at = now(), revoked_by = signed_by where club_id = $1 and player_id = $2 and type = 'health'`,
        [a.clubId, a.players.assigned],
      );
      try {
        expect(await injuryIds(as(a, 'player'))).toEqual([]);
        expect(await injuryIds(as(a, 'parent'))).toEqual([]);
        // The medical staff still reads (the matrix asks the consent for writing).
        expect(await injuryIds(as(a, 'medical'))).toContain(injuryA);
      } finally {
        await t.db.insert(consent).values({
          clubId: a.clubId,
          playerId: a.players.assigned,
          type: 'health',
          documentVersion: '2026-02',
          signerKind: 'guardian',
          signedBy: a.users.parent,
        });
      }
      await t.pool.query(`update player set birth_date = '2000-01-01' where id = $1`, [
        a.players.assigned,
      ]);
      try {
        expect(await injuryIds(as(a, 'parent'))).toEqual([]);
        expect(await injuryIds(as(a, 'player'))).toContain(injuryA);
      } finally {
        await t.pool.query(`update player set birth_date = '2011-05-04' where id = $1`, [
          a.players.assigned,
        ]);
      }
    });

    it('needs a validated context and a request id', async () => {
      expect(
        await code(as(a, 'medical', { requestId: null }), 'select * from medical.read_injuries()'),
      ).toBe('42501');
      expect(await code({}, 'select * from medical.read_injuries()')).toBe('42501');
      expect(
        await code(as(a, 'coach', { role: 'medical' }), 'select * from medical.read_injuries()'),
      ).toBe('42501');
    });
  });

  describe('availability', () => {
    let held: string;

    beforeAll(async () => {
      // Club B: a block for the assigned player over March, with a note for the staff.
      held = await recordHold(b, b.players.assigned, {
        training: 'limited',
        match: 'unavailable',
        from: '2026-03-01',
        to: '2026-04-01',
        note: 'Sin contacto',
      });
    });

    interface Availability {
      player_id: string;
      training: string;
      match: string;
      overall: string;
      staff_notes: string[];
    }
    const availability = (context: TestContext, onDate: string, playerIds?: string[]) =>
      select<Availability & Record<string, unknown>>(
        context,
        `select player_id, on_date::text as on_date, training, match, overall, staff_notes
           from medical.availability($1::uuid[], $2::date)`,
        [playerIds ?? null, onDate],
      );

    it('shows the status for training and match, and the staff note, never the cause', async () => {
      const rows = await availability(as(b, 'coach'), '2026-03-15');
      const row = rows.find((r) => r.player_id === b.players.assigned);
      expect(row).toEqual({
        player_id: b.players.assigned,
        on_date: '2026-03-15',
        training: 'limited',
        match: 'unavailable',
        overall: 'unavailable',
        staff_notes: ['Sin contacto'],
      });
      expect(Object.keys(must(row)).sort()).toEqual(
        ['match', 'on_date', 'overall', 'player_id', 'staff_notes', 'training'].sort(),
      );
      // Outside the block: available.
      expect((await availability(as(b, 'coach'), '2026-04-01'))[0]).toMatchObject({
        player_id: b.players.assigned,
        overall: 'available',
        staff_notes: [],
      });
      expect(held).toBeDefined();
    });

    it('each role sees the availability of the players it may see', async () => {
      const day = '2026-03-15';
      const playersOf = async (context: TestContext) =>
        (await availability(context, day)).map((r) => r.player_id).sort();
      expect(await playersOf(as(b, 'coach'))).toEqual([b.players.assigned]);
      expect(await playersOf(as(b, 'coachM17'))).toEqual([b.players.other]);
      expect(await playersOf(as(b, 'player'))).toEqual([b.players.assigned]);
      expect(await playersOf(as(b, 'parent'))).toEqual([b.players.assigned]);
      expect(await playersOf(as(b, 'admin'))).toEqual([b.players.assigned, b.players.other].sort());
      expect(await playersOf(as(b, 'sc'))).toEqual([b.players.assigned, b.players.other].sort());
      // A player of another club, asked for explicitly: nothing.
      expect(await availability(as(b, 'admin'), day, [a.players.assigned])).toEqual([]);
    });

    it('a superadmin sees it only with a recorded support access, and is logged', async () => {
      const requestId = `req-${randomUUID()}`;
      const support = { clubId: b.clubId, userId: superadminId, role: 'superadmin' };
      expect(await pgCode(availability(support, '2026-03-15'))).toBe('42501');
      const rows = await availability(
        { ...support, supportReason: 'Ticket 7', requestId },
        '2026-03-15',
      );
      expect(rows).toHaveLength(2);
      const log = await logOf(requestId);
      expect(log.map((r) => r.player_id).sort()).toEqual(
        [b.players.assigned, b.players.other].sort(),
      );
      for (const entry of log) {
        expect(entry).toMatchObject({
          actor_role: 'superadmin',
          actor_user_id: superadminId,
          resource: 'availability',
          action: 'read',
          record_ids: [],
        });
      }
    });

    it('logs one read row per player returned', async () => {
      const requestId = `req-${randomUUID()}`;
      await availability(as(b, 'coach', { requestId }), '2026-03-15');
      expect(await logOf(requestId)).toEqual([
        expect.objectContaining({
          player_id: b.players.assigned,
          resource: 'availability',
          actor_user_id: b.users.coach,
          actor_role: 'coach',
        }),
      ]);
    });

    it('follows the graduated return to play after a concussion', async () => {
      const concussion = randomUUID();
      const medical = as(b, 'medical');
      const insertStage = (
        stage: number,
        startedOn: string,
        outcome = 'in_progress',
        endedOn: string | null = null,
      ) =>
        run(medical, (client) =>
          client.query(
            `insert into medical.concussion_stage (club_id, player_id, concussion_id, stage, started_on, outcome, ended_on)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [b.clubId, b.players.assigned, concussion, stage, startedOn, outcome, endedOn],
          ),
        );
      const statusOn = async (day: string) =>
        must(
          (await availability(as(b, 'coach'), day)).find((r) => r.player_id === b.players.assigned),
        );

      await run(medical, (client) =>
        client.query(
          `insert into medical.concussion (id, club_id, player_id, occurred_on, context, protocol_version)
           values ($1, $2, $3, '2026-05-02', 'match', '2023')`,
          [concussion, b.clubId, b.players.assigned],
        ),
      );
      // No stage yet: rest.
      expect(await statusOn('2026-05-02')).toMatchObject({
        training: 'unavailable',
        match: 'unavailable',
      });

      // Stages go one at a time.
      expect(await pgCode(insertStage(2, '2026-05-03'))).toBe('23514');
      await insertStage(1, '2026-05-03', 'passed', '2026-05-05');
      expect(await pgCode(insertStage(3, '2026-05-06'))).toBe('23514');
      // A stage cannot start before the previous one ended.
      expect(await pgCode(insertStage(2, '2026-05-04'))).toBe('23514');
      await insertStage(2, '2026-05-06', 'passed', '2026-05-07');
      expect(await statusOn('2026-05-07')).toMatchObject({
        training: 'limited',
        match: 'unavailable',
      });

      // Symptoms at stage 3: back to stage 2, resting meanwhile.
      await insertStage(3, '2026-05-08', 'symptomatic', '2026-05-09');
      expect(await statusOn('2026-05-09')).toMatchObject({
        training: 'unavailable',
        match: 'unavailable',
      });
      expect(await pgCode(insertStage(4, '2026-05-10'))).toBe('23514');
      await insertStage(2, '2026-05-10', 'passed', '2026-05-11');
      await insertStage(3, '2026-05-12', 'passed', '2026-05-13');
      await insertStage(4, '2026-05-14', 'passed', '2026-05-15');

      // Clearance needs stage 5 passed.
      const clear = (by: string, on = '2026-05-18') =>
        run(medical, (client) =>
          client.query(
            `update medical.concussion set cleared_on = $2, cleared_by = $3 where id = $1`,
            [concussion, on, by],
          ),
        );
      expect(await pgCode(clear(b.users.medical))).toBe('23514');
      await insertStage(5, '2026-05-16');
      // A stage in progress is not passed.
      expect(await pgCode(clear(b.users.medical))).toBe('23514');
      const { rows } = await t.pool.query<{ id: string }>(
        `select id from medical.concussion_stage where concussion_id = $1 and stage = 5`,
        [concussion],
      );
      await run(medical, (client) =>
        client.query(
          `update medical.concussion_stage set outcome = 'passed', ended_on = '2026-05-17' where id = $1`,
          [must(rows[0]).id],
        ),
      );
      // A closed stage never changes.
      expect(
        await code(
          medical,
          `update medical.concussion_stage set outcome = 'symptomatic' where id = $1`,
          [must(rows[0]).id],
        ),
      ).toBe('23514');
      expect(await statusOn('2026-05-17')).toMatchObject({
        training: 'limited',
        match: 'unavailable',
      });

      // Signed by the doctor who gives it, not before the end of stage 5.
      expect(await pgCode(clear(b.users.admin))).toBe('23514');
      expect(await pgCode(clear(b.users.medical, '2026-05-16'))).toBe('23514');
      await clear(b.users.medical);
      expect(await statusOn('2026-05-17')).toMatchObject({ match: 'unavailable' });
      // The March block has ended by then: available.
      expect(await statusOn('2026-05-18')).toMatchObject({
        training: 'available',
        match: 'available',
        overall: 'available',
      });

      // Final, and no more stages.
      expect(await pgCode(clear(b.users.medical, '2026-05-20'))).toBe('23514');
      expect(await pgCode(insertStage(1, '2026-05-21'))).toBe('23514');

      // The SQL rule is the domain's one.
      for (const definition of CONCUSSION_GRTP_STAGES.slice(0, 5)) {
        expect(definition.match).toBe('unavailable');
      }
    });

    it('a block lifted on the day it starts no longer blocks that day', async () => {
      const { rows } = await t.pool.query<{ today: string; tomorrow: string }>(
        `select d::text as today, (d + 1)::text as tomorrow
           from (select (now() at time zone time_zone)::date as d from club where id = $1) x`,
        [b.clubId],
      );
      const { today, tomorrow } = must(rows[0]);
      const statusToday = async () =>
        must(
          (await availability(as(b, 'coach'), today)).find(
            (r) => r.player_id === b.players.assigned,
          ),
        );
      const hold = await recordHold(b, b.players.assigned, {
        training: 'unavailable',
        match: 'unavailable',
        from: today,
      });
      expect(await statusToday()).toMatchObject({ overall: 'unavailable' });
      // valid_to must be after valid_from: the earliest is tomorrow.
      await run(as(b, 'medical'), (client) =>
        client.query(
          `update medical.hold set valid_to = $2, lifted_at = now(), lifted_by = $3 where id = $1`,
          [hold, tomorrow, b.users.medical],
        ),
      );
      expect(await statusToday()).toMatchObject({
        training: 'available',
        match: 'available',
        overall: 'available',
      });
    });

    it('the stages of a concussion belong to its player', async () => {
      const concussion = randomUUID();
      await run(as(a, 'medical'), (client) =>
        client.query(
          `insert into medical.concussion (id, club_id, player_id, occurred_on, context, protocol_version)
           values ($1, $2, $3, '2026-05-02', 'training', '2023')`,
          [concussion, a.clubId, a.players.assigned],
        ),
      );
      expect(
        await pgCode(
          t.pool.query(
            `insert into medical.concussion_stage (club_id, player_id, concussion_id, stage, started_on)
             values ($1, $2, $3, 1, '2026-05-03')`,
            [a.clubId, noConsent, concussion],
          ),
        ),
      ).toBe('23503');
    });
  });

  describe('isolation between clubs', () => {
    it('the medical staff of A cannot write rows of club B or move rows across', async () => {
      // A row for club B written from A's context: the restrictive policy rejects it.
      expect(
        await code(as(a, 'medical'), injurySql, [randomUUID(), b.clubId, b.players.assigned, 'x']),
      ).toBe('42501');
      // A player of B in a row of A: the composite key rejects it.
      expect(
        await pgCode(t.pool.query(injurySql, [randomUUID(), a.clubId, b.players.assigned, 'x'])),
      ).toBe('23503');
      const foreign = await recordInjury(b, b.players.assigned);
      await run(as(a, 'medical'), async (client) => {
        const updated = await client.query(
          `update medical.injury set returned_on = '2026-06-01' where id = $1`,
          [foreign],
        );
        expect(updated.rowCount).toBe(0);
      });
      const own = await recordInjury(a, a.players.assigned);
      expect(
        await code(as(a, 'medical'), `update medical.injury set club_id = $2 where id = $1`, [
          own,
          b.clubId,
        ]),
      ).toBe('42501');
    });

    it('reads of one club never return rows of another', async () => {
      for (const [own, foreign] of [
        [a, b],
        [b, a],
      ] as const) {
        for (const fn of [
          'read_injuries',
          'read_concussions',
          'read_concussion_stages',
          'read_holds',
          'read_notes',
        ]) {
          const rows = await select<{ club_id: string }>(
            as(own, 'medical'),
            `select club_id from medical.${fn}()`,
          );
          expect(
            rows.every((r) => r.club_id === own.clubId),
            fn,
          ).toBe(true);
          const asked = await select(
            as(own, 'medical'),
            `select * from medical.${fn}($1::uuid[])`,
            [[foreign.players.assigned]],
          );
          expect(asked, fn).toEqual([]);
        }
      }
    });
  });

  describe('the access log', () => {
    it('is append-only for everyone, the owner included', async () => {
      for (const sql of [
        'update medical.access_log set resource = $$x$$',
        'delete from medical.access_log',
        'truncate medical.access_log',
      ]) {
        expect(await code(as(a, 'medical'), sql), sql).toBe('42501');
        expect(await pgCode(t.pool.query(sql)), `owner: ${sql}`).toBe('42501');
      }
      const { rows } = await t.pool.query<{ n: number }>(
        'select count(*)::int as n from medical.access_log',
      );
      expect(must(rows[0]).n).toBeGreaterThan(0);
    });

    it("logs the owner's maintenance writes too", async () => {
      const id = randomUUID();
      await t.pool.query(injurySql, [id, a.clubId, a.players.assigned, 'Carga histórica']);
      const { rows } = await t.pool.query<LogRow>(
        `select * from medical.access_log where $1 = any (record_ids)`,
        [id],
      );
      expect(rows).toEqual([
        expect.objectContaining({
          action: 'insert',
          actor_user_id: null,
          actor_role: null,
          request_id: null,
        }),
      ]);
    });

    it('rolls back with the access it records', async () => {
      const requestId = `req-${randomUUID()}`;
      await expect(
        run(as(a, 'medical', { requestId }), async (client) => {
          await client.query('select * from medical.read_injuries()');
          throw new Error('handler failed');
        }),
      ).rejects.toThrow('handler failed');
      // Nothing was returned to anyone: neither the data nor its log row survive.
      expect(await logOf(requestId)).toEqual([]);
    });
  });

  describe('test results not done because of an injury', () => {
    it('read as unavailable by everyone but the medical staff', async () => {
      const sql = `select app.not_done_reason_for_viewer('injured') as injured, app.not_done_reason_for_viewer('absent') as absent`;
      for (const who of ['admin', 'coach', 'sc', 'player', 'parent'] as const) {
        expect(await select(as(a, who), sql), who).toEqual([
          { injured: 'unavailable', absent: 'absent' },
        ]);
      }
      expect(await select(as(a, 'medical'), sql)).toEqual([
        { injured: 'injured', absent: 'absent' },
      ]);
      expect(await select({}, sql)).toEqual([{ injured: 'unavailable', absent: 'absent' }]);
    });
  });
});
