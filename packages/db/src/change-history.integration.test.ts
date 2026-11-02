import {
  CHANGE_REASON_MAX_LENGTH,
  CHANGE_TRACKED_TABLES,
  type PlayerId,
} from '@sport-performance/domain';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';
import {
  ChangeContextError,
  listPlayerChangeHistory,
  listRecordChangeHistory,
  setChangeContext,
  type ChangeContext,
  type ChangeHistoryEntry,
} from './history.js';
import { DATABASE_ROLES } from './roles.js';
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
import { seedClubFixture, type ClubFixture, type FixtureUser } from './testing/tenant-fixture.js';

/**
 * Change history (B-305, ADR 0030) through real logins of the connection
 * roles: what is recorded, when a reason is required, who reads it, and that
 * nobody can forge, edit or erase it.
 */

const REQUEST_ID = 'req-0192e7a0-5c1a-7b7e';

describe.skipIf(!hasDatabase)('change history (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let superadminId: string;

  const as = (who: FixtureUser, club: ClubFixture = a): TestContext => ({
    clubId: club.clubId,
    userId: club.users[who],
    role: who === 'coachM17' ? 'coach' : who,
  });

  /** Runs `work` as the API would: tenant context, then the change context, then the writes. */
  function write<T>(
    context: TestContext,
    change: ChangeContext,
    work: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    return inContext(app.pool, context, async (client) => {
      await setChangeContext(createDatabase(client), change);
      return work(client);
    });
  }

  function recordHistory(
    context: TestContext,
    tableName: (typeof CHANGE_TRACKED_TABLES)[number],
    recordId: string,
    pool: pg.Pool = app.pool,
  ): Promise<readonly ChangeHistoryEntry[]> {
    return inContext(pool, context, async (client) => {
      const page = await listRecordChangeHistory(createDatabase(client), { tableName, recordId });
      return page.entries;
    });
  }

  /** History rows of a record read as the owner (no RLS). */
  async function ownerHistory(tableName: string, recordId: string) {
    const { rows } = await t.pool.query<{
      id: string;
      source: string;
      reason: string | null;
      changed_columns: string[];
      created_by: string | null;
    }>(
      `select id, source, reason, changed_columns, created_by from change_history
        where table_name = $1 and record_id = $2 order by seq`,
      [tableName, recordId],
    );
    return rows;
  }

  async function newTestResult(club: ClubFixture, playerId: PlayerId, notes: string | null) {
    const { rows } = await t.pool.query<{ id: string }>(
      `insert into test_result (club_id, player_id, test_definition_id, measured_on, status, method, notes)
       values ($1, $2, $3, '2026-04-10', 'done', 'manual', $4) returning id`,
      [club.clubId, playerId, must(club.rows.test_definition), notes],
    );
    return must(rows[0]).id;
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'history-a');
    b = await seedClubFixture(t.db, 'history-b');
    const { rows: superadmins } = await t.pool.query<{ id: string }>(
      `insert into "user" (name, email, is_superadmin)
       values ('Soporte', 'soporte@history.example.com', true) returning id`,
    );
    superadminId = must(superadmins[0]).id;
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await t.close();
  });

  describe('a correction made through the API', () => {
    it('requires a reason when a submitted value changes', async () => {
      const resultId = await newTestResult(a, a.players.assigned, 'Viento a favor');
      const error = await pgErrorOf(
        write(as('sc'), {}, (client) =>
          client.query(`update test_result set notes = 'Sin viento' where id = $1`, [resultId]),
        ),
      );
      expect(error).toEqual({ code: '23514', constraint: 'change_history_reason_required' });
      // A blank reason is no reason.
      const blank = await pgErrorOf(
        inContext(app.pool, as('sc'), async (client) => {
          await client.query(`select set_config('app.change_reason', '   ', true)`);
          await client.query(`update test_result set notes = 'Sin viento' where id = $1`, [
            resultId,
          ]);
        }),
      );
      expect(blank.constraint).toBe('change_history_reason_required');
      const { rows } = await t.pool.query<{ notes: string }>(
        'select notes from test_result where id = $1',
        [resultId],
      );
      expect(rows[0]?.notes).toBe('Viento a favor');
      expect(await ownerHistory('test_result', resultId)).toEqual([]);
    });

    it('records previous and new value, author, role, time, reason and request id', async () => {
      const resultId = await newTestResult(a, a.players.assigned, 'Viento a favor');
      const before = new Date();
      await write(
        as('sc'),
        { reason: '  Se anotó en el jugador equivocado ', requestId: REQUEST_ID },
        (client) =>
          client.query(
            `update test_result set notes = 'Sin viento', method = 'video' where id = $1`,
            [resultId],
          ),
      );
      const entries = await recordHistory(as('sc'), 'test_result', resultId);
      expect(entries).toHaveLength(1);
      const entry = must(entries[0]);
      expect(entry).toMatchObject({
        tableName: 'test_result',
        recordId: resultId,
        playerId: a.players.assigned,
        operation: 'update',
        source: 'app',
        changedBy: a.users.sc,
        actorRole: 'sc',
        reason: 'Se anotó en el jugador equivocado',
        requestId: REQUEST_ID,
        changes: [
          { column: 'method', previous: 'manual', current: 'video' },
          { column: 'notes', previous: 'Viento a favor', current: 'Sin viento' },
        ],
      });
      // updated_at / updated_by are not part of the diff.
      expect(entry.changes.map((c) => c.column)).not.toContain('updated_at');
      expect(entry.changedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5_000);
    });

    it('needs no reason to fill an empty value (completion), but records it', async () => {
      // The coach records the participation, the player reports the RPE later.
      const { rows: sessions } = await t.pool.query<{ id: string }>(
        `insert into training_session (club_id, sport, kind, category_id, starts_at, local_date)
         select club_id, sport, kind, category_id, starts_at + interval '1 day', local_date + 1
           from training_session where id = $1 returning id`,
        [must(a.rows.training_session)],
      );
      const sessionId = must(sessions[0]).id;
      const participationId = await inContext(app.pool, as('coach'), async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into participation (club_id, training_session_id, player_id, status, minutes)
           values ($1, $2, $3, 'full', 70) returning id`,
          [a.clubId, sessionId, a.players.assigned],
        );
        return must(rows[0]).id;
      });
      await write(as('player'), {}, (client) =>
        client.query(`update participation set rpe = 6, rpe_reported_at = now() where id = $1`, [
          participationId,
        ]),
      );
      const entry = must((await recordHistory(as('coach'), 'participation', participationId))[0]);
      expect(entry).toMatchObject({
        source: 'app',
        actorRole: 'player',
        changedBy: a.users.player,
        reason: null,
      });
      expect(entry.changes.map((c) => c.column)).toEqual(['rpe', 'rpe_reported_at', 'srpe_au']);
      expect(entry.changes.find((c) => c.column === 'srpe_au')).toEqual({
        column: 'srpe_au',
        previous: null,
        current: 420,
      });

      // Changing the reported RPE is a correction.
      const error = await pgErrorOf(
        write(as('player'), {}, (client) =>
          client.query(`update participation set rpe = 7 where id = $1`, [participationId]),
        ),
      );
      expect(error.constraint).toBe('change_history_reason_required');
      await write(as('player'), { reason: 'Me equivoqué de número' }, (client) =>
        client.query(`update participation set rpe = 7 where id = $1`, [participationId]),
      );
      const latest = must((await recordHistory(as('coach'), 'participation', participationId))[0]);
      expect(latest.reason).toBe('Me equivoqué de número');
      expect(latest.changes).toContainEqual({ column: 'srpe_au', previous: 420, current: 490 });
    });

    it('lifecycle columns of a test day change without a reason; its data does not', async () => {
      const sessionId = must(a.rows.test_session);
      await write(as('sc'), {}, (client) =>
        client.query(
          `update test_session set status = 'in_progress', started_at = now(), location = 'Cancha 2' where id = $1`,
          [sessionId],
        ),
      );
      await write(as('sc'), {}, (client) =>
        client.query(
          `update test_session set status = 'completed', completed_at = now() where id = $1`,
          [sessionId],
        ),
      );
      const error = await pgErrorOf(
        write(as('sc'), {}, (client) =>
          client.query(`update test_session set location = 'Cancha 1' where id = $1`, [sessionId]),
        ),
      );
      expect(error.constraint).toBe('change_history_reason_required');
      const entries = await recordHistory(as('sc'), 'test_session', sessionId);
      expect(entries.map((e) => e.changes.map((c) => c.column))).toEqual([
        ['completed_at', 'status'],
        ['location', 'started_at', 'status'],
      ]);
      expect(entries.every((e) => e.playerId === null)).toBe(true);
    });

    it('records nothing for a no-op update or an update of audit columns only', async () => {
      const wellnessId = must(a.rows.wellness);
      const before = (await ownerHistory('wellness', wellnessId)).length;
      await write(as('player'), {}, async (client) => {
        await client.query(`update wellness set sleep = sleep where id = $1`, [wellnessId]);
        await client.query(
          `update wellness set updated_at = now(), updated_by = $2 where id = $1`,
          [wellnessId, a.users.player],
        );
      });
      expect(await ownerHistory('wellness', wellnessId)).toHaveLength(before);
    });

    it('keeps nothing when the transaction rolls back', async () => {
      const resultId = await newTestResult(a, a.players.assigned, 'Original');
      await expect(
        write(as('sc'), { reason: 'Prueba' }, async (client) => {
          await client.query(`update test_result set notes = 'Cambio' where id = $1`, [resultId]);
          throw new Error('handler failed');
        }),
      ).rejects.toThrow('handler failed');
      expect(await ownerHistory('test_result', resultId)).toEqual([]);
    });

    it('orders several changes of one transaction', async () => {
      const resultId = await newTestResult(a, a.players.assigned, 'v1');
      await write(as('sc'), { reason: 'Correcciones en serie' }, async (client) => {
        for (const notes of ['v2', 'v3', 'v4']) {
          await client.query(`update test_result set notes = $2 where id = $1`, [resultId, notes]);
        }
      });
      const entries = await recordHistory(as('sc'), 'test_result', resultId);
      expect(entries.map((e) => e.changes[0]?.current)).toEqual(['v4', 'v3', 'v2']);
      expect(entries.map((e) => e.seq)).toEqual(
        [...entries.map((e) => e.seq)].sort((x, y) => y - x),
      );
    });

    it('rejects a reason that is too long or a malformed request id', async () => {
      const resultId = await newTestResult(a, a.players.assigned, 'Original');
      const tooLong = 'x'.repeat(CHANGE_REASON_MAX_LENGTH + 1);
      const longError = await pgErrorOf(
        inContext(app.pool, as('sc'), async (client) => {
          await client.query(`select set_config('app.change_reason', $1, true)`, [tooLong]);
          await client.query(`update test_result set notes = 'x' where id = $1`, [resultId]);
        }),
      );
      expect(longError).toEqual({ code: '23514', constraint: 'change_history_reason' });
      const requestError = await pgErrorOf(
        inContext(app.pool, as('sc'), async (client) => {
          await client.query(
            `select set_config('app.change_reason', 'ok', true), set_config('app.request_id', 'a b', true)`,
          );
          await client.query(`update test_result set notes = 'x' where id = $1`, [resultId]);
        }),
      );
      expect(requestError).toEqual({ code: '23514', constraint: 'change_history_request_id' });
    });
  });

  describe('test_result_value stays append-only', () => {
    it('a value cannot be edited: it is voided (with its reason) and a new one added', async () => {
      const valueId = must(a.rows.test_result_value);
      const edit = await pgErrorOf(
        write(as('sc'), { reason: 'Mal medido' }, (client) =>
          client.query(`update test_result_value set value = 43 where id = $1`, [valueId]),
        ),
      );
      expect(edit.constraint).toBe('test_result_value_append_only');

      // The void needs no app.change_reason: its void_reason is the reason.
      await write(as('sc'), { requestId: REQUEST_ID }, async (client) => {
        await client.query(
          `update test_result_value set voided_at = now(), voided_by = $2, void_reason = 'Pisó la línea'
            where id = $1`,
          [valueId, a.users.sc],
        );
        await client.query(
          `insert into test_result_value (club_id, test_result_id, metric_definition_id, attempt_number, value, unit)
           select club_id, test_result_id, metric_definition_id, 2, 43, unit from test_result_value where id = $1`,
          [valueId],
        );
      });
      const entry = must((await recordHistory(as('coach'), 'test_result_value', valueId))[0]);
      expect(entry).toMatchObject({
        playerId: a.players.assigned,
        reason: 'Pisó la línea',
        requestId: REQUEST_ID,
        actorRole: 'sc',
      });
      expect(entry.changes.map((c) => c.column)).toEqual(['void_reason', 'voided_at', 'voided_by']);
    });
  });

  describe('who reads the history', () => {
    let wellnessEntryId: string;
    let otherResultId: string;

    beforeAll(async () => {
      // A correction of the assigned player (M15) and one of the other player (M17).
      wellnessEntryId = must(a.rows.change_history);
      otherResultId = await newTestResult(a, a.players.other, 'Original');
      await t.pool.query(`update test_result set notes = 'Corregido' where id = $1`, [
        otherResultId,
      ]);
    });

    async function visible(context: TestContext, pool: pg.Pool = app.pool) {
      return inContext(pool, context, async (client) => {
        const { rows } = await client.query<{ id: string; player_id: string | null }>(
          'select id, player_id from change_history',
        );
        return rows;
      });
    }

    it('admin sees the whole club, never another club', async () => {
      const rows = await visible(as('admin'));
      expect(rows.map((r) => r.id)).toContain(wellnessEntryId);
      expect(rows.some((r) => r.player_id === a.players.other)).toBe(true);
      expect(rows.map((r) => r.id)).not.toContain(must(b.rows.change_history));
    });

    it('coach, sc and medical see the players they are assigned to', async () => {
      const coach = await visible(as('coach'));
      expect(coach.map((r) => r.id)).toContain(wellnessEntryId);
      expect(coach.some((r) => r.player_id === a.players.other)).toBe(false);

      const coachM17 = await visible(as('coachM17'));
      expect(coachM17.map((r) => r.id)).not.toContain(wellnessEntryId);
      expect(coachM17.some((r) => r.player_id === a.players.other)).toBe(true);

      const sc = await visible(as('sc'));
      expect(sc.map((r) => r.id)).toContain(wellnessEntryId);
      expect(sc.some((r) => r.player_id === a.players.other)).toBe(true);

      // Medical without assignment: no player rows; session rows are for every staff member.
      const medical = await visible(as('medical'));
      expect(medical.filter((r) => r.player_id !== null)).toEqual([]);
      expect(
        await recordHistory(as('medical'), 'test_session', must(a.rows.test_session)),
      ).not.toEqual([]);
    });

    it('a superadmin sees the club only with its support access, and its changes say so', async () => {
      const superadmin: TestContext = {
        clubId: a.clubId,
        userId: superadminId,
        role: 'superadmin',
      };
      // Without app.begin_support_access the role is not validated (ADR 0029): nothing.
      expect(await visible(superadmin)).toEqual([]);
      const supported = { ...superadmin, supportReason: 'Ticket 42' };
      const rows = await visible(supported);
      expect(rows.map((r) => r.id)).toContain(wellnessEntryId);
      expect(rows.map((r) => r.id)).not.toContain(must(b.rows.change_history));

      const resultId = await newTestResult(a, a.players.assigned, 'Original');
      await write(supported, { reason: 'Pedido del club', requestId: REQUEST_ID }, (client) =>
        client.query(`update test_result set notes = 'Corregido' where id = $1`, [resultId]),
      );
      const entries = await recordHistory(supported, 'test_result', resultId);
      expect(entries).toHaveLength(1);
      expect(must(entries[0])).toMatchObject({
        changedBy: superadminId,
        actorRole: 'superadmin',
        reason: 'Pedido del club',
        requestId: REQUEST_ID,
      });
    });

    it('shows a not_done_reason of injured as unavailable, like the result itself', async () => {
      const { rows } = await t.pool.query<{ id: string }>(
        `insert into test_result (club_id, player_id, test_definition_id, measured_on, status, not_done_reason)
         values ($1, $2, $3, '2026-04-11', 'not_done', 'injured') returning id`,
        [a.clubId, a.players.assigned, must(a.rows.test_definition)],
      );
      const resultId = must(rows[0]).id;
      await t.pool.query(`update test_result set not_done_reason = 'absent' where id = $1`, [
        resultId,
      ]);
      const masked = [{ column: 'not_done_reason', previous: 'unavailable', current: 'absent' }];
      for (const viewer of ['coach', 'sc', 'admin'] as const) {
        const entries = await recordHistory(as(viewer), 'test_result', resultId);
        expect(entries.map((e) => e.changes)).toEqual([masked]);
      }
      // Stored as it was; only the projection changes.
      const { rows: stored } = await t.pool.query<{ old_values: Record<string, unknown> }>(
        `select old_values from change_history where table_name = 'test_result' and record_id = $1`,
        [resultId],
      );
      expect(stored.map((r) => r.old_values.not_done_reason)).toEqual(['injured']);
    });

    it('players and guardians do not see it, not even their own', async () => {
      expect(await visible(as('player'))).toEqual([]);
      expect(await visible(as('parent'))).toEqual([]);
    });

    it('a role the membership does not back sees nothing', async () => {
      expect(await visible({ ...as('coach'), role: 'admin' })).toEqual([]);
    });

    it('the worker reads the club of its job', async () => {
      const rows = await visible({ clubId: a.clubId }, worker.pool);
      expect(rows.map((r) => r.id)).toContain(wellnessEntryId);
      expect(rows.map((r) => r.id)).not.toContain(must(b.rows.change_history));
    });

    it('lists the history of a player, paginated newest first', async () => {
      const resultId = await newTestResult(a, a.players.assigned, 'p0');
      await write(as('sc'), { reason: 'Serie' }, async (client) => {
        for (const notes of ['p1', 'p2', 'p3']) {
          await client.query(`update test_result set notes = $2 where id = $1`, [resultId, notes]);
        }
      });
      const pages = await inContext(app.pool, as('coach'), async (client) => {
        const db = createDatabase(client);
        const first = await listPlayerChangeHistory(db, a.players.assigned, { limit: 2 });
        const second = await listPlayerChangeHistory(db, a.players.assigned, {
          limit: 2,
          beforeSeq: must(first.nextBeforeSeq),
        });
        const all = await listPlayerChangeHistory(db, a.players.assigned, { limit: 100 });
        const other = await listPlayerChangeHistory(db, a.players.other);
        return { first, second, all, other };
      });
      expect(pages.first.entries.map((e) => e.changes[0]?.current)).toEqual(['p3', 'p2']);
      expect(pages.second.entries[0]?.changes[0]?.current).toBe('p1');
      expect(pages.all.entries.every((e) => e.playerId === a.players.assigned)).toBe(true);
      expect(pages.all.nextBeforeSeq).toBeNull();
      expect(pages.other.entries).toEqual([]);
    });
  });

  describe('immutability', () => {
    it('no connection role can insert, update or delete history rows', async () => {
      const id = must(a.rows.change_history);
      for (const [pool, context] of [
        [app.pool, as('admin')],
        [worker.pool, { clubId: a.clubId }],
      ] as const) {
        for (const statement of [
          `update change_history set reason = 'falso' where id = $1`,
          `delete from change_history where id = $1`,
          `insert into change_history (club_id, table_name, record_id, operation, source, changed_columns, old_values, new_values)
           select club_id, table_name, record_id, operation, source, changed_columns, old_values, new_values
             from change_history where id = $1`,
        ]) {
          const error = await pgErrorOf(
            inContext(pool, context, (client) => client.query(statement, [id])),
          );
          expect(error.code, statement).toBe('42501');
        }
      }
    });

    it('not even the owner edits or deletes it; deleting the author only clears created_by', async () => {
      const id = must(a.rows.change_history);
      for (const statement of [
        `update change_history set reason = 'falso' where id = $1`,
        `update change_history set new_values = '{"sleep": 1}' where id = $1`,
        `delete from change_history where id = $1`,
      ]) {
        expect(await pgErrorOf(t.pool.query(statement, [id])), statement).toEqual({
          code: '23514',
          constraint: 'change_history_append_only',
        });
      }

      // An sc who corrects a result and then deletes their account.
      const { rows: users } = await t.pool.query<{ id: string }>(
        `insert into "user" (name, email) values ('Leaving', 'leaving@history-a.example.com') returning id`,
      );
      const leaving = must(users[0]).id;
      await t.pool.query(
        `with m as (insert into membership (club_id, user_id, role) values ($1, $2, 'sc') returning club_id, id)
         insert into staff_assignment (club_id, membership_id, sport, valid_from)
         select club_id, id, 'rugby', '2020-01-01' from m`,
        [a.clubId, leaving],
      );
      const resultId = await newTestResult(a, a.players.assigned, 'Antes');
      await write(
        { clubId: a.clubId, userId: leaving, role: 'sc' },
        { reason: 'Corrijo' },
        (client) =>
          client.query(`update test_result set notes = 'Después' where id = $1`, [resultId]),
      );
      expect((await ownerHistory('test_result', resultId))[0]?.created_by).toBe(leaving);
      await t.pool.query(`delete from "user" where id = $1`, [leaving]);
      const [entry] = await ownerHistory('test_result', resultId);
      expect(entry).toMatchObject({ created_by: null, reason: 'Corrijo' });
    });
  });

  describe('changes outside the API', () => {
    it('the worker updates derived values and corrects without a required reason', async () => {
      const anthroId = must(a.rows.anthro_measurement);
      await inContext(worker.pool, { clubId: a.clubId }, (client) =>
        client.query(
          `update anthro_measurement set phv_offset_years = -1.2, maturity_offset_equation = 'moore_2015', derived_at = now()
            where id = $1`,
          [anthroId],
        ),
      );
      await inContext(worker.pool, { clubId: a.clubId }, (client) =>
        client.query(`update anthro_measurement set height_cm = 171 where id = $1`, [anthroId]),
      );
      const entries = await recordHistory(as('sc'), 'anthro_measurement', anthroId);
      expect(entries.map((e) => [e.source, e.changedBy, e.actorRole, e.reason])).toEqual([
        ['worker', null, null, null],
        ['worker', null, null, null],
      ]);
      expect(entries[0]?.changes).toEqual([{ column: 'height_cm', previous: 170, current: 171 }]);
    });

    it('an owner delete is recorded with the whole row', async () => {
      const gymSetId = must(a.rows.gym_set);
      const { rows } = await t.pool.query<{ id: string }>(
        `insert into gym_set (club_id, player_id, performed_on, exercise_code, set_number, reps)
         select club_id, player_id, performed_on, exercise_code, set_number + 1, reps from gym_set where id = $1
         returning id`,
        [gymSetId],
      );
      const extra = must(rows[0]).id;
      await t.pool.query('delete from gym_set where id = $1', [extra]);
      const entry = must((await recordHistory(as('admin'), 'gym_set', extra))[0]);
      expect(entry).toMatchObject({
        operation: 'delete',
        source: 'system',
        playerId: a.players.assigned,
      });
      expect(entry.changes).toContainEqual({ column: 'reps', previous: 8, current: null });
      expect(entry.changes.map((c) => c.column)).toContain('id');
    });
  });

  describe('catalog', () => {
    it('every tracked table, and only those, has the history trigger', async () => {
      const { rows } = await t.pool.query<{ table: string }>(
        `select c.relname as table
           from pg_trigger tg
           join pg_class c on c.oid = tg.tgrelid
           join pg_proc p on p.oid = tg.tgfoid
          where p.proname = 'change_history_record' and not tg.tgisinternal
          order by 1`,
      );
      expect(rows.map((r) => r.table)).toEqual([...CHANGE_TRACKED_TABLES].sort());
    });

    it('the connection roles can only SELECT change_history', async () => {
      const { rows } = await t.pool.query<{ role: string; privilege: string }>(
        `select r.rolname as role, p.privilege
           from pg_roles r
           cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p(privilege)
          where r.rolname = any($1::text[])
            and (has_table_privilege(r.oid, 'public.change_history', p.privilege)
                 or (p.privilege in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                     and has_any_column_privilege(r.oid, 'public.change_history', p.privilege)))
          order by 1, 2`,
        [Object.values(DATABASE_ROLES)],
      );
      expect(rows).toEqual([
        { role: DATABASE_ROLES.app, privilege: 'SELECT' },
        { role: DATABASE_ROLES.worker, privilege: 'SELECT' },
      ]);
    });
  });

  describe('setChangeContext', () => {
    it('validates before touching the database', async () => {
      const db = createDatabase(t.pool);
      await expect(setChangeContext(db, { reason: '   ' })).rejects.toThrow('change reason');
      await expect(setChangeContext(db, { requestId: 'a b' })).rejects.toBeInstanceOf(
        ChangeContextError,
      );
    });

    it('sets only what it is given, and null clears', async () => {
      const settings = await inContext(app.pool, as('sc'), async (client) => {
        const db = createDatabase(client);
        const read = async () =>
          (
            await client.query<{ reason: string; request: string }>(
              `select current_setting('app.change_reason', true) as reason,
                      current_setting('app.request_id', true) as request`,
            )
          ).rows[0];
        await setChangeContext(db, { reason: 'Uno', requestId: REQUEST_ID });
        const both = await read();
        await setChangeContext(db, { reason: null });
        const cleared = await read();
        await setChangeContext(db, {});
        return { both, cleared, unchanged: await read() };
      });
      expect(settings.both).toEqual({ reason: 'Uno', request: REQUEST_ID });
      expect(settings.cleared).toEqual({ reason: '', request: REQUEST_ID });
      expect(settings.unchanged).toEqual({ reason: '', request: REQUEST_ID });
    });
  });
});
