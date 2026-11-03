import { randomUUID } from 'node:crypto';
/**
 * Rights of the data subject end to end (B-329, ADR 0051) against Postgres
 * 16, through the real connection roles (ADR 0026): the export of every datum
 * of a player by the holder or the administration, erasure requests and their
 * execution by the administration, and the deletion of the caller's account.
 * Players, links, consents and medical rows are fixtures inserted with the
 * owner connection.
 */
import type { ClubId, PlayerId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCategory,
  createClub,
  createMembership,
  createTestDatabase,
  signIn,
  startIdentityApp,
  type IdentityTestApp,
  type SignedIn,
  type TestDatabase,
} from '../testing/identity.js';
import { describeWithPostgres } from '../testing/support.js';
import { MEDICAL_READS } from './data-subject-rights.js';

interface ErrorBody {
  error: { code: string; message: string };
}

interface RequestBody {
  id: string;
  playerId: string;
  player: { firstName: string; lastName: string } | null;
  kind: string;
  status: string;
  requestedBy: string | null;
  requesterRole: string;
  note: string | null;
  dueOn: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  erasedRows: Record<string, number> | null;
}

interface ExportBody {
  format: string;
  formatVersion: number;
  requestId: string;
  club: { id: string; name: string };
  playerId: string;
  account: { id: string; email: string } | null;
  tables: Record<string, Record<string, unknown>[]>;
  medical: {
    included: boolean;
    reason: string | null;
    tables: Record<string, Record<string, unknown>[]>;
  };
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Consulta del club por derechos del titular');

function errorOf(response: LightMyRequestResponse): ErrorBody['error'] {
  return response.json<ErrorBody>().error;
}

describeWithPostgres('rights of the data subject (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let clubA: ClubId;
  let clubB: ClubId;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let parentA: SignedIn;
  let minorPlayer: SignedIn;
  let adultPlayer: SignedIn;
  let coachA: SignedIn;
  /** M15, a minor: the guardian is the holder. */
  let minor: PlayerId;
  /** Of age: the holder of their own data. */
  let adult: PlayerId;
  let m15: string;

  const supporting = (clubId: string) => ({
    ...superadmin.headers,
    'x-support-club-id': clubId,
    'x-support-reason': SUPPORT_REASON,
  });

  async function insertPlayer(
    clubId: ClubId,
    categoryId: string,
    birthDate: string,
    userId: string | null,
    name = 'Juan',
  ): Promise<PlayerId> {
    const { rows } = await database.admin.query<{ id: PlayerId }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, $3, 'Pérez', $4, 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, userId, name, birthDate],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('player not created');
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, id, categoryId],
    );
    return id;
  }

  async function giveConsents(
    clubId: ClubId,
    playerId: PlayerId,
    signedBy: string,
    signer: 'guardian' | 'player',
    types: readonly string[],
  ): Promise<void> {
    for (const type of types) {
      const { rows } = await database.admin.query<{ id: string }>(
        `insert into consent_document (club_id, type, version, title, body)
         values ($1, $2, $3, 'Consentimiento', 'Texto.')
         on conflict (club_id, type, version) do update set type = excluded.type returning id`,
        [clubId, type, `v-${type}`],
      );
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, document_id, signer_kind, signed_by)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [clubId, playerId, type, `v-${type}`, rows[0]?.id, signer, signedBy],
      );
    }
  }

  const exportData = (caller: Record<string, string>, playerId: string, clientUuid?: string) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/players/${playerId}/data-exports`,
      headers: caller,
      payload: clientUuid === undefined ? {} : { clientUuid },
    });
  const askErasure = (
    caller: Record<string, string>,
    playerId: string,
    payload: Record<string, unknown> = {},
  ) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/players/${playerId}/erasure-requests`,
      headers: caller,
      payload,
    });
  const act = (
    caller: Record<string, string>,
    requestId: string,
    action: 'cancel' | 'reject' | 'execute',
    payload: Record<string, unknown>,
  ) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/data-subject-requests/${requestId}/${action}`,
      headers: caller,
      payload,
    });

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      routeClassLimits: {
        auth: { perIp: { name: 'api_auth_ip', max: 1000, windowS: 60 } },
        write: {
          perIp: { name: 'api_write_ip', max: 10_000, windowS: 60 },
          perUser: { name: 'api_write_user', max: 10_000, windowS: 60 },
        },
      },
    });
    clubA = await createClub(database.admin, 'rights-a');
    clubB = await createClub(database.admin, 'rights-b');
    superadmin = await signIn(t, 'soporte@plataforma.example.com');
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);
    adminA = await signIn(t, 'admin@rights-a.example.com');
    adminB = await signIn(t, 'admin@rights-b.example.com');
    parentA = await signIn(t, 'madre@rights-a.example.com');
    minorPlayer = await signIn(t, 'menor@rights-a.example.com');
    adultPlayer = await signIn(t, 'mayor@rights-a.example.com');
    coachA = await signIn(t, 'coach@rights-a.example.com');
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    await createMembership(database.admin, parentA.userId, clubA, 'parent');
    await createMembership(database.admin, minorPlayer.userId, clubA, 'player');
    await createMembership(database.admin, adultPlayer.userId, clubA, 'player');
    const coachMembership = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    m15 = await createCategory(database.admin, clubA, 'M15');
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, coachMembership, m15],
    );
    minor = await insertPlayer(clubA, m15, '2012-05-01', minorPlayer.userId);
    adult = await insertPlayer(clubA, m15, '2000-01-01', adultPlayer.userId, 'Pedro');
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, minor, parentA.userId],
    );
    await giveConsents(clubA, minor, parentA.userId, 'guardian', ['data', 'health']);
    await giveConsents(clubA, adult, adultPlayer.userId, 'player', ['data']);
    // Some data of the minor: a wellness, a not-done result for an injury, an injury and a
    // shared note.
    await database.admin.query(
      `insert into wellness (club_id, player_id, local_date, item_count, sleep, fatigue, soreness, stress, mood)
       values ($1, $2, '2026-03-10', 5, 4, 3, 3, 4, 5)`,
      [clubA, minor],
    );
    const { rows: definitions } = await database.admin.query<{ id: string }>(
      `insert into test_definition (club_id, code, version, valid_from)
       values ($1, 'cmj', 1, '2020-01-01') returning id`,
      [clubA],
    );
    await database.admin.query(
      `insert into test_result (club_id, player_id, test_definition_id, measured_on, status, not_done_reason)
       values ($1, $2, $3, '2026-03-11', 'not_done', 'injured')`,
      [clubA, minor, definitions[0]?.id],
    );
    await database.admin.query(
      `insert into medical.injury (club_id, player_id, onset_on, context, body_region, side, onset, mechanism, diagnosis)
       values ($1, $2, '2026-03-10', 'match', 'knee', 'left', 'acute', 'contact', 'Esguince')`,
      [clubA, minor],
    );
    await database.admin.query(
      `insert into medical.note (club_id, player_id, body, visibility) values ($1, $2, 'Control', 'shared'),
              ($1, $2, 'Solo para el médico', 'medical')`,
      [clubA, minor],
    );
  }, 60_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('export', () => {
    it('gives the guardian of a minor every datum, health included, as a download', async () => {
      const response = await exportData(parentA.headers, minor);
      expect(response.statusCode, response.body).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['content-disposition']).toMatch(
        new RegExp(`^attachment; filename="datos-${minor}-\\d{4}-\\d{2}-\\d{2}\\.json"$`),
      );
      const body = response.json<ExportBody>();
      expect(body).toMatchObject({
        format: 'sport-performance.player-data',
        formatVersion: 1,
        club: { id: clubA, name: 'RIGHTS-A' },
        playerId: minor,
        // The guardian does not see the email of the child's account.
        account: null,
      });
      expect(body.tables['public.player']).toEqual([
        expect.objectContaining({ id: minor, first_name: 'Juan' }),
      ]);
      expect(body.tables['public.wellness']).toHaveLength(1);
      expect(body.tables['public.consent']).toHaveLength(2);
      expect(body.tables['public.consent_document']).toHaveLength(2);
      // The requests about the player, this export's own included.
      expect(body.tables['public.data_subject_request']).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: body.requestId, kind: 'access' })]),
      );
      expect(body.tables['public.guardian']).toHaveLength(1);
      // `injured` is a health condition: the guardian sees `unavailable` (ADR 0029).
      expect(body.tables['public.test_result']).toEqual([
        expect.objectContaining({ status: 'not_done', not_done_reason: 'unavailable' }),
      ]);
      expect(Object.keys(body.tables).some((key) => key.startsWith('medical.'))).toBe(false);
      expect(body.medical.included).toBe(true);
      expect(body.medical.tables['medical.injury']).toEqual([
        expect.objectContaining({ diagnosis: 'Esguince' }),
      ]);
      // Only the shared notes reach the holder.
      expect(body.medical.tables['medical.note']?.map((n) => n.body)).toEqual(['Control']);
      // The reads are audited, and the export is recorded as a completed access request.
      const log = await database.admin.query(
        `select resource from medical.access_log where player_id = $1 and actor_user_id = $2`,
        [minor, parentA.userId],
      );
      expect(log.rows.map((r: { resource: string }) => r.resource)).toEqual(
        expect.arrayContaining(['injury', 'note']),
      );
      const recorded = await t.app.inject({
        url: `/v1/data-subject-requests/${body.requestId}`,
        headers: parentA.headers,
      });
      expect(recorded.json<RequestBody>()).toMatchObject({
        kind: 'access',
        status: 'completed',
        requesterRole: 'parent',
        requestedBy: parentA.userId,
        dueOn: null,
      });
    });

    it('lets the adult player export their own data with their account', async () => {
      const response = await exportData(adultPlayer.headers, adult);
      expect(response.statusCode, response.body).toBe(201);
      const body = response.json<ExportBody>();
      expect(body.account).toMatchObject({
        id: adultPlayer.userId,
        email: 'mayor@rights-a.example.com',
      });
      // No health consent: the section says why.
      expect(body.medical).toEqual({ included: false, reason: 'no_health_consent', tables: {} });
    });

    it('lets the administration export without clinical data', async () => {
      const response = await exportData(adminA.headers, minor);
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json<ExportBody>().medical).toEqual({
        included: false,
        reason: 'not_holder',
        tables: {},
      });
    });

    it('reads every clinical table of a player through its audited function', async () => {
      // A new table of the medical schema with a player must be added to the export. The
      // blocks are no record for the holder (ADR 0029: `read_holds` is for the medical staff;
      // the holder sees their availability).
      const { rows } = await database.admin.query<{ name: string }>(
        `select n.nspname || '.' || c.relname as name
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           join pg_attribute a on a.attrelid = c.oid
          where n.nspname = 'medical' and c.relkind = 'r' and a.attname = 'player_id'
            and not a.attisdropped and c.relname <> 'access_log'
          order by 1`,
      );
      expect(rows.map((r) => r.name)).toEqual(
        [...Object.keys(MEDICAL_READS), 'medical.hold'].sort(),
      );
    });

    it('denies the staff, the support, a minor and another club', async () => {
      expect((await exportData(coachA.headers, minor)).statusCode).toBe(403);
      expect((await exportData(supporting(clubA), minor)).statusCode).toBe(403);
      // A minor does not export: their guardian does (matrix: self+adult).
      expect((await exportData(minorPlayer.headers, minor)).statusCode).toBe(403);
      // Another player of the club, and a player of another club, do not exist for them.
      expect((await exportData(parentA.headers, adult)).statusCode).toBe(404);
      expect((await exportData(adminB.headers, minor)).statusCode).toBe(404);
    });

    it('is idempotent by clientUuid: the same request, the data again', async () => {
      const clientUuid = '8a7d1c4e-3f0b-4b5e-9a2c-1d6e8f0a9b31';
      const first = await exportData(parentA.headers, minor, clientUuid);
      const again = await exportData(parentA.headers, minor, clientUuid);
      expect(again.statusCode).toBe(201);
      expect(again.headers['x-idempotent-replay']).toBe('true');
      expect(again.json<ExportBody>().requestId).toBe(first.json<ExportBody>().requestId);
    });
  });

  describe('erasure', () => {
    let requestId: string;

    it('the guardian of a minor asks, once at a time, with the legal due day', async () => {
      const response = await askErasure(parentA.headers, minor, { note: 'Nos mudamos' });
      expect(response.statusCode, response.body).toBe(201);
      const body = response.json<RequestBody>();
      expect(body).toMatchObject({
        playerId: minor,
        player: { firstName: 'Juan', lastName: 'Pérez' },
        kind: 'erasure',
        status: 'pending',
        requesterRole: 'parent',
        requestedBy: parentA.userId,
        note: 'Nos mudamos',
      });
      expect(body.dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      requestId = body.id;
      const again = await askErasure(parentA.headers, minor);
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).code).toBe('conflict');
      // Not the coach, not the support.
      expect((await askErasure(coachA.headers, minor)).statusCode).toBe(403);
      expect((await askErasure(supporting(clubA), minor)).statusCode).toBe(403);
    });

    it('lists the requests: the administration all of the club, the holder theirs', async () => {
      const own = await t.app.inject({
        url: '/v1/data-subject-requests?kind=erasure',
        headers: parentA.headers,
      });
      expect(own.statusCode, own.body).toBe(200);
      expect(own.json<Page<RequestBody>>().items.map((r) => r.id)).toEqual([requestId]);
      const club = await t.app.inject({
        url: `/v1/data-subject-requests?status=pending&playerId=${minor}`,
        headers: adminA.headers,
      });
      expect(club.json<Page<RequestBody>>().items.map((r) => r.id)).toEqual([requestId]);
      // The adult player asked for no erasure (only an export); the coach has no access; another club sees nothing.
      const adultList = await t.app.inject({
        url: '/v1/data-subject-requests?kind=erasure',
        headers: adultPlayer.headers,
      });
      expect(adultList.json<Page<RequestBody>>().items).toEqual([]);
      expect(
        (await t.app.inject({ url: '/v1/data-subject-requests', headers: coachA.headers }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await t.app.inject({
            url: `/v1/data-subject-requests/${requestId}`,
            headers: adminB.headers,
          })
        ).statusCode,
      ).toBe(404);
    });

    it('only the administration rejects or executes; the confirmation must match', async () => {
      expect((await act(parentA.headers, requestId, 'reject', { reason: 'x' })).statusCode).toBe(
        403,
      );
      expect(
        (await act(parentA.headers, requestId, 'execute', { playerId: minor })).statusCode,
      ).toBe(403);
      // The staff gets 403 before anything about the request is looked up, as on reading it.
      expect(
        (await act(coachA.headers, requestId, 'execute', { playerId: minor })).statusCode,
      ).toBe(403);
      expect(
        (await act(coachA.headers, randomUUID(), 'execute', { playerId: minor })).statusCode,
      ).toBe(403);
      // An erasure cannot be undone: it asks for a fresh session, as deleting an account.
      const staleAdmin = await signIn(t, 'admin-viejo@rights-a.example.com');
      await createMembership(database.admin, staleAdmin.userId, clubA, 'admin');
      await database.admin.query(
        `update session set created_at = now() - interval '1 hour' where user_id = $1`,
        [staleAdmin.userId],
      );
      const stale = await act(staleAdmin.headers, requestId, 'execute', { playerId: minor });
      expect(stale.statusCode, stale.body).toBe(403);
      expect(stale.json<ErrorBody>().error.code).toBe('reauthentication_required');
      const wrong = await act(adminA.headers, requestId, 'execute', { playerId: adult });
      expect(wrong.statusCode).toBe(409);
    });

    it('the administration erases the player and keeps the request as evidence', async () => {
      const response = await act(adminA.headers, requestId, 'execute', { playerId: minor });
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<RequestBody>();
      expect(body).toMatchObject({
        status: 'completed',
        player: null,
        resolvedBy: adminA.userId,
      });
      expect(body.erasedRows).toMatchObject({
        'public.player': 1,
        'public.wellness': 1,
        'public.test_result': 1,
        'public.consent': 2,
        'public.guardian': 1,
        'medical.injury': 1,
        'medical.note': 2,
      });
      for (const [table, column] of [
        ['player', 'id'],
        ['wellness', 'player_id'],
        ['consent', 'player_id'],
        ['medical.injury', 'player_id'],
        ['medical.note', 'player_id'],
      ] as const) {
        const { rowCount } = await database.admin.query(
          `select 1 from ${table} where ${column} = $1`,
          [minor],
        );
        expect(rowCount, table).toBe(0);
      }
      // The guardian still sees their request, and its outcome.
      const seen = await t.app.inject({
        url: `/v1/data-subject-requests/${requestId}`,
        headers: parentA.headers,
      });
      expect(seen.json<RequestBody>()).toMatchObject({ status: 'completed', player: null });
      // Executed once: a retry answers the completed request, without erasing anything again.
      const retry = await act(adminA.headers, requestId, 'execute', { playerId: minor });
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.headers['x-idempotent-replay']).toBe('true');
      expect(retry.json<RequestBody>()).toEqual(body);
    });

    it("answers 409 and erases nothing when a row that is not the player's points at theirs", async () => {
      const blocked = await insertPlayer(clubA, m15, '2012-02-01', null, 'Bloqueado');
      const program = await database.admin.query<{ id: string }>(
        `insert into gym_program (club_id, name, player_id, valid_from)
         values ($1, 'Programa', $2, '2026-01-01') returning id`,
        [clubA, blocked],
      );
      // A set of another player against it, from before the guard that now refuses it.
      await database.admin.query('alter table gym_set disable trigger gym_set_program_guard');
      await database.admin.query(
        `insert into gym_set (club_id, player_id, gym_program_id, performed_on, exercise_code, load_kind, set_number, reps)
         values ($1, $2, $3, '2026-03-01', 'push_up', 'bodyweight', 1, 5)`,
        [clubA, adult, program.rows[0]?.id],
      );
      await database.admin.query('alter table gym_set enable trigger gym_set_program_guard');
      const request = await database.admin.query<{ id: string }>(
        `insert into data_subject_request (club_id, player_id, kind, status, requested_by, requester_role)
         values ($1, $2, 'erasure', 'pending', $3, 'admin') returning id`,
        [clubA, blocked, adminA.userId],
      );
      const id = request.rows[0]?.id ?? '';
      const response = await act(adminA.headers, id, 'execute', { playerId: blocked });
      expect(response.statusCode, response.body).toBe(409);
      expect(
        (await database.admin.query('select 1 from player where id = $1', [blocked])).rowCount,
      ).toBe(1);
      const after = await database.admin.query<{ status: string }>(
        'select status from data_subject_request where id = $1',
        [id],
      );
      expect(after.rows[0]?.status).toBe('pending');
    });

    it('the holder cancels and the administration rejects with a reason', async () => {
      const asked = await askErasure(adultPlayer.headers, adult);
      expect(asked.statusCode, asked.body).toBe(201);
      const id = asked.json<RequestBody>().id;
      const cancelled = await act(adultPlayer.headers, id, 'cancel', {});
      expect(cancelled.json<RequestBody>()).toMatchObject({
        status: 'cancelled',
        resolvedBy: adultPlayer.userId,
      });
      expect((await act(adultPlayer.headers, id, 'cancel', {})).statusCode).toBe(409);

      const byAdmin = await askErasure(adminA.headers, adult, { note: 'Pedido por nota' });
      expect(byAdmin.json<RequestBody>().requesterRole).toBe('admin');
      const rejected = await act(adminA.headers, byAdmin.json<RequestBody>().id, 'reject', {
        reason: 'Obligación legal de conservar',
      });
      expect(rejected.json<RequestBody>()).toMatchObject({
        status: 'rejected',
        resolutionNote: 'Obligación legal de conservar',
      });
      // The player's data is still there.
      expect((await exportData(adultPlayer.headers, adult)).statusCode).toBe(201);
    });
  });

  describe('account deletion', () => {
    it('needs a fresh session', async () => {
      const stale = await signIn(t, 'viejo@rights-b.example.com');
      await database.admin.query(
        `update session set created_at = now() - interval '1 hour' where user_id = $1`,
        [stale.userId],
      );
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/me/account-deletion',
        headers: stale.headers,
        payload: {},
      });
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).code).toBe('reauthentication_required');
    });

    it('refuses a superadmin', async () => {
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/me/account-deletion',
        headers: superadmin.headers,
        payload: {},
      });
      expect(response.statusCode).toBe(409);
    });

    it('deletes the account and its sessions, and files the erasures asked for', async () => {
      const holder = await signIn(t, 'adulta@rights-b.example.com', 'bearer');
      await createMembership(database.admin, holder.userId, clubB, 'player');
      const m17 = await createCategory(database.admin, clubB, 'M17');
      const own = await insertPlayer(clubB, m17, '2001-02-03', holder.userId, 'Ana');
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/me/account-deletion',
        headers: holder.headers,
        payload: { requestErasure: true },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['clear-site-data']).toBe('"cookies"');
      const body = response.json<{
        outcome: string;
        erasureRequests: { id: string; clubId: string; playerId: string }[];
      }>();
      expect(body.outcome).toBe('deleted');
      expect(body.erasureRequests).toEqual([
        { id: expect.any(String) as string, clubId: clubB, playerId: own },
      ]);
      // The session is gone: the next request is anonymous.
      const me = await t.app.inject({ url: '/v1/me', headers: holder.headers });
      expect(me.statusCode).toBe(401);
      expect(
        (await database.admin.query('select 1 from "user" where id = $1', [holder.userId]))
          .rowCount,
      ).toBe(0);
      // The club sees the request, without an author.
      const seen = await t.app.inject({
        url: `/v1/data-subject-requests/${body.erasureRequests[0]?.id ?? ''}`,
        headers: adminB.headers,
      });
      expect(seen.json<RequestBody>()).toMatchObject({
        status: 'pending',
        requestedBy: null,
        requesterRole: 'player',
        player: { firstName: 'Ana' },
      });
    });

    it('anonymizes the account of a player who signed their consents', async () => {
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/me/account-deletion',
        headers: adultPlayer.headers,
        payload: {},
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<{ outcome: string }>().outcome).toBe('anonymized');
      const { rows } = await database.admin.query<{ email: string; name: string }>(
        'select email, name from "user" where id = $1',
        [adultPlayer.userId],
      );
      expect(rows).toEqual([{ email: `deleted.${adultPlayer.userId}@deleted.invalid`, name: '' }]);
      expect((await t.app.inject({ url: '/v1/me', headers: adultPlayer.headers })).statusCode).toBe(
        401,
      );
    });
  });
});
