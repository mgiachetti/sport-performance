/**
 * Kiosk mode end to end (B-504, ADR 0086) against Postgres 16: the staff
 * member signed in on the club's shared device loads wellness and RPE for a
 * player who picked themselves there (`*.kiosk_submit` in the matrix), the
 * row keeps the channel, the kiosk never corrects, the offline push resolves
 * the RPE of the named player, and the kiosk's roster says what each player
 * has left to load without any value.
 */
import { randomUUID } from 'node:crypto';
import { formatHlc, type ClubId } from '@sport-performance/domain';
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
  error: { code: string; message: string };
}

interface WellnessBody {
  id: string;
  playerId: string;
  channel: string;
  scores: Record<string, number>;
}

interface ParticipationBody {
  id: string;
  playerId: string;
  status: string;
  rpe: number | null;
  rpeChannel: string | null;
}

interface RosterEntry {
  player: { id: string; firstName: string; lastName: string };
  canReport: boolean;
  wellness: {
    localDate: string;
    stage: string;
    itemCount: number;
    items: string[];
    submitted: boolean;
  } | null;
  sessions: { session: { id: string }; rpeWindow: { closesAt: string }; state: string }[];
}

interface RosterPage {
  items: RosterEntry[];
  nextCursor: string | null;
  today: string;
  timeZone: string;
}

const DEVICE = '0123456789abcdef';
const SUPPORT_REASON = encodeURIComponent('Revisión del kiosco pedida por el club');
const THREE = { sleep: 4, fatigue: 3, soreness: 2 };
const FIVE = { sleep: 5, fatigue: 4, soreness: 4, stress: 3, mood: 4 };

function codeOf(response: LightMyRequestResponse): string {
  return response.json<Envelope>().error.code;
}

