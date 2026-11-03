/**
 * Training sessions, drills, participation and the player's RPE end to end
 * (B-318) against Postgres 16, through the real connection role of the API
 * (ADR 0026): the permission matrix in the handlers (ADR 0025), RLS behind
 * it, the change history of corrections (ADR 0030) and the endpoint
 * conventions (ADR 0032). Players, categories and consents are arranged with
 * the owner connection (their endpoints belong to other issues).
 */
import { randomUUID } from 'node:crypto';
import type { ClubId, UserId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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

interface Envelope {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface DrillBody {
  id: string;
  name: string;
  sortOrder: number;
  durationMin: number | null;
  contactLevel: string;
  version: string;
}

interface SessionBody {
  id: string;
  sport: string;
  kind: string;
  categoryId: string | null;
  title: string | null;
  startsAt: string;
  localDate: string;
  plannedDurationMin: number | null;
  opponent: string | null;
  archivedAt: string | null;
  version: string;
  drills?: DrillBody[];
}

interface ParticipationBody {
  id: string;
  trainingSessionId: string;
  playerId: string;
  status: string;
  minutes: number | null;
  contactsN: number | null;
  rpe: number | null;
  rpeReportedAt: string | null;
  srpeAu: number | null;
  version: string;
  session?: { id: string; kind: string };
}

interface BatchBody {
  items: { outcome: string; participation: ParticipationBody }[];
}

interface MySessionBody {
  session: { id: string };
  participation: ParticipationBody | null;
  rpeWindow: { opensAt: string; closesAt: string };
  canSubmitRpe: boolean;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Revisión de la carga de sesiones pedida por el club');
const HOUR_MS = 60 * 60 * 1000;

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * HOUR_MS).toISOString();
}

describeWithPostgres('training sessions, participation and RPE (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let coachA: SignedIn;
  let idleCoach: SignedIn;
  let playerUser: SignedIn;
  let noConsentUser: SignedIn;
  let parentA: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let m15: string;
  let m17: string;
  let categoryB: string;
  /** M15 with a data consent: the player of `playerUser`. */
  let p1: string;
  /** M15 with a data consent. */
  let p2: string;
  /** M15 without consents: the player of `noConsentUser`. */
  let p3: string;
  /** M17 with a data consent: outside the coach's assignment. */
  let p4: string;
  /** Club B. */
  let pB: string;
  /** M15, started an hour ago: the RPE window is open. */
  let today: SessionBody;
  /** M17, by the administration. */
  let m17Session: SessionBody;
  const createUuid = randomUUID();

  const supporting = (clubId: string) => ({
    ...superadmin.headers,
    'x-support-club-id': clubId,
    'x-support-reason': SUPPORT_REASON,
  });

  async function insertCategory(clubId: ClubId, band: string, name: string): Promise<string> {
    await database.admin.query(
      `insert into club_branch (club_id, sport, sex) values ($1, 'rugby', 'male')
       on conflict (club_id, sport, sex) do nothing`,
      [clubId],
    );
    const stage = band === 'm17' ? 'performance' : 'development';
    const result = await database.admin.query<{ id: string }>(
      `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
       values ($1, 'rugby', 'male', $2, $3, $4) returning id`,
      [clubId, band, name, stage],
    );
    return result.rows[0]?.id ?? '';
  }

  async function insertPlayer(
    clubId: ClubId,
    categoryId: string,
    options: { userId?: UserId; consentSigner?: UserId } = {},
  ): Promise<string> {
    const result = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', 'Pérez', '2011-04-02', 'male', 'rugby', '2024-01-01') returning id`,
      [clubId, options.userId ?? null],
    );
    const id = result.rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, id, categoryId],
    );
    if (options.consentSigner !== undefined) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, 'data', 'v1', 'guardian', $3)`,
        [clubId, id, options.consentSigner],
      );
    }
    return id;
  }

  async function createSession(
    caller: SignedIn,
    payload: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> {
    return t.app.inject({
      method: 'POST',
      url: '/v1/training-sessions',
      headers: caller.headers,
      payload,
    });
  }

  async function batch(
    caller: SignedIn,
    sessionId: string,
    payload: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> {
    return t.app.inject({
      method: 'POST',
      url: `/v1/training-sessions/${sessionId}/participations/batch`,
      headers: caller.headers,
      payload,
    });
  }

  async function submitRpe(
    caller: SignedIn,
    sessionId: string,
    payload: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> {
    return t.app.inject({
      method: 'POST',
      url: `/v1/training-sessions/${sessionId}/rpe`,
      headers: caller.headers,
      payload,
    });
  }

  async function history(recordId: string) {
    const result = await database.admin.query<{
      changed_columns: string[];
      reason: string | null;
      request_id: string | null;
      actor_role: string | null;
    }>(
      `select changed_columns, reason, request_id, actor_role from change_history
        where record_id = $1 order by seq`,
      [recordId],
    );
    return result.rows;
  }

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
    superadmin = await signIn(t, 'soporte@plataforma.example.com');
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);
    adminA = await signIn(t, 'admin@club-a.example.com');
    adminB = await signIn(t, 'admin@club-b.example.com');
    coachA = await signIn(t, 'coach@club-a.example.com');
    idleCoach = await signIn(t, 'coach2@club-a.example.com');
    playerUser = await signIn(t, 'player@club-a.example.com', 'bearer');
    noConsentUser = await signIn(t, 'player2@club-a.example.com', 'bearer');
    parentA = await signIn(t, 'parent@club-a.example.com');

    clubA = await createClub(database.admin, 'club-a');
    clubB = await createClub(database.admin, 'club-b');
    m15 = await insertCategory(clubA, 'm15', 'M15');
    m17 = await insertCategory(clubA, 'm17', 'M17');
    categoryB = await insertCategory(clubB, 'm15', 'M15');

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    const coachMembership = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    await createMembership(database.admin, idleCoach.userId, clubA, 'coach');
    await createMembership(database.admin, playerUser.userId, clubA, 'player');
    await createMembership(database.admin, noConsentUser.userId, clubA, 'player');
    await createMembership(database.admin, parentA.userId, clubA, 'parent');
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, coachMembership, m15],
    );

    p1 = await insertPlayer(clubA, m15, {
      userId: playerUser.userId,
      consentSigner: parentA.userId,
    });
    p2 = await insertPlayer(clubA, m15, { consentSigner: parentA.userId });
    p3 = await insertPlayer(clubA, m15, { userId: noConsentUser.userId });
    p4 = await insertPlayer(clubA, m17, { consentSigner: parentA.userId });
    pB = await insertPlayer(clubB, categoryB, { consentSigner: adminB.userId });
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('sessions', () => {
    it('lets the coach create a session of an assigned category, with its drills', async () => {
      const response = await createSession(coachA, {
        clientUuid: createUuid,
        kind: 'training',
        categoryId: m15,
        startsAt: hoursFromNow(-1),
        plannedDurationMin: 60,
        title: 'Defensa en línea',
        drills: [
          { name: 'Entrada en calor', durationMin: 15 },
          { name: 'Tackle con escudos', durationMin: 20, contactLevel: 'controlled' },
          { name: 'Juego reducido', contactLevel: 'full' },
        ],
      });
      expect(response.statusCode, response.body).toBe(201);
      today = response.json<SessionBody>();
      expect(today).toMatchObject({
        sport: 'rugby',
        kind: 'training',
        categoryId: m15,
        plannedDurationMin: 60,
        archivedAt: null,
      });
      expect(today.drills?.map((d) => [d.name, d.sortOrder, d.contactLevel])).toEqual([
        ['Entrada en calor', 0, 'none'],
        ['Tackle con escudos', 1, 'controlled'],
        ['Juego reducido', 2, 'full'],
      ]);
    });

    it('replays the same create by clientUuid without duplicating', async () => {
      const response = await createSession(coachA, {
        clientUuid: createUuid,
        kind: 'training',
        categoryId: m15,
        startsAt: hoursFromNow(-1),
        drills: [{ name: 'Entrada en calor' }],
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.headers['x-idempotent-replay']).toBe('true');
      const body = response.json<SessionBody>();
      expect(body.id).toBe(today.id);
      expect(body.drills).toHaveLength(3);
      const count = await database.admin.query<{ n: string }>(
        'select count(*) as n from drill where training_session_id = $1',
        [today.id],
      );
      expect(count.rows[0]?.n).toBe('3');
    });

    it('computes the club day of the start in the club time zone', async () => {
      // 23:30 in Buenos Aires (UTC−3) is already the next day in UTC.
      const response = await createSession(adminA, {
        kind: 'match',
        categoryId: m17,
        startsAt: '2026-03-10T02:30:00Z',
        opponent: 'CASI',
      });
      expect(response.statusCode, response.body).toBe(201);
      m17Session = response.json<SessionBody>();
      expect(m17Session.localDate).toBe('2026-03-09');
      expect(m17Session.opponent).toBe('CASI');
    });

    it('denies sessions of other categories, and anything to players and parents', async () => {
      const outside = await createSession(coachA, {
        kind: 'training',
        categoryId: m17,
        startsAt: hoursFromNow(1),
      });
      expect(outside.statusCode).toBe(403);
      expect(errorOf(outside).code).toBe('forbidden');
      for (const caller of [playerUser, parentA]) {
        const create = await createSession(caller, {
          kind: 'training',
          categoryId: m15,
          startsAt: hoursFromNow(1),
        });
        expect(create.statusCode).toBe(403);
        const list = await t.app.inject({ url: '/v1/training-sessions', headers: caller.headers });
        expect(list.statusCode).toBe(403);
      }
      const read = await t.app.inject({
        url: `/v1/training-sessions/${m17Session.id}`,
        headers: coachA.headers,
      });
      expect(read.statusCode).toBe(403);
    });

    it('validates the category and the opponent', async () => {
      const otherClub = await createSession(adminA, {
        kind: 'training',
        categoryId: categoryB,
        startsAt: hoursFromNow(1),
      });
      expect(otherClub.statusCode).toBe(400);
      expect(errorOf(otherClub).details?.[0]?.path).toEqual(['body', 'categoryId']);
      const opponent = await createSession(adminA, {
        kind: 'training',
        categoryId: m15,
        startsAt: hoursFromNow(1),
        opponent: 'SIC',
      });
      expect(opponent.statusCode).toBe(400);
      expect(errorOf(opponent).code).toBe('validation_failed');
    });

    it('hides the sessions of another club (404)', async () => {
      const response = await t.app.inject({
        url: `/v1/training-sessions/${today.id}`,
        headers: adminB.headers,
      });
      expect(response.statusCode).toBe(404);
      const patch = await t.app.inject({
        method: 'PATCH',
        url: `/v1/training-sessions/${today.id}`,
        headers: adminB.headers,
        payload: { version: today.version, title: 'X' },
      });
      expect(patch.statusCode).toBe(404);
    });

    it('lists by assignment with filters and cursor pagination', async () => {
      const future = await createSession(coachA, {
        kind: 'match',
        categoryId: m15,
        startsAt: hoursFromNow(48),
        opponent: 'Hindú',
      });
      expect(future.statusCode, future.body).toBe(201);

      const coach = await t.app.inject({ url: '/v1/training-sessions', headers: coachA.headers });
      expect(coach.statusCode, coach.body).toBe(200);
      const coachIds = coach.json<Page<SessionBody>>().items.map((s) => s.id);
      expect(coachIds).toContain(today.id);
      expect(coachIds).not.toContain(m17Session.id);

      const admin = await t.app.inject({
        url: '/v1/training-sessions?sort=startsAt&limit=1',
        headers: adminA.headers,
      });
      const first = admin.json<Page<SessionBody>>();
      expect(first.items.map((s) => s.id)).toEqual([m17Session.id]);
      expect(first.nextCursor).not.toBeNull();
      const second = await t.app.inject({
        url: `/v1/training-sessions?sort=startsAt&limit=1&cursor=${first.nextCursor ?? ''}`,
        headers: adminA.headers,
      });
      expect(second.json<Page<SessionBody>>().items.map((s) => s.id)).toEqual([today.id]);
      const otherFilters = await t.app.inject({
        url: `/v1/training-sessions?sort=startsAt&limit=1&kind=match&cursor=${first.nextCursor ?? ''}`,
        headers: adminA.headers,
      });
      expect(otherFilters.statusCode).toBe(400);

      const matches = await t.app.inject({
        url: `/v1/training-sessions?kind=match&from=${today.localDate}`,
        headers: adminA.headers,
      });
      expect(matches.json<Page<SessionBody>>().items.map((s) => s.kind)).toEqual(['match']);

      // By sport (the staff web's scope selector with a sport and no category).
      const rugby = await t.app.inject({
        url: '/v1/training-sessions?sport=rugby',
        headers: adminA.headers,
      });
      expect(rugby.json<Page<SessionBody>>().items.length).toBeGreaterThan(0);
      const hockey = await t.app.inject({
        url: '/v1/training-sessions?sport=hockey',
        headers: adminA.headers,
      });
      expect(hockey.statusCode, hockey.body).toBe(200);
      expect(hockey.json<Page<SessionBody>>().items).toEqual([]);

      const idle = await t.app.inject({ url: '/v1/training-sessions', headers: idleCoach.headers });
      expect(idle.statusCode).toBe(200);
      expect(idle.json<Page<SessionBody>>().items).toEqual([]);
    });

    it('lets a superadmin read with a support reason, never without', async () => {
      const ok = await t.app.inject({ url: '/v1/training-sessions', headers: supporting(clubA) });
      expect(ok.statusCode, ok.body).toBe(200);
      const missing = await t.app.inject({
        url: '/v1/training-sessions',
        headers: { ...superadmin.headers, 'x-support-club-id': clubA },
      });
      expect(missing.statusCode).toBe(403);
    });

    it('edits with the version; correcting a submitted value needs a reason, recorded', async () => {
      const fill = await t.app.inject({
        method: 'PATCH',
        url: `/v1/training-sessions/${m17Session.id}`,
        headers: adminA.headers,
        payload: { version: m17Session.version, location: 'Cancha 2' },
      });
      expect(fill.statusCode, fill.body).toBe(200);
      const filled = fill.json<SessionBody>();

      const stale = await t.app.inject({
        method: 'PATCH',
        url: `/v1/training-sessions/${m17Session.id}`,
        headers: adminA.headers,
        payload: { version: m17Session.version, notes: 'x' },
      });
      expect(stale.statusCode).toBe(409);

      const unreasoned = await t.app.inject({
        method: 'PATCH',
        url: `/v1/training-sessions/${m17Session.id}`,
        headers: adminA.headers,
        payload: { version: filled.version, startsAt: '2026-03-10T21:00:00Z' },
      });
      expect(unreasoned.statusCode).toBe(400);
      expect(errorOf(unreasoned).details?.[0]?.path).toEqual(['body', 'changeReason']);

      const corrected = await t.app.inject({
        method: 'PATCH',
        url: `/v1/training-sessions/${m17Session.id}`,
        headers: { ...adminA.headers, 'x-request-id': 'req-move-match' },
        payload: {
          version: filled.version,
          startsAt: '2026-03-10T21:00:00Z',
          changeReason: 'Se pasó el partido al martes',
        },
      });
      expect(corrected.statusCode, corrected.body).toBe(200);
      m17Session = corrected.json<SessionBody>();
      expect(m17Session.localDate).toBe('2026-03-10');
      const entries = await history(m17Session.id);
      expect(entries.at(-1)).toMatchObject({
        reason: 'Se pasó el partido al martes',
        request_id: 'req-move-match',
        actor_role: 'admin',
      });
      expect(entries.at(-1)?.changed_columns).toEqual(['local_date', 'starts_at']);

      const toTraining = await t.app.inject({
        method: 'PATCH',
        url: `/v1/training-sessions/${m17Session.id}`,
        headers: adminA.headers,
        payload: { version: m17Session.version, kind: 'training' },
      });
      expect(toTraining.statusCode).toBe(400);
    });

    it('archives and restores without a reason, idempotently', async () => {
      const archived = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${m17Session.id}/archive`,
        headers: adminA.headers,
      });
      expect(archived.statusCode, archived.body).toBe(200);
      expect(archived.json<SessionBody>().archivedAt).not.toBeNull();
      const again = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${m17Session.id}/archive`,
        headers: adminA.headers,
      });
      expect(again.json<SessionBody>().archivedAt).toBe(archived.json<SessionBody>().archivedAt);

      const active = await t.app.inject({ url: '/v1/training-sessions', headers: adminA.headers });
      expect(active.json<Page<SessionBody>>().items.map((s) => s.id)).not.toContain(m17Session.id);
      const listArchived = await t.app.inject({
        url: '/v1/training-sessions?status=archived',
        headers: adminA.headers,
      });
      expect(listArchived.json<Page<SessionBody>>().items.map((s) => s.id)).toEqual([
        m17Session.id,
      ]);

      const drillOnArchived = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${m17Session.id}/drills`,
        headers: adminA.headers,
        payload: { name: 'Scrum' },
      });
      expect(drillOnArchived.statusCode).toBe(409);
      const participationOnArchived = await batch(adminA, m17Session.id, {
        rows: [{ clientUuid: randomUUID(), playerId: p4, status: 'full', minutes: 70 }],
      });
      expect(participationOnArchived.statusCode).toBe(409);

      const restored = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${m17Session.id}/restore`,
        headers: adminA.headers,
      });
      expect(restored.statusCode, restored.body).toBe(200);
      expect(restored.json<SessionBody>().archivedAt).toBeNull();
      expect((await history(m17Session.id)).slice(-2).map((e) => e.reason)).toEqual([null, null]);
    });
  });

  describe('drills', () => {
    let added: DrillBody;
    const drillUuid = randomUUID();

    it('adds a drill at the end, idempotently', async () => {
      const response = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${today.id}/drills`,
        headers: coachA.headers,
        payload: { clientUuid: drillUuid, name: 'Vuelta a la calma', durationMin: 10 },
      });
      expect(response.statusCode, response.body).toBe(201);
      added = response.json<DrillBody>();
      expect(added.sortOrder).toBe(3);
      const replay = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${today.id}/drills`,
        headers: coachA.headers,
        payload: { clientUuid: drillUuid, name: 'Vuelta a la calma', durationMin: 10 },
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<DrillBody>().id).toBe(added.id);
      const elsewhere = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${m17Session.id}/drills`,
        headers: adminA.headers,
        payload: { clientUuid: drillUuid, name: 'Otro' },
      });
      expect(elsewhere.statusCode).toBe(409);
    });

    it('edits with the version and deletes', async () => {
      const edited = await t.app.inject({
        method: 'PATCH',
        url: `/v1/drills/${added.id}`,
        headers: coachA.headers,
        payload: { version: added.version, contactLevel: 'controlled', durationMin: null },
      });
      expect(edited.statusCode, edited.body).toBe(200);
      expect(edited.json<DrillBody>()).toMatchObject({
        contactLevel: 'controlled',
        durationMin: null,
      });
      const stale = await t.app.inject({
        method: 'PATCH',
        url: `/v1/drills/${added.id}`,
        headers: coachA.headers,
        payload: { version: added.version, name: 'X' },
      });
      expect(stale.statusCode).toBe(409);

      const foreign = await t.app.inject({
        method: 'DELETE',
        url: `/v1/drills/${added.id}`,
        headers: adminB.headers,
      });
      expect(foreign.statusCode).toBe(404);
      const denied = await t.app.inject({
        method: 'DELETE',
        url: `/v1/drills/${added.id}`,
        headers: playerUser.headers,
      });
      expect(denied.statusCode).toBe(403);
      const removed = await t.app.inject({
        method: 'DELETE',
        url: `/v1/drills/${added.id}`,
        headers: coachA.headers,
      });
      expect(removed.statusCode).toBe(204);
      const gone = await t.app.inject({
        method: 'DELETE',
        url: `/v1/drills/${added.id}`,
        headers: coachA.headers,
      });
      expect(gone.statusCode).toBe(404);
    });
  });

  describe('participation', () => {
    const rowP1 = randomUUID();
    const rowP2 = randomUUID();
    let p2Row: ParticipationBody;

    it('records the session in bulk, idempotently per row', async () => {
      const payload = {
        rows: [
          { clientUuid: rowP1, playerId: p1, status: 'full', minutes: 60 },
          { clientUuid: rowP2, playerId: p2, status: 'partial', minutes: 30, contactsN: 5 },
        ],
      };
      const response = await batch(coachA, today.id, payload);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<BatchBody>();
      expect(body.items.map((i) => i.outcome)).toEqual(['created', 'created']);
      p2Row = body.items[1]?.participation ?? p2Row;
      expect(p2Row).toMatchObject({ status: 'partial', minutes: 30, contactsN: 5, srpeAu: null });

      const replay = await batch(coachA, today.id, payload);
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json<BatchBody>().items.map((i) => i.outcome)).toEqual([
        'replayed',
        'replayed',
      ]);
      const count = await database.admin.query<{ n: string }>(
        'select count(*) as n from participation where training_session_id = $1',
        [today.id],
      );
      expect(count.rows[0]?.n).toBe('2');
    });

    it('needs a data consent and an assigned player', async () => {
      const noConsent = await batch(coachA, today.id, {
        rows: [{ clientUuid: randomUUID(), playerId: p3, status: 'full', minutes: 60 }],
      });
      expect(noConsent.statusCode).toBe(403);
      // Outside the coach's scope (RLS hides them) or of another club: an unknown player.
      for (const playerId of [p4, pB]) {
        const unknown = await batch(coachA, today.id, {
          rows: [
            { clientUuid: randomUUID(), playerId: p1, status: 'full', minutes: 60 },
            { clientUuid: randomUUID(), playerId, status: 'full', minutes: 60 },
          ],
        });
        expect(unknown.statusCode, unknown.body).toBe(400);
        expect(errorOf(unknown).details?.[0]?.path).toEqual(['body', 'rows', 1, 'playerId']);
      }
      const asPlayer = await batch(playerUser, today.id, {
        rows: [{ clientUuid: randomUUID(), playerId: p1, status: 'full', minutes: 60 }],
      });
      expect(asPlayer.statusCode).toBe(403);
      const foreign = await batch(adminB, today.id, {
        rows: [{ clientUuid: randomUUID(), playerId: pB, status: 'full', minutes: 60 }],
      });
      expect(foreign.statusCode).toBe(404);
    });

    it('rejects load for absent players and repeated rows in the contract', async () => {
      const response = await batch(coachA, today.id, {
        rows: [
          { clientUuid: randomUUID(), playerId: p1, status: 'absent', minutes: 30 },
          { clientUuid: randomUUID(), playerId: p1, status: 'full' },
        ],
      });
      expect(response.statusCode).toBe(400);
      const paths = errorOf(response).details?.map((d) => d.path.join('.'));
      expect(paths).toEqual(
        expect.arrayContaining(['body.rows.0.minutes', 'body.rows.1.playerId']),
      );
    });

    it('corrects submitted values only with a reason and the current version', async () => {
      const same = await batch(coachA, today.id, {
        rows: [{ clientUuid: randomUUID(), playerId: p2, status: 'partial', minutes: 30 }],
      });
      expect(same.json<BatchBody>().items[0]?.outcome).toBe('unchanged');

      const unreasoned = await t.app.inject({
        method: 'PATCH',
        url: `/v1/participations/${p2Row.id}`,
        headers: coachA.headers,
        payload: { version: p2Row.version, minutes: 45 },
      });
      expect(unreasoned.statusCode).toBe(400);
      expect(errorOf(unreasoned).details?.[0]?.path).toEqual(['body', 'changeReason']);

      const corrected = await t.app.inject({
        method: 'PATCH',
        url: `/v1/participations/${p2Row.id}`,
        headers: coachA.headers,
        payload: {
          version: p2Row.version,
          minutes: 45,
          changeReason: 'Entró en el segundo tiempo',
        },
      });
      expect(corrected.statusCode, corrected.body).toBe(200);
      expect(corrected.json<ParticipationBody>().minutes).toBe(45);
      expect((await history(p2Row.id)).at(-1)).toMatchObject({
        changed_columns: ['minutes'],
        reason: 'Entró en el segundo tiempo',
        actor_role: 'coach',
      });

      const stalePatch = await t.app.inject({
        method: 'PATCH',
        url: `/v1/participations/${p2Row.id}`,
        headers: coachA.headers,
        payload: { version: p2Row.version, minutes: 50, changeReason: 'Otra corrección' },
      });
      expect(stalePatch.statusCode).toBe(409);
      const staleBatch = await batch(coachA, today.id, {
        changeReason: 'Otra corrección',
        rows: [
          {
            clientUuid: randomUUID(),
            playerId: p2,
            status: 'partial',
            minutes: 50,
            version: p2Row.version,
          },
        ],
      });
      expect(staleBatch.statusCode).toBe(409);

      const foreign = await t.app.inject({
        method: 'PATCH',
        url: `/v1/participations/${p2Row.id}`,
        headers: adminB.headers,
        payload: { version: p2Row.version, minutes: 50 },
      });
      expect(foreign.statusCode).toBe(404);
    });

    it('lists by scope: the staff their players, the player their own', async () => {
      const coach = await t.app.inject({
        url: `/v1/participations?trainingSessionId=${today.id}`,
        headers: coachA.headers,
      });
      expect(coach.statusCode, coach.body).toBe(200);
      const items = coach.json<Page<ParticipationBody>>().items;
      expect(items.map((i) => i.playerId).sort()).toEqual([p1, p2].sort());
      expect(items[0]?.session).toMatchObject({ id: today.id, kind: 'training' });

      const own = await t.app.inject({ url: '/v1/participations', headers: playerUser.headers });
      expect(own.statusCode, own.body).toBe(200);
      expect(own.json<Page<ParticipationBody>>().items.map((i) => i.playerId)).toEqual([p1]);

      const idle = await t.app.inject({ url: '/v1/participations', headers: idleCoach.headers });
      expect(idle.json<Page<ParticipationBody>>().items).toEqual([]);
      const parent = await t.app.inject({ url: '/v1/participations', headers: parentA.headers });
      expect(parent.statusCode).toBe(403);
    });
  });

  describe('RPE of the player', () => {
    let p1Row: ParticipationBody;

    it('submits the own RPE within the window; sRPE is generated', async () => {
      const response = await submitRpe(playerUser, today.id, { rpe: 7 });
      expect(response.statusCode, response.body).toBe(200);
      p1Row = response.json<ParticipationBody>();
      expect(p1Row).toMatchObject({
        playerId: p1,
        status: 'full',
        minutes: 60,
        rpe: 7,
        srpeAu: 420,
      });
      expect(p1Row.rpeReportedAt).not.toBeNull();
      // The same value again changes nothing.
      const same = await submitRpe(playerUser, today.id, { rpe: 7 });
      expect(same.json<ParticipationBody>().version).toBe(p1Row.version);
    });

    it('needs a reason to correct a submitted RPE', async () => {
      const unreasoned = await submitRpe(playerUser, today.id, { rpe: 8 });
      expect(unreasoned.statusCode).toBe(400);
      expect(errorOf(unreasoned).details?.[0]?.path).toEqual(['body', 'changeReason']);
      const corrected = await submitRpe(playerUser, today.id, {
        rpe: 8,
        changeReason: 'Me equivoqué de número',
      });
      expect(corrected.statusCode, corrected.body).toBe(200);
      expect(corrected.json<ParticipationBody>().srpeAu).toBe(480);
      expect((await history(p1Row.id)).at(-1)).toMatchObject({
        reason: 'Me equivoqué de número',
        actor_role: 'player',
      });
    });

    it('creates the participation when the staff has not recorded it, idempotently', async () => {
      const other = await createSession(coachA, {
        kind: 'training',
        categoryId: m15,
        startsAt: hoursFromNow(-3),
        plannedDurationMin: 90,
      });
      const session = other.json<SessionBody>();
      const clientUuid = randomUUID();
      const response = await submitRpe(playerUser, session.id, { clientUuid, rpe: 5 });
      expect(response.statusCode, response.body).toBe(200);
      const created = response.json<ParticipationBody>();
      expect(created).toMatchObject({ status: 'full', minutes: 90, rpe: 5, srpeAu: 450 });
      const replay = await submitRpe(playerUser, session.id, { clientUuid, rpe: 5 });
      expect(replay.statusCode).toBe(200);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<ParticipationBody>().id).toBe(created.id);
    });

    it('refuses outside the window', async () => {
      for (const hours of [24, -24 * 4]) {
        const created = await createSession(coachA, {
          kind: 'training',
          categoryId: m15,
          startsAt: hoursFromNow(hours),
          plannedDurationMin: 60,
        });
        const response = await submitRpe(playerUser, created.json<SessionBody>().id, { rpe: 6 });
        expect(response.statusCode, response.body).toBe(409);
      }
    });

    it('is only for the player, with a consent, in their own sessions', async () => {
      const coach = await submitRpe(coachA, today.id, { rpe: 6 });
      expect(coach.statusCode).toBe(403);
      const noConsent = await submitRpe(noConsentUser, today.id, { rpe: 6 });
      expect(noConsent.statusCode).toBe(403);
      const m17Today = await createSession(adminA, {
        kind: 'training',
        categoryId: m17,
        startsAt: hoursFromNow(-1),
      });
      const notMine = await submitRpe(playerUser, m17Today.json<SessionBody>().id, { rpe: 6 });
      expect(notMine.statusCode).toBe(403);
      const foreign = await submitRpe(playerUser, randomUUID(), { rpe: 6 });
      expect(foreign.statusCode).toBe(404);
      const outOfScale = await submitRpe(playerUser, today.id, { rpe: 11 });
      expect(outOfScale.statusCode).toBe(400);
    });

    it('lists the player’s sessions with what is pending', async () => {
      const response = await t.app.inject({
        url: '/v1/me/training-sessions',
        headers: playerUser.headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      const items = response.json<Page<MySessionBody>>().items;
      const current = items.find((i) => i.session.id === today.id);
      expect(current).toMatchObject({ canSubmitRpe: true, participation: { rpe: 8 } });
      expect(items.every((i) => i.session.id !== m17Session.id)).toBe(true);
      const future = items.find((i) => new Date(i.rpeWindow.opensAt).getTime() > Date.now());
      expect(future?.canSubmitRpe).toBe(false);

      const coach = await t.app.inject({
        url: '/v1/me/training-sessions',
        headers: coachA.headers,
      });
      expect(coach.statusCode).toBe(403);
    });

    it('clears the RPE when the staff marks the player absent, with a reason', async () => {
      const current = await t.app.inject({
        url: `/v1/participations?trainingSessionId=${today.id}&playerId=${p1}`,
        headers: coachA.headers,
      });
      const row = current.json<Page<ParticipationBody>>().items[0];
      const unreasoned = await batch(coachA, today.id, {
        rows: [{ clientUuid: randomUUID(), playerId: p1, status: 'absent', version: row?.version }],
      });
      expect(unreasoned.statusCode).toBe(400);
      const absent = await batch(coachA, today.id, {
        changeReason: 'No vino: se cargó por error',
        rows: [{ clientUuid: randomUUID(), playerId: p1, status: 'absent', version: row?.version }],
      });
      expect(absent.statusCode, absent.body).toBe(200);
      expect(absent.json<BatchBody>().items[0]).toMatchObject({
        outcome: 'updated',
        participation: { status: 'absent', minutes: null, rpe: null, srpeAu: null },
      });
      const rpe = await submitRpe(playerUser, today.id, { rpe: 6 });
      expect(rpe.statusCode).toBe(409);
    });
  });
});
