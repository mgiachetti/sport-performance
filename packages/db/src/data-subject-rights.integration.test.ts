import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { membership, player, user } from './schema/index.js';
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
 * Rights of the data subject (B-329, ADR 0051): the export of every datum of
 * a player, the erasure of a player with everything that references it
 * (tables found in the catalog, change history included through a marker the
 * application cannot fake), the requests as evidence, and the deletion or
 * anonymization of a user account.
 */
type Queryable = Pick<pg.Pool, 'query'>;

interface Reference {
  table_ref: string;
  column_name: string;
}

describe.skipIf(!hasDatabase)('rights of the data subject (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let references: Reference[];

  const as = (club: ClubFixture, who: FixtureUser): TestContext => ({
    clubId: club.clubId,
    userId: club.users[who],
    role: who === 'coachM17' ? 'coach' : who,
  });
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);

  /** Rows of every table that references `playerId`, by `schema.table` (as the owner). */
  async function rowsOf(playerId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const ref of references) {
      const { rows } = await t.pool.query<{ n: number }>(
        `select count(*)::int as n from ${ref.table_ref} where "${ref.column_name}" = $1`,
        [playerId],
      );
      counts[ref.table_ref] = must(rows[0]).n;
    }
    const values = await t.pool.query<{ n: number }>(
      `select count(*)::int as n from test_result_value v
         join test_result r on r.club_id = v.club_id and r.id = v.test_result_id
        where r.player_id = $1`,
      [playerId],
    );
    counts['public.test_result_value'] = must(values.rows[0]).n;
    const history = await t.pool.query<{ n: number }>(
      `select count(*)::int as n from change_history
        where player_id = $1`,
      [playerId],
    );
    counts['public.change_history'] = must(history.rows[0]).n;
    const stages = await t.pool.query<{ n: number }>(
      'select count(*)::int as n from medical.concussion_stage where player_id = $1',
      [playerId],
    );
    counts['medical.concussion_stage'] = must(stages.rows[0]).n;
    const self = await t.pool.query<{ n: number }>(
      'select count(*)::int as n from player where id = $1',
      [playerId],
    );
    counts['public.player'] = must(self.rows[0]).n;
    return counts;
  }

  /** Medical rows of a player, written as the owner (maintenance), plus a corrected wellness. */
  async function addMedicalAndHistory(club: ClubFixture, playerId: string): Promise<void> {
    const injury = randomUUID();
    const concussion = randomUUID();
    await t.pool.query(
      `insert into medical.injury (id, club_id, player_id, onset_on, context, body_region, side, onset, mechanism, diagnosis)
       values ($1, $2, $3, '2026-03-10', 'match', 'knee', 'left', 'acute', 'contact', 'Esguince')`,
      [injury, club.clubId, playerId],
    );
    await t.pool.query(
      `insert into medical.concussion (id, club_id, player_id, occurred_on, context, protocol_version, injury_id)
       values ($1, $2, $3, '2026-03-12', 'match', '2024', $4)`,
      [concussion, club.clubId, playerId, injury],
    );
    await t.pool.query(
      `insert into medical.hold (club_id, player_id, training, match, valid_from, injury_id)
       values ($1, $2, 'unavailable', 'unavailable', '2026-03-10', $3)`,
      [club.clubId, playerId, injury],
    );
    // A stage of the concussion only exists through it (its key has no player of its own).
    await t.pool.query(
      `insert into medical.concussion_stage (club_id, player_id, concussion_id, stage, started_on)
       values ($1, $2, $3, 1, '2026-03-12')`,
      [club.clubId, playerId, concussion],
    );
    const note = randomUUID();
    await t.pool.query(
      `insert into medical.note (id, club_id, player_id, body, injury_id, concussion_id)
       values ($1, $2, $3, 'Control', $4, $5)`,
      [note, club.clubId, playerId, injury, concussion],
    );
    // A note that amends another one (a key between rows of the same table).
    await t.pool.query(
      `insert into medical.note (club_id, player_id, body, amends_note_id)
       values ($1, $2, 'Corrección del control', $3)`,
      [club.clubId, playerId, note],
    );
    // A corrected wellness leaves a row in the change history.
    await inContext(t.pool, { ...as(club, 'admin') }, async (client) => {
      await client.query(`select set_config('app.change_reason', 'corrección de prueba', true)`);
      await client.query(
        `update wellness set sleep = case when sleep = 5 then 4 else 5 end where club_id = $1 and player_id = $2`,
        [club.clubId, playerId],
      );
    });
  }

  async function requestErasure(club: ClubFixture, playerId: string): Promise<string> {
    const { rows } = await t.pool.query<{ id: string }>(
      `insert into data_subject_request (club_id, player_id, kind, status, requested_by, requester_role)
       values ($1, $2, 'erasure', 'pending', $3, 'admin') returning id`,
      [club.clubId, playerId, club.users.admin],
    );
    return must(rows[0]).id;
  }

  const erase = (club: ClubFixture, who: FixtureUser, requestId: string) =>
    run(as(club, who), async (client) => {
      const { rows } = await client.query<{ counts: Record<string, number> }>(
        'select app.erase_player($1) as counts',
        [requestId],
      );
      return must(rows[0]).counts;
    });

  beforeAll(async () => {
    t = await createMigratedDatabase();
    app = await connectAs(t, 'app');
    const { rows } = await t.pool.query<Reference>(
      `select n.nspname || '.' || c.relname as table_ref, r.column_name::text as column_name
         from app_admin.player_references() r
         join pg_class c on c.oid = r.table_ref join pg_namespace n on n.oid = c.relnamespace
        order by 1`,
    );
    references = rows;
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  it('finds every table with a foreign key to the player, in public and medical', () => {
    expect(references.map((r) => r.table_ref)).toEqual(
      expect.arrayContaining([
        'public.consent',
        'public.guardian',
        'public.wellness',
        'public.participation',
        'public.test_result',
        'public.change_history',
        'public.alert',
        'medical.injury',
        'medical.concussion',
        'medical.hold',
        'medical.note',
      ]),
    );
    // medical.access_log and data_subject_request keep the id without a key: they outlive it.
    expect(references.map((r) => r.table_ref)).not.toContain('medical.access_log');
    expect(references.map((r) => r.table_ref)).not.toContain('public.data_subject_request');
  });

  describe('erasure', () => {
    let a: ClubFixture;
    let b: ClubFixture;

    beforeAll(async () => {
      a = await seedClubFixture(t.db, 'erase-a');
      b = await seedClubFixture(t.db, 'erase-b');
      await addMedicalAndHistory(a, a.players.assigned);
      await addMedicalAndHistory(b, b.players.assigned);
    });

    it('only the administration of the club executes it', async () => {
      const request = must(a.rows.data_subject_request);
      for (const who of ['coach', 'sc', 'medical', 'player', 'parent'] as const) {
        expect((await pgErrorOf(erase(a, who, request))).code, who).toBe('42501');
      }
      expect(
        (
          await pgErrorOf(
            run({ clubId: a.clubId, userId: a.users.admin, role: 'superadmin' }, async (client) =>
              client.query('select app.erase_player($1)', [request]),
            ),
          )
        ).code,
      ).toBe('42501');
      // A request of another club does not exist for this one.
      expect((await pgErrorOf(erase(b, 'admin', request))).code).toBe('P0002');
    });

    it('deletes every row that references the player, in every schema, and keeps the evidence', async () => {
      const target = a.players.assigned;
      const before = await rowsOf(target);
      const otherBefore = await rowsOf(a.players.other);
      const otherClubBefore = await rowsOf(b.players.assigned);
      for (const table of [
        'public.wellness',
        'public.consent',
        'medical.injury',
        'medical.note',
        'public.alert',
      ]) {
        expect(before[table], table).toBeGreaterThan(0);
      }
      expect(before['public.change_history']).toBeGreaterThan(0);
      const accessLog = await t.pool.query<{ n: number }>(
        'select count(*)::int as n from medical.access_log where player_id = $1',
        [target],
      );

      const syncOf = async (playerId: string) =>
        (
          await t.pool.query<{ deleted: boolean; field_hlc: Record<string, string> }>(
            'select deleted, field_hlc from sync_change where club_id = $1 and player_id = $2',
            [a.clubId, playerId],
          )
        ).rows;
      expect((await syncOf(target)).some((entry) => !entry.deleted)).toBe(true);
      const otherSync = await syncOf(a.players.other);
      const counts = await erase(a, 'admin', must(a.rows.data_subject_request));
      // The offline sync log keeps deletion marks of the player, with ids only, so devices that
      // synced their rows drop them; the other player's entries are untouched.
      const marks = await syncOf(target);
      expect(marks.length).toBeGreaterThan(0);
      expect(
        marks.every((entry) => entry.deleted && Object.keys(entry.field_hlc).length === 0),
      ).toBe(true);
      expect(await syncOf(a.players.other)).toEqual(otherSync);

      const after = await rowsOf(target);
      for (const [table, n] of Object.entries(after)) expect(n, table).toBe(0);
      expect(counts['public.player']).toBe(1);
      // Rows that only exist through a row of the player went too, before their parent: the
      // history their deletion wrote named the player and was purged with the rest.
      expect(before['medical.concussion_stage']).toBeGreaterThan(0);
      expect(counts['medical.concussion_stage']).toBe(before['medical.concussion_stage']);
      expect(counts['public.test_result_value']).toBe(before['public.test_result_value']);
      expect(
        (
          await t.pool.query('select 1 from change_history where club_id = $1 and record_id = $2', [
            a.clubId,
            a.rows.test_result_value,
          ])
        ).rowCount,
      ).toBe(0);
      // The CMJ video stays as the record of its object, deleted and without the player, until
      // the retention job removes the object (no upload URL of it can be honored by then).
      const { rows: files } = await t.pool.query<{
        status: string;
        player_id: string | null;
        file_name: string | null;
        waitsForUrls: boolean;
      }>(
        `select status, player_id, file_name, expires_at > now() as "waitsForUrls" from file
          where club_id = $1 and id = $2`,
        [a.clubId, a.rows.file],
      );
      expect(files).toEqual([
        { status: 'deleted', player_id: null, file_name: null, waitsForUrls: true },
      ]);
      expect(counts['public.file']).toBe(1);
      expect(counts['medical.injury']).toBe(before['medical.injury']);
      expect(counts['public.wellness']).toBe(before['public.wellness']);
      expect(counts['public.change_history']).toBeGreaterThanOrEqual(
        before['public.change_history'] ?? 0,
      );
      // The other player of the club and the other club are untouched.
      expect(await rowsOf(a.players.other)).toEqual(otherBefore);
      expect(await rowsOf(b.players.assigned)).toEqual(otherClubBefore);
      // The evidence stays: the medical log, and the request with the counts.
      const accessLogAfter = await t.pool.query<{ n: number }>(
        'select count(*)::int as n from medical.access_log where player_id = $1',
        [target],
      );
      // The log keeps every line it had, and each clinical row deleted adds its own `delete`
      // line (ADR 0051; no values).
      const deletes = await t.pool.query<{ resource: string; n: number }>(
        `select resource, count(*)::int as n from medical.access_log
          where player_id = $1 and action = 'delete' group by resource order by resource`,
        [target],
      );
      const medicalCounts = Object.fromEntries(
        Object.entries(counts)
          .filter(([table, n]) => table.startsWith('medical.') && n > 0)
          .map(([table, n]) => [table.slice('medical.'.length), n]),
      );
      expect(Object.fromEntries(deletes.rows.map((r) => [r.resource, r.n]))).toEqual(medicalCounts);
      expect(must(accessLogAfter.rows[0]).n).toBe(
        must(accessLog.rows[0]).n + deletes.rows.reduce((sum, r) => sum + r.n, 0),
      );
      const { rows } = await t.pool.query<{
        status: string;
        resolved_by: string;
        erased_rows: Record<string, number>;
      }>('select status, resolved_by, erased_rows from data_subject_request where id = $1', [
        a.rows.data_subject_request,
      ]);
      expect(must(rows[0])).toMatchObject({
        status: 'completed',
        resolved_by: a.users.admin,
        erased_rows: counts,
      });
      // The player's account has its own email: it stays, without the player membership.
      const account = await t.pool.query<{ ended: boolean }>(
        `select (ended_at is not null and ended_at <= now()) as ended from membership
          where club_id = $1 and user_id = $2 and role = 'player'`,
        [a.clubId, a.users.player],
      );
      expect(account.rows.map((r) => r.ended)).toEqual([true]);
      expect(
        (await t.pool.query('select 1 from "user" where id = $1', [a.users.player])).rowCount,
      ).toBe(1);
      // The guardian keeps their account; only the link went with the player.
      expect(
        (await t.pool.query('select 1 from "user" where id = $1', [a.users.parent])).rowCount,
      ).toBe(1);
    });

    it("purges only the erased player's history: a row moved to another player is theirs", async () => {
      const c = await seedClubFixture(t.db, 'erase-c');
      const target = c.players.assigned;
      const other = c.players.other;
      // A wellness of the target is moved to the other player: its history row is the other
      // player's (`player_id`), with the target only in `old_values`.
      await inContext(t.pool, as(c, 'admin'), async (client) => {
        await client.query(`select set_config('app.change_reason', 'jugador equivocado', true)`);
        await client.query(
          `update wellness set player_id = $3, local_date = '2020-01-01'
            where club_id = $1 and player_id = $2`,
          [c.clubId, target, other],
        );
      });
      const historyOf = async (playerId: string) =>
        must(
          (
            await t.pool.query<{ n: number }>(
              'select count(*)::int as n from change_history where club_id = $1 and player_id = $2',
              [c.clubId, playerId],
            )
          ).rows[0],
        ).n;
      const otherHistory = await historyOf(other);
      expect(otherHistory).toBeGreaterThan(0);
      await erase(c, 'admin', must(c.rows.data_subject_request));
      expect(await historyOf(other)).toBe(otherHistory);
      expect(await historyOf(target)).toBe(0);
    });

    it("stops, with nothing erased, when a row that is not the player's points at their data", async () => {
      const d = await seedClubFixture(t.db, 'erase-d');
      const target = d.players.assigned;
      // A program of the target, and another player's set against it, are refused...
      const { rows } = await t.pool.query<{ id: string }>(
        `insert into gym_program (club_id, name, player_id, valid_from)
         values ($1, 'Programa', $2, '2026-01-01') returning id`,
        [d.clubId, target],
      );
      const program = must(rows[0]).id;
      expect(
        await pgErrorOf(
          t.pool.query(
            `insert into gym_set (club_id, player_id, gym_program_id, performed_on, exercise_code, load_kind, set_number, reps)
             values ($1, $2, $3, '2026-03-01', 'push_up', 'bodyweight', 1, 5)`,
            [d.clubId, d.players.other, program],
          ),
        ),
      ).toEqual({ code: '23514', constraint: 'gym_set_program_player' });
      // A row from before the guard (inserted without it) still blocks: the erasure stops
      // with a clear error and erases nothing, instead of deleting another player's set.
      await t.pool.query(`alter table gym_set disable trigger gym_set_program_guard`);
      await t.pool.query(
        `insert into gym_set (club_id, player_id, gym_program_id, performed_on, exercise_code, load_kind, set_number, reps)
         values ($1, $2, $3, '2026-03-01', 'push_up', 'bodyweight', 1, 5)`,
        [d.clubId, d.players.other, program],
      );
      await t.pool.query(`alter table gym_set enable trigger gym_set_program_guard`);
      const before = await rowsOf(target);
      expect(await pgErrorOf(erase(d, 'admin', must(d.rows.data_subject_request)))).toEqual({
        code: '23514',
        constraint: 'erasure_blocked',
      });
      expect(await rowsOf(target)).toEqual(before);
    });

    it('runs once: a completed request is not executed again', async () => {
      expect(await pgErrorOf(erase(a, 'admin', must(a.rows.data_subject_request)))).toEqual({
        code: '23514',
        constraint: 'erasure_request_not_pending',
      });
    });

    it('deletes the account without email of the player with them', async () => {
      const playerId = b.players.other;
      const accountId = must(
        (
          await t.db
            .insert(user)
            .values({ name: 'Jugador', email: `player.${playerId}@no-email.invalid` })
            .returning({ id: user.id })
        )[0],
      ).id;
      await t.db.insert(membership).values({ clubId: b.clubId, userId: accountId, role: 'player' });
      await t.pool.query('update player set user_id = $1 where id = $2', [accountId, playerId]);
      const request = await requestErasure(b, playerId);
      const counts = await erase(b, 'admin', request);
      expect(counts['public.user']).toBe(1);
      expect((await t.pool.query('select 1 from "user" where id = $1', [accountId])).rowCount).toBe(
        0,
      );
      expect(
        (await t.pool.query('select 1 from membership where user_id = $1', [accountId])).rowCount,
      ).toBe(0);
    });

    it('keeps the change history immutable outside an erasure, also for the owner', async () => {
      const { rows } = await t.pool.query<{ id: string; player_id: string }>(
        'select id, player_id from change_history where club_id = $1 limit 1',
        [b.clubId],
      );
      const row = must(rows[0]);
      expect(
        await pgErrorOf(t.pool.query('delete from change_history where id = $1', [row.id])),
      ).toEqual({ code: '23514', constraint: 'change_history_append_only' });
      // A marker of another (committed) transaction does not open the guard.
      await t.pool.query(
        `insert into app_admin.erasure_in_progress values (pg_current_xact_id(), $1, $2)`,
        [b.clubId, row.player_id],
      );
      expect(
        await pgErrorOf(t.pool.query('delete from change_history where id = $1', [row.id])),
      ).toEqual({ code: '23514', constraint: 'change_history_append_only' });
    });

    it('the connection roles do not reach the marker', async () => {
      expect(
        (
          await pgErrorOf(
            run(as(b, 'admin'), (client) =>
              client.query(
                `insert into app_admin.erasure_in_progress values (pg_current_xact_id(), $1, $2)`,
                [b.clubId, b.players.assigned],
              ),
            ),
          )
        ).code,
      ).toBe('42501');
    });
  });

  describe('export', () => {
    let a: ClubFixture;
    let b: ClubFixture;

    beforeAll(async () => {
      a = await seedClubFixture(t.db, 'export-a');
      b = await seedClubFixture(t.db, 'export-b');
      await addMedicalAndHistory(a, a.players.assigned);
    });

    const exportAs = (context: TestContext, playerId: string) =>
      run(context, async (client) => {
        const { rows } = await client.query<{ data: Record<string, unknown[]> | null }>(
          'select app.export_player_data($1) as data',
          [playerId],
        );
        return must(rows[0]).data;
      });

    it('gives the holder every public row of the player, also those RLS hides from them', async () => {
      const data = must(await exportAs(as(a, 'parent'), a.players.assigned));
      for (const table of [
        'public.player',
        'public.wellness',
        'public.participation',
        'public.test_result',
        'public.test_result_value',
        'public.training_session',
        'public.test_session',
        'public.consent',
        'public.consent_document',
        'public.guardian',
        'public.alert',
        'public.change_history',
      ]) {
        expect(data[table], table).toBeInstanceOf(Array);
        expect(data[table]?.length, table).toBeGreaterThan(0);
      }
      expect(data['public.player']).toEqual([
        expect.objectContaining({ id: a.players.assigned, club_id: a.clubId }),
      ]);
      // Medical data goes through the audited functions; access management stays out.
      expect(Object.keys(data).some((key) => key.startsWith('medical.'))).toBe(false);
      expect(data).not.toHaveProperty(['public.invitation']);
      expect(data).not.toHaveProperty(['public.player_access_code']);
      // Only rows of this player.
      for (const row of data['public.wellness'] as { player_id: string }[]) {
        expect(row.player_id).toBe(a.players.assigned);
      }
    });

    it('lets the administration export, and nobody else of the staff', async () => {
      expect(await exportAs(as(a, 'admin'), a.players.assigned)).not.toBeNull();
      for (const who of ['coach', 'sc', 'medical'] as const) {
        expect((await pgErrorOf(exportAs(as(a, who), a.players.assigned))).code, who).toBe('42501');
      }
    });

    it('denies a player the holder does not see, and answers NULL for another club', async () => {
      expect((await pgErrorOf(exportAs(as(a, 'parent'), a.players.other))).code).toBe('42501');
      expect((await pgErrorOf(exportAs(as(a, 'player'), a.players.other))).code).toBe('42501');
      expect(await exportAs(as(a, 'admin'), b.players.assigned)).toBeNull();
    });

    it('repeats the holder by age: the player once of age, the guardian of a minor', async () => {
      // The assigned player is a minor: their own account does not export (their guardian does).
      expect((await pgErrorOf(exportAs(as(b, 'player'), b.players.assigned))).code).toBe('42501');
      expect(await exportAs(as(b, 'parent'), b.players.assigned)).not.toBeNull();
      // Of age, with the guardian's link kept: the guardian sees them, but no longer exports.
      await t.pool.query(`update player set birth_date = '2000-01-01' where id = $1`, [
        b.players.assigned,
      ]);
      await t.pool.query(
        `update guardian set adult_confirmed_at = now() where club_id = $1 and player_id = $2`,
        [b.clubId, b.players.assigned],
      );
      expect((await pgErrorOf(exportAs(as(b, 'parent'), b.players.assigned))).code).toBe('42501');
      expect(await exportAs(as(b, 'player'), b.players.assigned)).not.toBeNull();
    });

    it('includes the requests about the player', async () => {
      const data = must(await exportAs(as(a, 'admin'), a.players.assigned));
      expect(data['public.data_subject_request']).toEqual([
        expect.objectContaining({ id: a.rows.data_subject_request, kind: 'erasure' }),
      ]);
    });
  });

  describe('requests', () => {
    let a: ClubFixture;

    beforeAll(async () => {
      a = await seedClubFixture(t.db, 'requests-a');
    });

    const insert = (
      client: Queryable,
      values: {
        playerId: string;
        by: string;
        role: string;
        kind?: string;
        status?: string;
        resolvedBy?: string | null;
      },
    ) =>
      client.query<{ id: string }>(
        `insert into data_subject_request
           (club_id, player_id, kind, status, requested_by, requester_role, resolved_at, resolved_by)
         values ($1, $2, $3::data_subject_request_kind, $4::data_subject_request_status, $5, $6::membership_role,
                 case when $4::text = 'pending' then null else now() end, $7)
         returning id`,
        [
          a.clubId,
          values.playerId,
          values.kind ?? 'erasure',
          values.status ?? 'pending',
          values.by,
          values.role,
          values.resolvedBy ?? null,
        ],
      );

    it('the holder asks as themselves for a player they see', async () => {
      // The fixture already has a pending erasure of the assigned player: one at a time.
      expect(
        await pgErrorOf(
          run(as(a, 'parent'), (client) =>
            insert(client, { playerId: a.players.assigned, by: a.users.parent, role: 'parent' }),
          ),
        ),
      ).toMatchObject({ code: '23505', constraint: 'data_subject_request_pending_erasure_key' });
      // Not for a player they do not see, nor as someone else, nor a completed erasure.
      for (const values of [
        { playerId: a.players.other, by: a.users.parent, role: 'parent' },
        { playerId: a.players.assigned, by: a.users.admin, role: 'parent', kind: 'access' },
        {
          playerId: a.players.assigned,
          by: a.users.parent,
          role: 'parent',
          status: 'completed',
          resolvedBy: a.users.parent,
        },
      ]) {
        expect(
          (await pgErrorOf(run(as(a, 'parent'), (client) => insert(client, values)))).code,
        ).toBe('42501');
      }
      // An export is recorded completed by whoever exported.
      const { rows } = await run(as(a, 'parent'), (client) =>
        insert(client, {
          playerId: a.players.assigned,
          by: a.users.parent,
          role: 'parent',
          kind: 'access',
          status: 'completed',
          resolvedBy: a.users.parent,
        }),
      );
      expect(rows).toHaveLength(1);
      // The staff does not ask (nor see) them.
      expect(
        (
          await pgErrorOf(
            run(as(a, 'coach'), (client) =>
              insert(client, { playerId: a.players.assigned, by: a.users.coach, role: 'coach' }),
            ),
          )
        ).code,
      ).toBe('42501');
      const seen = await run(as(a, 'coach'), (client) =>
        client.query('select id from data_subject_request'),
      );
      expect(seen.rows).toEqual([]);
    });

    it('whoever asked cancels; only the administration rejects; resolved requests are frozen', async () => {
      const request = must(a.rows.data_subject_request);
      const reject = (who: FixtureUser) =>
        run(as(a, who), (client) =>
          client.query(
            `update data_subject_request set status = 'rejected', resolved_at = now(), resolved_by = $2,
                    resolution_note = 'Obligación legal' where id = $1`,
            [request, a.users[who]],
          ),
        );
      expect((await pgErrorOf(reject('parent'))).code).toBe('42501');
      await reject('admin');
      for (const statement of [
        `update data_subject_request set status = 'pending', resolved_at = null, resolved_by = null where id = $1`,
        `update data_subject_request set resolution_note = 'otro' where id = $1`,
        'delete from data_subject_request where id = $1',
      ]) {
        expect(await pgErrorOf(t.pool.query(statement, [request])), statement).toEqual({
          code: '23514',
          constraint: 'data_subject_request_immutable',
        });
      }
      // A new one, cancelled by the guardian who asked.
      const { rows } = await run(as(a, 'parent'), (client) =>
        insert(client, { playerId: a.players.assigned, by: a.users.parent, role: 'parent' }),
      );
      const id = must(rows[0]).id;
      const cancelled = await run(as(a, 'parent'), (client) =>
        client.query(
          `update data_subject_request set status = 'cancelled', resolved_at = now(), resolved_by = $2
            where id = $1`,
          [id, a.users.parent],
        ),
      );
      expect(cancelled.rowCount).toBe(1);
    });

    it('a rejection needs its reason', async () => {
      const { rows } = await run(as(a, 'admin'), (client) =>
        insert(client, { playerId: a.players.other, by: a.users.admin, role: 'admin' }),
      );
      expect(
        await pgErrorOf(
          run(as(a, 'admin'), (client) =>
            client.query(
              `update data_subject_request set status = 'rejected', resolved_at = now(), resolved_by = $2
                where id = $1`,
              [must(rows[0]).id, a.users.admin],
            ),
          ),
        ),
      ).toEqual({ code: '23514', constraint: 'data_subject_request_resolution' });
    });
  });

  describe('account deletion', () => {
    let a: ClubFixture;

    beforeAll(async () => {
      a = await seedClubFixture(t.db, 'accounts-a');
    });

    const deleteOwn = (userId: string, requestErasure = false, clubId: string | null = null) =>
      inContext(app.pool, { clubId, userId, role: null }, async (client) => {
        const { rows } = await client.query<{
          outcome: string;
          erasure_requests: { id: string; clubId: string; playerId: string }[];
        }>('select * from app.delete_own_account($1)', [requestErasure]);
        return must(rows[0]);
      });

    async function addSession(userId: string): Promise<void> {
      await t.pool.query(
        `insert into session (expires_at, token, user_id, client_type)
         values (now() + interval '1 day', $1, $2, 'web')`,
        [randomUUID(), userId],
      );
    }

    it('deletes an account that nothing keeps, with its sessions and memberships', async () => {
      const coach = a.users.coach;
      await addSession(coach);
      await t.pool.query(
        `insert into invitation (club_id, email, role, token_hash, expires_at)
         values ($1, $2, 'sc', repeat('a', 64), now() + interval '1 day')`,
        [a.clubId, `coach@${a.slug}.example.com`],
      );
      expect(await deleteOwn(coach)).toEqual({ outcome: 'deleted', erasure_requests: [] });
      for (const statement of [
        'select 1 from "user" where id = $1',
        'select 1 from session where user_id = $1',
        'select 1 from membership where user_id = $1',
      ]) {
        expect((await t.pool.query(statement, [coach])).rowCount, statement).toBe(0);
      }
      // The pending invitation to their email is revoked and no longer carries it.
      const { rows } = await t.pool.query<{ email: string; revoked: boolean }>(
        `select email, revoked_at is not null as revoked from invitation where role = 'sc' and club_id = $1`,
        [a.clubId],
      );
      expect(rows).toEqual([{ email: `deleted.${coach}@deleted.invalid`, revoked: true }]);
    });

    it('anonymizes an account kept as evidence (a signed consent) and files the erasures asked', async () => {
      const parent = a.users.parent;
      await addSession(parent);
      const { outcome, erasure_requests: requests } = await deleteOwn(parent, true);
      expect(outcome).toBe('anonymized');
      const { rows } = await t.pool.query<{ name: string; email: string; image: string | null }>(
        'select name, email, image from "user" where id = $1',
        [parent],
      );
      expect(rows).toEqual([{ name: '', email: `deleted.${parent}@deleted.invalid`, image: null }]);
      for (const statement of [
        'select 1 from session where user_id = $1',
        'select 1 from membership where user_id = $1',
        'select 1 from guardian where user_id = $1',
      ]) {
        expect((await t.pool.query(statement, [parent])).rowCount, statement).toBe(0);
      }
      // The consent they signed keeps pointing at the (anonymized) row.
      expect(
        (await t.pool.query('select 1 from consent where signed_by = $1', [parent])).rowCount,
      ).toBe(1);
      // The fixture's pending erasure of their child stays; no duplicate was filed.
      expect(requests).toEqual([]);
    });

    it('files an erasure for the player once of age who deletes their account', async () => {
      // The other player of the club, of age, with its own account.
      const adult = must(
        (
          await t.db
            .insert(user)
            .values({ name: 'Adulto', email: `adulto@${a.slug}.example.com` })
            .returning({ id: user.id })
        )[0],
      ).id;
      await t.db.insert(membership).values({ clubId: a.clubId, userId: adult, role: 'player' });
      await t.db
        .update(player)
        .set({ userId: adult, birthDate: '2000-01-01' as never })
        .where(eq(player.id, a.players.other));
      const { outcome, erasure_requests: requests } = await deleteOwn(adult, true);
      expect(outcome).toBe('deleted');
      expect(requests).toHaveLength(1);
      const { rows } = await t.pool.query<{
        player_id: string;
        requested_by: string | null;
        requester_role: string;
        status: string;
      }>(
        'select player_id, requested_by, requester_role, status from data_subject_request where id = $1',
        [requests[0]?.id],
      );
      expect(rows).toEqual([
        {
          player_id: a.players.other,
          requested_by: null,
          requester_role: 'player',
          status: 'pending',
        },
      ]);
      expect(
        (await t.pool.query('select user_id from player where id = $1', [a.players.other])).rows,
      ).toEqual([{ user_id: null }]);
    });

    it('refuses a superadmin and an anonymous caller', async () => {
      const admin = a.users.admin;
      await t.pool.query('alter table "user" disable trigger user_superadmin_guard');
      await t.pool.query('update "user" set is_superadmin = true where id = $1', [admin]);
      await t.pool.query('alter table "user" enable trigger user_superadmin_guard');
      expect((await pgErrorOf(deleteOwn(admin))).code).toBe('42501');
      expect(
        (
          await pgErrorOf(
            inContext(app.pool, {}, (client) =>
              client.query('select * from app.delete_own_account(false)'),
            ),
          )
        ).code,
      ).toBe('42501');
      expect((await t.pool.query('select 1 from "user" where id = $1', [admin])).rowCount).toBe(1);
    });
  });
});