describeWithPostgres('kiosk mode (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let coachM13: SignedIn;
  let scM15: SignedIn;
  let medicalM13: SignedIn;
  let player13: SignedIn;
  let player15: SignedIn;
  let parent13: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let m13: string;
  let m15: string;
  let mB: string;
  let p13: string;
  let p13b: string;
  let p13NoConsent: string;
  let p15b: string;
  let sessionToday13: string;
  let sessionYesterday13: string;
  let sessionClosed13: string;
  let sessionToday15: string;

  async function insertCategory(clubId: ClubId, band: string, stage: string): Promise<string> {
    await database.admin.query(
      `insert into club_branch (club_id, sport, sex) values ($1, 'rugby', 'male')
       on conflict (club_id, sport, sex) do nothing`,
      [clubId],
    );
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
       values ($1, 'rugby', 'male', $2, upper($2), $3) returning id`,
      [clubId, band, stage],
    );
    return rows[0]?.id ?? '';
  }

  async function insertPlayer(
    clubId: ClubId,
    user: SignedIn | null,
    names: [string, string],
    birthDate: string,
    categoryId: string,
    consentSigner: SignedIn | null,
  ): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, $3, $4, $5, 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, user?.userId ?? null, names[0], names[1], birthDate],
    );
    const playerId = rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, playerId, categoryId],
    );
    if (consentSigner !== null) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, 'data', 'v1', 'guardian', $3)`,
        [clubId, playerId, consentSigner.userId],
      );
    }
    return playerId;
  }

  async function assign(membershipId: string, clubId: ClubId, categoryId: string): Promise<void> {
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, membershipId, categoryId],
    );
  }

  /** A session of `categoryId` that started `hoursAgo` hours ago, on its club day. */
  async function insertSession(clubId: ClubId, categoryId: string, hoursAgo: number) {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into training_session
         (club_id, sport, kind, category_id, title, starts_at, local_date, planned_duration_min)
       select $1, 'rugby', 'training', $2, 'Entrenamiento', s.at,
              (s.at at time zone c.time_zone)::date, 80
         from club c, (select now() - make_interval(hours => $3::int) as at) s
        where c.id = $1
       returning id`,
      [clubId, categoryId, hoursAgo],
    );
    return rows[0]?.id ?? '';
  }

  function postWellness(caller: SignedIn, payload: Record<string, unknown>) {
    return t.app.inject({
      method: 'POST',
      url: '/v1/wellness',
      headers: caller.headers,
      payload,
    });
  }

  function postRpe(caller: SignedIn, sessionId: string, payload: Record<string, unknown>) {
    return t.app.inject({
      method: 'POST',
      url: `/v1/training-sessions/${sessionId}/rpe`,
      headers: caller.headers,
      payload,
    });
  }

  async function roster(caller: Record<string, string>, categoryId: string, query = '') {
    return t.app.inject({
      url: `/v1/categories/${categoryId}/kiosk-roster${query}`,
      headers: caller,
    });
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
    coachM13 = await signIn(t, 'coach13@club-a.example.com');
    scM15 = await signIn(t, 'sc15@club-a.example.com');
    medicalM13 = await signIn(t, 'medical13@club-a.example.com');
    player13 = await signIn(t, 'player13@club-a.example.com');
    player15 = await signIn(t, 'player15@club-a.example.com');
    parent13 = await signIn(t, 'parent13@club-a.example.com');

    clubA = await createClub(database.admin, 'club-a');
    clubB = await createClub(database.admin, 'club-b');
    m13 = await insertCategory(clubA, 'm13', 'foundation');
    m15 = await insertCategory(clubA, 'm15', 'development');
    p13 = await insertPlayer(clubA, player13, ['Juan', 'Pérez'], '2013-05-04', m13, parent13);
    p13b = await insertPlayer(clubA, null, ['Ana', 'Acosta'], '2013-02-01', m13, parent13);
    p13NoConsent = await insertPlayer(clubA, null, ['Zoe', 'Zárate'], '2013-03-01', m13, null);
    await insertPlayer(clubA, player15, ['Tomás', 'Gómez'], '2011-05-04', m15, parent13);
    p15b = await insertPlayer(clubA, null, ['Luis', 'Bravo'], '2011-06-04', m15, parent13);
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, p13, parent13.userId],
    );

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await assign(
      await createMembership(database.admin, coachM13.userId, clubA, 'coach'),
      clubA,
      m13,
    );
    await assign(await createMembership(database.admin, scM15.userId, clubA, 'sc'), clubA, m15);
    await assign(
      await createMembership(database.admin, medicalM13.userId, clubA, 'medical'),
      clubA,
      m13,
    );
    await createMembership(database.admin, player13.userId, clubA, 'player');
    await createMembership(database.admin, player15.userId, clubA, 'player');
    await createMembership(database.admin, parent13.userId, clubA, 'parent');

    sessionToday13 = await insertSession(clubA, m13, 1);
    sessionYesterday13 = await insertSession(clubA, m13, 24);
    sessionClosed13 = await insertSession(clubA, m13, 24 * 4);
    sessionToday15 = await insertSession(clubA, m15, 1);

    mB = await insertCategory(clubB, 'm13', 'foundation');
    await insertPlayer(clubB, null, ['Otro', 'Club'], '2013-01-01', mB, null);
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('wellness on the kiosk', () => {
    it('the coach of the category loads it for a player, with the kiosk channel and as the author', async () => {
      const clientUuid = randomUUID();
      const response = await postWellness(coachM13, { clientUuid, playerId: p13, scores: THREE });
      expect(response.statusCode, response.body).toBe(201);
      const body = response.json<WellnessBody>();
      expect(body).toMatchObject({ playerId: p13, channel: 'kiosk', scores: THREE });
      const { rows } = await database.admin.query<{ created_by: string; via_kiosk: boolean }>(
        'select created_by, via_kiosk from wellness where id = $1',
        [body.id],
      );
      expect(rows[0]).toEqual({ created_by: coachM13.userId, via_kiosk: true });

      // A replay of the offline queue answers the same entry.
      const replay = await postWellness(coachM13, { clientUuid, playerId: p13, scores: THREE });
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.json<WellnessBody>().id).toBe(body.id);
      // A second check-in of the day, from the player's own account too, is a conflict.
      const again = await postWellness(player13, { scores: THREE });
      expect(again.statusCode, again.body).toBe(409);
    });

    it('asks the item set of the player’s stage', async () => {
      const wrong = await postWellness(scM15, { playerId: p15b, scores: THREE });
      expect(wrong.statusCode, wrong.body).toBe(400);
      expect(codeOf(wrong)).toBe('validation_failed');
      const right = await postWellness(scM15, { playerId: p15b, scores: FIVE });
      expect(right.statusCode, right.body).toBe(201);
    });

    it('the administration loads it in the whole club; the player’s own entry keeps its channel', async () => {
      const own = await postWellness(player15, { scores: FIVE });
      expect(own.statusCode, own.body).toBe(201);
      expect(own.json<WellnessBody>().channel).toBe('player_account');
      const admin = await postWellness(adminA, { playerId: p13b, scores: THREE });
      expect(admin.statusCode, admin.body).toBe(201);
      expect(admin.json<WellnessBody>().channel).toBe('kiosk');
    });

    it('denies the roles the kiosk is not for, players outside the assignment and without consent', async () => {
      for (const caller of [player13, player15, parent13, medicalM13]) {
        const response = await postWellness(caller, { playerId: p13NoConsent, scores: THREE });
        expect(response.statusCode, response.body).toBe(403);
      }
      const supporting = await t.app.inject({
        method: 'POST',
        url: '/v1/wellness',
        headers: {
          ...superadmin.headers,
          'x-support-club-id': clubA,
          'x-support-reason': SUPPORT_REASON,
        },
        payload: { playerId: p13NoConsent, scores: THREE },
      });
      expect(supporting.statusCode, supporting.body).toBe(403);
      // The S&C of M15 does not load an M13 player: not even visible to them (RLS).
      const outside = await postWellness(scM15, { playerId: p13NoConsent, scores: THREE });
      expect(outside.statusCode, outside.body).toBe(404);
      // Without a data consent nothing is collected.
      const noConsent = await postWellness(coachM13, { playerId: p13NoConsent, scores: THREE });
      expect(noConsent.statusCode, noConsent.body).toBe(403);
      // A player of another club does not exist here.
      const unknown = await postWellness(adminA, { playerId: randomUUID(), scores: THREE });
      expect(unknown.statusCode, unknown.body).toBe(404);
    });
  });

  describe('RPE on the kiosk', () => {
    it('creates the participation of a player with the kiosk channel', async () => {
      const response = await postRpe(coachM13, sessionToday13, {
        clientUuid: randomUUID(),
        playerId: p13,
        rpe: 6,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<ParticipationBody>()).toMatchObject({
        playerId: p13,
        status: 'full',
        rpe: 6,
        rpeChannel: 'kiosk',
      });
    });

    it('never corrects a reported RPE', async () => {
      const again = await postRpe(coachM13, sessionToday13, { playerId: p13, rpe: 7 });
      expect(again.statusCode, again.body).toBe(409);
      // The player corrects it from their own account, with a reason, and the channel follows.
      const own = await postRpe(player13, sessionToday13, {
        rpe: 7,
        changeReason: 'Me equivoqué en el kiosco',
      });
      expect(own.statusCode, own.body).toBe(200);
      expect(own.json<ParticipationBody>()).toMatchObject({ rpe: 7, rpeChannel: 'player_account' });
    });

    it('denies roles, assignments and missing consents like the wellness', async () => {
      for (const caller of [player15, parent13, medicalM13]) {
        const response = await postRpe(caller, sessionToday13, { playerId: p13b, rpe: 5 });
        expect(response.statusCode, response.body).toBe(403);
      }
      // Outside the assignment: the player is not visible (RLS).
      const outside = await postRpe(scM15, sessionToday13, { playerId: p13b, rpe: 5 });
      expect(outside.statusCode, outside.body).toBe(404);
      const noConsent = await postRpe(coachM13, sessionToday13, { playerId: p13NoConsent, rpe: 5 });
      expect(noConsent.statusCode, noConsent.body).toBe(403);
      // A player who is not in the session's category.
      const notIn = await postRpe(adminA, sessionToday13, { playerId: p15b, rpe: 5 });
      expect(notIn.statusCode, notIn.body).toBe(403);
    });

    it('goes through the offline push for the player it names', async () => {
      const push = await t.app.inject({
        method: 'POST',
        url: '/v1/sync/push',
        headers: scM15.headers,
        payload: {
          mutations: [
            {
              mutationId: randomUUID(),
              op: 'rpe.submit',
              hlc: formatHlc({ physicalMs: Date.now() - 60_000, counter: 0, node: DEVICE }),
              params: { trainingSessionId: sessionToday15 },
              body: { clientUuid: randomUUID(), playerId: p15b, rpe: 4 },
            },
          ],
        },
      });
      expect(push.statusCode, push.body).toBe(200);
      expect(push.json<{ results: { status: string }[] }>().results[0]?.status).toBe('applied');
      const { rows } = await database.admin.query<{ rpe: number; rpe_via_kiosk: boolean }>(
        'select rpe, rpe_via_kiosk from participation where training_session_id = $1 and player_id = $2',
        [sessionToday15, p15b],
      );
      expect(rows).toEqual([{ rpe: 4, rpe_via_kiosk: true }]);
    });

    it('an absence recorded by the staff clears the RPE and its channel', async () => {
      const reported = await postRpe(coachM13, sessionYesterday13, { playerId: p13b, rpe: 3 });
      expect(reported.statusCode, reported.body).toBe(200);
      const row = reported.json<ParticipationBody & { version: string }>();
      const absent = await t.app.inject({
        method: 'PATCH',
        url: `/v1/participations/${row.id}`,
        headers: coachM13.headers,
        payload: { version: row.version, status: 'absent', changeReason: 'No vino' },
      });
      expect(absent.statusCode, absent.body).toBe(200);
      expect(absent.json<ParticipationBody>()).toMatchObject({ rpe: null, rpeChannel: null });
    });
  });

  describe('roster of the kiosk', () => {
    it('lists the category today with what each player has left, and no values', async () => {
      const response = await roster(coachM13.headers, m13);
      expect(response.statusCode, response.body).toBe(200);
      const page = response.json<RosterPage>();
      expect(page.timeZone).toBe('America/Argentina/Buenos_Aires');
      expect(page.items.map((e) => e.player.lastName)).toEqual(['Acosta', 'Pérez', 'Zárate']);
      const byId = new Map(page.items.map((e) => [e.player.id, e]));

      const juan = byId.get(p13);
      expect(juan?.canReport).toBe(true);
      expect(juan?.wellness).toEqual({
        localDate: page.today,
        stage: 'foundation',
        itemCount: 3,
        items: ['sleep', 'fatigue', 'soreness'],
        submitted: true,
      });
      const juanSessions = new Map(juan?.sessions.map((s) => [s.session.id, s.state]));
      expect(juanSessions.get(sessionToday13)).toBe('reported');
      expect(juanSessions.get(sessionYesterday13)).toBe('pending');
      // A window that closed is not offered.
      expect(juanSessions.has(sessionClosed13)).toBe(false);
      // Another category's session neither.
      expect(juanSessions.has(sessionToday15)).toBe(false);

      const ana = byId.get(p13b);
      expect(ana?.wellness?.submitted).toBe(true);
      expect(
        new Map(ana?.sessions.map((s) => [s.session.id, s.state])).get(sessionYesterday13),
      ).toBe('not_taking_part');

      const zoe = byId.get(p13NoConsent);
      expect(zoe?.canReport).toBe(false);
      expect(zoe?.wellness?.submitted).toBe(false);

      // Nothing but names, states and the item set: no score, no value, no availability.
      const text = response.body;
      for (const leak of ['scores', 'meanScore', '"rpe"', 'availability', 'birthDate']) {
        expect(text).not.toContain(leak);
      }
    });

    it('pages by name', async () => {
      const first = await roster(coachM13.headers, m13, '?limit=2');
      const page = first.json<RosterPage>();
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();
      const second = await roster(
        coachM13.headers,
        m13,
        `?limit=2&cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
      );
      expect(second.json<RosterPage>().items.map((e) => e.player.lastName)).toEqual(['Zárate']);
    });

    it('is only for whoever loads on the kiosk, in their scope', async () => {
      expect((await roster(adminA.headers, m15)).statusCode).toBe(200);
      expect((await roster(scM15.headers, m15)).statusCode).toBe(200);
      expect((await roster(scM15.headers, m13)).statusCode).toBe(403);
      for (const caller of [player13, parent13, medicalM13]) {
        const response = await roster(caller.headers, m13);
        expect(response.statusCode, response.body).toBe(403);
      }
      const supporting = await roster(
        { ...superadmin.headers, 'x-support-club-id': clubA, 'x-support-reason': SUPPORT_REASON },
        m13,
      );
      expect(supporting.statusCode).toBe(403);
      // Another club's category does not exist here.
      expect((await roster(adminA.headers, mB)).statusCode).toBe(404);
    });
  });
});
