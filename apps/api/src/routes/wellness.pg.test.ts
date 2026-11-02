/**
 * Wellness end to end (B-319, ADR 0038) against Postgres 16, through the
 * real connection roles (ADR 0026): the item set of the player's stage that
 * day, one check-in per club day, the permission matrix in the handlers
 * (ADR 0025), RLS behind it, corrections with a reason in the change
 * history (ADR 0030) and the endpoint conventions (ADR 0032).
 */
import { randomUUID } from 'node:crypto';
import type { ClubId } from '@sport-performance/domain';
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

interface WellnessBody {
  id: string;
  playerId: string;
  localDate: string;
  itemCount: number;
  items: string[];
  scores: Record<string, number>;
  meanScore: number;
  submittedAt: string;
  version: string;
}

interface FormBody {
  playerId: string;
  localDate: string;
  stage: string;
  itemCount: number;
  items: string[];
  entry: WellnessBody | null;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Revisión de cargas de bienestar pedida por el club');
const THREE = { sleep: 4, fatigue: 3, soreness: 2 };
const FIVE = { sleep: 5, fatigue: 4, soreness: 4, stress: 3, mood: 4 };

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

function paths(response: LightMyRequestResponse): string[] {
  return (errorOf(response).details ?? []).map((d) => d.path.join('.'));
}

describeWithPostgres('wellness (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let coachM15: SignedIn;
  let coachM13: SignedIn;
  let player13: SignedIn;
  let player15: SignedIn;
  let playerNoConsent: SignedIn;
  let parent15: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let m13: string;
  let m15: string;
  let p13: string;
  let p15: string;
  let today: string;
  let yesterday: string;
  let entry13: WellnessBody;
  let entry15Yesterday: WellnessBody;
  let entryB: string;
  let oldEntry15: string;
  const submit13Uuid = randomUUID();

  const supporting = (clubId: string) => ({
    ...superadmin.headers,
    'x-support-club-id': clubId,
    'x-support-reason': SUPPORT_REASON,
  });

  async function addDays(date: string, days: number): Promise<string> {
    const { rows } = await database.admin.query<{ day: string }>(
      `select ($1::date + $2::int)::text as day`,
      [date, days],
    );
    return rows[0]?.day ?? '';
  }

  async function insertCategory(
    clubId: ClubId,
    band: string,
    stage: string,
    sport = 'rugby',
  ): Promise<string> {
    await database.admin.query(
      `insert into club_branch (club_id, sport, sex) values ($1, $2, 'male')
       on conflict (club_id, sport, sex) do nothing`,
      [clubId, sport],
    );
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
       values ($1, $2, 'male', $3, upper($3), $4) returning id`,
      [clubId, sport, band, stage],
    );
    return rows[0]?.id ?? '';
  }

  async function insertPlayer(
    clubId: ClubId,
    user: SignedIn | null,
    birthDate: string,
    categoryId: string,
    consentSigner: SignedIn | null,
  ): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', 'Pérez', $3, 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, user?.userId ?? null, birthDate],
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

  function post(
    caller: Record<string, string>,
    payload: unknown,
    extra: Record<string, string> = {},
  ) {
    return t.app.inject({
      method: 'POST',
      url: '/v1/wellness',
      headers: { ...caller, ...extra },
      payload: payload as Record<string, unknown>,
    });
  }

  function patch(caller: Record<string, string>, id: string, payload: unknown) {
    return t.app.inject({
      method: 'PATCH',
      url: `/v1/wellness/${id}`,
      headers: { ...caller, 'x-request-id': `req-correct-${id.slice(0, 8)}` },
      payload: payload as Record<string, unknown>,
    });
  }

  async function list(caller: Record<string, string>, query = ''): Promise<WellnessBody[]> {
    const response = await t.app.inject({ url: `/v1/wellness${query}`, headers: caller });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page<WellnessBody>>().items;
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
    coachM15 = await signIn(t, 'coach15@club-a.example.com');
    coachM13 = await signIn(t, 'coach13@club-a.example.com');
    player13 = await signIn(t, 'player13@club-a.example.com');
    player15 = await signIn(t, 'player15@club-a.example.com');
    playerNoConsent = await signIn(t, 'player-nc@club-a.example.com');
    parent15 = await signIn(t, 'parent15@club-a.example.com');

    clubA = await createClub(database.admin, 'club-a');
    clubB = await createClub(database.admin, 'club-b');
    const { rows } = await database.admin.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [clubA],
    );
    today = rows[0]?.today ?? '';
    yesterday = await addDays(today, -1);

    m13 = await insertCategory(clubA, 'm13', 'foundation');
    m15 = await insertCategory(clubA, 'm15', 'development');
    p13 = await insertPlayer(clubA, player13, '2013-05-04', m13, parent15);
    p15 = await insertPlayer(clubA, player15, '2011-05-04', m15, parent15);
    // In m15 without a data consent: the coach of m15 sees them, they cannot submit.
    await insertPlayer(clubA, playerNoConsent, '2011-08-01', m15, null);
    // A staff pin to `foundation` valid only yesterday: yesterday asks 3 items, today 5.
    await database.admin.query(
      `insert into player_stage (club_id, player_id, stage, basis, reason, valid_from, valid_to)
       values ($1, $2, 'foundation', 'manual', 'pinned', $3, $4)`,
      [clubA, p15, yesterday, today],
    );
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, p15, parent15.userId],
    );

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    await assign(
      await createMembership(database.admin, coachM15.userId, clubA, 'coach'),
      clubA,
      m15,
    );
    await assign(
      await createMembership(database.admin, coachM13.userId, clubA, 'coach'),
      clubA,
      m13,
    );
    for (const user of [player13, player15, playerNoConsent]) {
      await createMembership(database.admin, user.userId, clubA, 'player');
    }
    await createMembership(database.admin, parent15.userId, clubA, 'parent');

    // Club B: one entry that club A never sees.
    const mB = await insertCategory(clubB, 'm15', 'development');
    const pB = await insertPlayer(clubB, null, '2011-01-01', mB, adminB);
    const inserted = await database.admin.query<{ id: string }>(
      `insert into wellness (club_id, player_id, local_date, item_count, sleep, fatigue, soreness, stress, mood)
       values ($1, $2, $3, 5, 3, 3, 3, 3, 3) returning id`,
      [clubB, pB, today],
    );
    entryB = inserted.rows[0]?.id ?? '';
    // An old entry of p15, outside the correction window.
    const old = await database.admin.query<{ id: string }>(
      `insert into wellness (club_id, player_id, local_date, item_count, sleep, fatigue, soreness, stress, mood)
       values ($1, $2, $3, 5, 2, 2, 2, 2, 2) returning id`,
      [clubA, p15, await addDays(today, -5)],
    );
    oldEntry15 = old.rows[0]?.id ?? '';
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('form of the day', () => {
    it('asks the item set of the stage: 3 in foundation, 5 in development', async () => {
      const r13 = await t.app.inject({ url: '/v1/wellness/today', headers: player13.headers });
      expect(r13.statusCode, r13.body).toBe(200);
      expect(r13.json<FormBody>()).toEqual({
        playerId: p13,
        localDate: today,
        stage: 'foundation',
        itemCount: 3,
        items: ['sleep', 'fatigue', 'soreness'],
        entry: null,
      });
      const r15 = await t.app.inject({ url: '/v1/wellness/today', headers: player15.headers });
      expect(r15.json<FormBody>()).toMatchObject({
        stage: 'development',
        itemCount: 5,
        items: ['sleep', 'fatigue', 'soreness', 'stress', 'mood'],
      });
    });

    it('is only for a player with a data consent', async () => {
      for (const caller of [playerNoConsent, adminA, coachM15, parent15]) {
        const response = await t.app.inject({ url: '/v1/wellness/today', headers: caller.headers });
        expect(response.statusCode, response.body).toBe(403);
        expect(errorOf(response).message).toBe('You are not allowed to do this');
      }
    });
  });

  describe('submitting', () => {
    it('rejects items outside the set of the stage, or missing ones', async () => {
      const extra = await post(player13.headers, { scores: FIVE });
      expect(extra.statusCode).toBe(400);
      expect(errorOf(extra).code).toBe('validation_failed');
      expect(paths(extra)).toEqual(['body.scores.stress', 'body.scores.mood']);
      const missing = await post(player15.headers, { scores: THREE });
      expect(paths(missing)).toEqual(['body.scores.stress', 'body.scores.mood']);
      for (const scores of [
        { ...THREE, sleep: 0 },
        { ...THREE, sleep: 6 },
        { ...THREE, sleep: 2.5 },
        { ...THREE, pain: 1 },
      ]) {
        const invalid = await post(player13.headers, { scores });
        expect(invalid.statusCode, JSON.stringify(scores)).toBe(400);
      }
    });

    it('loads the check-in of the day with the version of its items', async () => {
      const response = await post(player13.headers, { clientUuid: submit13Uuid, scores: THREE });
      expect(response.statusCode, response.body).toBe(201);
      entry13 = response.json<WellnessBody>();
      expect(entry13).toMatchObject({
        playerId: p13,
        localDate: today,
        itemCount: 3,
        items: ['sleep', 'fatigue', 'soreness'],
        scores: THREE,
        meanScore: 3,
      });
      expect(response.headers['x-idempotent-replay']).toBeUndefined();
      const stored = await database.admin.query<{ created_by: string; mood: number | null }>(
        'select created_by, mood from wellness where id = $1',
        [entry13.id],
      );
      expect(stored.rows[0]).toEqual({ created_by: player13.userId, mood: null });

      const form = await t.app.inject({ url: '/v1/wellness/today', headers: player13.headers });
      expect(form.json<FormBody>().entry?.id).toBe(entry13.id);
    });

    it('replays the same submit by clientUuid and refuses a second one that day', async () => {
      const replay = await post(player13.headers, { clientUuid: submit13Uuid, scores: THREE });
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<WellnessBody>().id).toBe(entry13.id);

      const again = await post(player13.headers, { clientUuid: randomUUID(), scores: THREE });
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).code).toBe('conflict');
      const withoutUuid = await post(player13.headers, { scores: THREE });
      expect(withoutUuid.statusCode).toBe(409);
      const count = await database.admin.query<{ n: string }>(
        'select count(*) as n from wellness where player_id = $1',
        [p13],
      );
      expect(count.rows[0]?.n).toBe('1');
    });

    it('accepts yesterday with the stage of yesterday, never the future or earlier', async () => {
      // The pin makes yesterday a 3-item day for p15.
      const five = await post(player15.headers, { localDate: yesterday, scores: FIVE });
      expect(five.statusCode).toBe(400);
      const response = await post(player15.headers, { localDate: yesterday, scores: THREE });
      expect(response.statusCode, response.body).toBe(201);
      entry15Yesterday = response.json<WellnessBody>();
      expect(entry15Yesterday).toMatchObject({ localDate: yesterday, itemCount: 3 });

      for (const localDate of [await addDays(today, 1), await addDays(today, -2)]) {
        const outside = await post(player15.headers, { localDate, scores: FIVE });
        expect(outside.statusCode, localDate).toBe(400);
        expect(paths(outside)).toEqual(['body.localDate']);
      }
      const todays = await post(player15.headers, { scores: FIVE });
      expect(todays.statusCode, todays.body).toBe(201);
      expect(todays.json<WellnessBody>()).toMatchObject({
        localDate: today,
        itemCount: 5,
        meanScore: 4,
      });
    });

    it('is denied to a player without consent and to every other role', async () => {
      for (const caller of [playerNoConsent, adminA, coachM15, parent15]) {
        const response = await post(caller.headers, { scores: FIVE });
        expect(response.statusCode, response.body).toBe(403);
      }
      const superadminSubmit = await post(supporting(clubA), { scores: FIVE });
      expect(superadminSubmit.statusCode).toBe(403);
      const anonymous = await t.app.inject({
        method: 'POST',
        url: '/v1/wellness',
        payload: { scores: FIVE },
      });
      expect(anonymous.statusCode).toBe(401);
    });
  });

  describe('correcting', () => {
    it('needs the version, all the items of the entry and a reason', async () => {
      const response = await patch(player13.headers, entry13.id, {
        version: entry13.version,
        scores: { ...THREE, sleep: 5 },
        changeReason: 'Me equivoqué de carita',
      });
      expect(response.statusCode, response.body).toBe(200);
      const corrected = response.json<WellnessBody>();
      expect(corrected).toMatchObject({ itemCount: 3, scores: { ...THREE, sleep: 5 } });
      expect(corrected.version).not.toBe(entry13.version);

      const history = await database.admin.query<{
        reason: string;
        request_id: string;
        changed_columns: string[];
        actor_role: string;
      }>(
        `select reason, request_id, changed_columns, actor_role from change_history
          where table_name = 'wellness' and record_id = $1`,
        [entry13.id],
      );
      expect(history.rows).toEqual([
        {
          reason: 'Me equivoqué de carita',
          request_id: `req-correct-${entry13.id.slice(0, 8)}`,
          changed_columns: ['sleep'],
          actor_role: 'player',
        },
      ]);

      const stale = await patch(player13.headers, entry13.id, {
        version: entry13.version,
        scores: THREE,
        changeReason: 'Otra vez',
      });
      expect(stale.statusCode).toBe(409);
      entry13 = corrected;
    });

    it('validates the reason and keeps the item set of the entry', async () => {
      const withoutReason = await patch(player13.headers, entry13.id, {
        version: entry13.version,
        scores: THREE,
      });
      expect(withoutReason.statusCode).toBe(400);
      expect(paths(withoutReason)).toContain('body.changeReason');
      const blank = await patch(player13.headers, entry13.id, {
        version: entry13.version,
        scores: THREE,
        changeReason: '  ',
      });
      expect(blank.statusCode).toBe(400);
      const otherSet = await patch(player13.headers, entry13.id, {
        version: entry13.version,
        scores: FIVE,
        changeReason: 'Quiero cinco',
      });
      expect(otherSet.statusCode).toBe(400);
      expect(paths(otherSet)).toEqual(['body.scores.stress', 'body.scores.mood']);
    });

    it('is only for the player of the entry, inside the window', async () => {
      const payload = { version: entry13.version, scores: THREE, changeReason: 'Corrección' };
      for (const caller of [player15, adminA, coachM13, parent15]) {
        const response = await patch(caller.headers, entry13.id, payload);
        // RLS hides p13 from player15 and parent15 (404); the matrix denies the staff (403).
        expect([403, 404], response.body).toContain(response.statusCode);
      }
      expect((await patch(adminA.headers, entry13.id, payload)).statusCode).toBe(403);
      expect((await patch(player15.headers, entry13.id, payload)).statusCode).toBe(404);

      const old = await t.app.inject({
        url: `/v1/wellness/${oldEntry15}`,
        headers: player15.headers,
      });
      const outside = await patch(player15.headers, oldEntry15, {
        version: old.json<WellnessBody>().version,
        scores: FIVE,
        changeReason: 'Tarde',
      });
      expect(outside.statusCode).toBe(409);
      // Yesterday is still inside the window.
      const yesterdays = await patch(player15.headers, entry15Yesterday.id, {
        version: entry15Yesterday.version,
        scores: { ...THREE, fatigue: 1 },
        changeReason: 'Estaba más cansado',
      });
      expect(yesterdays.statusCode, yesterdays.body).toBe(200);
    });
  });

  describe('reading', () => {
    it('gives the admin and the supporting superadmin the whole club', async () => {
      const all = await list(adminA.headers);
      expect(new Set(all.map((w) => w.playerId))).toEqual(new Set([p13, p15]));
      expect(all).toHaveLength(4);
      // Default order: newest club day first.
      expect(all.map((w) => w.localDate)).toEqual(
        [...all.map((w) => w.localDate)].sort().reverse(),
      );
      const supported = await list(supporting(clubA));
      expect(supported).toHaveLength(4);
    });

    it('scopes the staff to their assignments and the player to themselves', async () => {
      expect(new Set((await list(coachM15.headers)).map((w) => w.playerId))).toEqual(
        new Set([p15]),
      );
      expect((await list(coachM13.headers)).map((w) => w.playerId)).toEqual([p13]);
      expect(new Set((await list(player15.headers)).map((w) => w.playerId))).toEqual(
        new Set([p15]),
      );
      expect(await list(playerNoConsent.headers)).toEqual([]);
      // The player cannot widen their scope with a filter.
      expect(await list(player15.headers, `?playerId=${p13}`)).toEqual([]);

      const own = await t.app.inject({
        url: `/v1/wellness/${entry13.id}`,
        headers: player13.headers,
      });
      expect(own.statusCode).toBe(200);
      const outOfScope = await t.app.inject({
        url: `/v1/wellness/${entry13.id}`,
        headers: coachM15.headers,
      });
      expect(outOfScope.statusCode).toBe(404);
      const inScope = await t.app.inject({
        url: `/v1/wellness/${entry13.id}`,
        headers: coachM13.headers,
      });
      expect(inScope.statusCode).toBe(200);
    });

    it('denies the guardian: wellness is not in the summary a parent reads', async () => {
      const response = await t.app.inject({ url: '/v1/wellness', headers: parent15.headers });
      expect(response.statusCode).toBe(403);
      const one = await t.app.inject({
        url: `/v1/wellness/${entry15Yesterday.id}`,
        headers: parent15.headers,
      });
      expect(one.statusCode).toBe(403);
    });

    it('never shows another club', async () => {
      const response = await t.app.inject({
        url: `/v1/wellness/${entryB}`,
        headers: adminA.headers,
      });
      expect(response.statusCode).toBe(404);
      expect(errorOf(response).code).toBe('not_found');
      expect((await list(adminB.headers)).map((w) => w.id)).toEqual([entryB]);
      const missing = await t.app.inject({
        url: `/v1/wellness/${randomUUID()}`,
        headers: adminA.headers,
      });
      expect(missing.statusCode).toBe(404);
    });

    it('filters by player, category on the day and dates, with cursors', async () => {
      expect((await list(adminA.headers, `?playerId=${p13}`)).map((w) => w.id)).toEqual([
        entry13.id,
      ]);
      expect(
        new Set((await list(adminA.headers, `?categoryId=${m15}`)).map((w) => w.playerId)),
      ).toEqual(new Set([p15]));
      const recent = await list(adminA.headers, `?from=${yesterday}&to=${today}&sort=localDate`);
      expect(recent.map((w) => w.localDate)).toEqual([yesterday, today, today]);

      const first = await t.app.inject({ url: '/v1/wellness?limit=2', headers: adminA.headers });
      const page1 = first.json<Page<WellnessBody>>();
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      const second = await t.app.inject({
        url: `/v1/wellness?limit=2&cursor=${page1.nextCursor ?? ''}`,
        headers: adminA.headers,
      });
      const page2 = second.json<Page<WellnessBody>>();
      expect(page2.items).toHaveLength(2);
      expect(page2.nextCursor).toBeNull();
      expect(new Set([...page1.items, ...page2.items].map((w) => w.id)).size).toBe(4);
      const reused = await t.app.inject({
        url: `/v1/wellness?limit=2&playerId=${p15}&cursor=${page1.nextCursor ?? ''}`,
        headers: adminA.headers,
      });
      expect(reused.statusCode).toBe(400);
    });
  });
});
