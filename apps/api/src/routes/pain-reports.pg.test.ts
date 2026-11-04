/**
 * Pain reports of the wellness end to end (B-609, ADR 0078) against Postgres
 * 16 through the real connection roles: only the player answers (data and
 * health consents, modules on), it lands in the `medical` schema, the
 * assigned medical staff reads and reviews it with every access logged, the
 * holder reads their own, and the coach, the S&C staff and the
 * administration never see it, not even through the wellness.
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
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface PainReportBody {
  id: string;
  clientUuid: string;
  playerId: string;
  localDate: string;
  hasPain: boolean;
  areas: { region: string; side: string; intensity: number }[];
  comment: string | null;
  maxIntensity: number;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

interface FormBody {
  playerId: string;
  localDate: string;
  enabled: boolean;
  unavailableReason: string | null;
  latest: PainReportBody | null;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Revisión de reportes de dolor pedida por el club');

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

function paths(response: LightMyRequestResponse): string[] {
  return (errorOf(response).details ?? []).map((d) => d.path.join('.'));
}

describeWithPostgres('pain reports (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let coachM15: SignedIn;
  let scA: SignedIn;
  let medicalM15: SignedIn;
  let medicalM17: SignedIn;
  let player15: SignedIn;
  let playerNoHealth: SignedIn;
  let parent15: SignedIn;
  let playerB: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let m15: string;
  let p15: string;
  let today: string;
  let yesterday: string;

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
    categoryId: string,
    consents: ('data' | 'health')[],
    signer: SignedIn,
  ): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', 'Pérez', '2011-05-04', 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, user?.userId ?? null],
    );
    const playerId = rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, playerId, categoryId],
    );
    for (const type of consents) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, $3, 'v1', 'guardian', $4)`,
        [clubId, playerId, type, signer.userId],
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

  async function turnOn(clubId: ClubId): Promise<void> {
    await database.admin.query(
      `update club set settings = jsonb_set(settings, '{modules}',
         '{"wellness": true, "pain_report": true}'::jsonb) where id = $1`,
      [clubId],
    );
  }

  function submit(caller: SignedIn, payload: unknown, extra: Record<string, string> = {}) {
    return t.app.inject({
      method: 'POST',
      url: '/v1/pain-reports',
      headers: { ...caller.headers, ...extra },
      payload: payload as Record<string, unknown>,
    });
  }

  function list(headers: Record<string, string>, query = '') {
    return t.app.inject({ url: `/v1/pain-reports${query}`, headers });
  }

  function review(caller: SignedIn, id: string) {
    return t.app.inject({
      method: 'POST',
      url: `/v1/pain-reports/${id}/review`,
      headers: caller.headers,
    });
  }

  async function logOf(requestId: string) {
    const { rows } = await database.admin.query<{
      action: string;
      resource: string;
      actor_role: string;
    }>(
      `select action::text, resource, actor_role from medical.access_log
        where request_id = $1 order by occurred_at, resource`,
      [requestId],
    );
    return rows;
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
    coachM15 = await signIn(t, 'coach15@club-a.example.com');
    scA = await signIn(t, 'sc@club-a.example.com');
    medicalM15 = await signIn(t, 'medico15@club-a.example.com');
    medicalM17 = await signIn(t, 'medico17@club-a.example.com');
    player15 = await signIn(t, 'player15@club-a.example.com');
    playerNoHealth = await signIn(t, 'player-nh@club-a.example.com');
    parent15 = await signIn(t, 'parent15@club-a.example.com');
    playerB = await signIn(t, 'player@club-b.example.com');

    clubA = await createClub(database.admin, 'club-a');
    clubB = await createClub(database.admin, 'club-b');
    await turnOn(clubA);
    const { rows } = await database.admin.query<{ today: string; yesterday: string }>(
      `select (now() at time zone time_zone)::date::text as today,
              ((now() at time zone time_zone)::date - 1)::text as yesterday
         from club where id = $1`,
      [clubA],
    );
    today = rows[0]?.today ?? '';
    yesterday = rows[0]?.yesterday ?? '';

    m15 = await insertCategory(clubA, 'm15', 'development');
    const m17 = await insertCategory(clubA, 'm17', 'performance');
    p15 = await insertPlayer(clubA, player15, m15, ['data', 'health'], parent15);
    await insertPlayer(clubA, playerNoHealth, m15, ['data'], parent15);
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, p15, parent15.userId],
    );

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await assign(
      await createMembership(database.admin, coachM15.userId, clubA, 'coach'),
      clubA,
      m15,
    );
    await assign(await createMembership(database.admin, scA.userId, clubA, 'sc'), clubA, m15);
    await assign(
      await createMembership(database.admin, medicalM15.userId, clubA, 'medical'),
      clubA,
      m15,
    );
    await assign(
      await createMembership(database.admin, medicalM17.userId, clubA, 'medical'),
      clubA,
      m17,
    );
    for (const user of [player15, playerNoHealth]) {
      await createMembership(database.admin, user.userId, clubA, 'player');
    }
    await createMembership(database.admin, parent15.userId, clubA, 'parent');

    // Club B: the modules are off (the default).
    const mB = await insertCategory(clubB, 'm15', 'development');
    await insertPlayer(clubB, playerB, mB, ['data', 'health'], parent15);
    await createMembership(database.admin, playerB.userId, clubB, 'player');
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('the question of the day', () => {
    it('is asked with the modules on and the data and health consents', async () => {
      const response = await t.app.inject({
        url: '/v1/pain-reports/today',
        headers: player15.headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<FormBody>()).toEqual({
        playerId: p15,
        localDate: today,
        enabled: true,
        unavailableReason: null,
        latest: null,
      });
    });

    it('is not asked without a health consent or with the modules off', async () => {
      const noHealth = await t.app.inject({
        url: '/v1/pain-reports/today',
        headers: playerNoHealth.headers,
      });
      expect(noHealth.json<FormBody>()).toMatchObject({
        enabled: false,
        unavailableReason: 'missing_consent',
        latest: null,
      });
      const off = await t.app.inject({ url: '/v1/pain-reports/today', headers: playerB.headers });
      expect(off.json<FormBody>()).toMatchObject({
        enabled: false,
        unavailableReason: 'module_off',
      });
    });

    it("is in the player's own profile, which the app keeps for offline", async () => {
      const reportPain = async (caller: SignedIn) =>
        (await t.app.inject({ url: '/v1/me/player', headers: caller.headers })).json<{
          permissions: { reportPain: boolean };
        }>().permissions.reportPain;
      expect(await reportPain(player15)).toBe(true);
      expect(await reportPain(playerNoHealth)).toBe(false);
      expect(await reportPain(playerB)).toBe(false);
    });

    it('is only for players', async () => {
      for (const caller of [adminA, coachM15, medicalM15, parent15]) {
        const response = await t.app.inject({
          url: '/v1/pain-reports/today',
          headers: caller.headers,
        });
        expect(response.statusCode, response.body).toBe(403);
      }
    });
  });

  describe('answering', () => {
    it('records a no, and then a yes with the body map; the latest one counts', async () => {
      const no = await submit(player15, { clientUuid: randomUUID(), hasPain: false });
      expect(no.statusCode, no.body).toBe(201);
      expect(no.json<PainReportBody>()).toMatchObject({
        playerId: p15,
        localDate: today,
        hasPain: false,
        areas: [],
        comment: null,
        maxIntensity: 0,
        reviewedAt: null,
      });
      const requestId = `req-pain-${randomUUID().slice(0, 8)}`;
      const yes = await submit(
        player15,
        {
          clientUuid: randomUUID(),
          hasPain: true,
          areas: [
            { region: 'knee', side: 'left', intensity: 6 },
            { region: 'lumbar_spine', side: 'central', intensity: 3 },
          ],
          comment: 'Desde el partido',
        },
        { 'x-request-id': requestId },
      );
      expect(yes.statusCode, yes.body).toBe(201);
      const body = yes.json<PainReportBody>();
      // In the order of the vocabulary.
      expect(body.areas).toEqual([
        { region: 'lumbar_spine', side: 'central', intensity: 3 },
        { region: 'knee', side: 'left', intensity: 6 },
      ]);
      expect(body).toMatchObject({ hasPain: true, comment: 'Desde el partido', maxIntensity: 6 });
      // The replay lookup, the writes and the read-back are in the access log, without values.
      expect((await logOf(requestId)).map((row) => `${row.action}:${row.resource}`)).toEqual([
        'read:pain_report',
        'insert:pain_report',
        'insert:pain_report_area',
        'insert:pain_report_area',
        'read:pain_report',
      ]);
      const form = await t.app.inject({ url: '/v1/pain-reports/today', headers: player15.headers });
      expect(form.json<FormBody>().latest?.id).toBe(body.id);
    });

    it('is idempotent by clientUuid', async () => {
      const clientUuid = randomUUID();
      const first = await submit(player15, { clientUuid, hasPain: false, localDate: yesterday });
      expect(first.statusCode, first.body).toBe(201);
      const again = await submit(player15, {
        clientUuid,
        hasPain: true,
        areas: [{ region: 'foot', side: 'right', intensity: 2 }],
      });
      expect(again.headers['x-idempotent-replay']).toBe('true');
      expect(again.json<PainReportBody>()).toMatchObject({
        id: first.json<PainReportBody>().id,
        hasPain: false,
        localDate: yesterday,
      });
    });

    it("a clientUuid taken by another player's report is a 409, never a replay", async () => {
      // In a category nobody here is assigned to: the lists below stay the M15 player's.
      const m19 = await insertCategory(clubA, 'm19', 'performance');
      const other = await insertPlayer(clubA, null, m19, [], adminA);
      const clientUuid = randomUUID();
      await database.admin.query(
        `insert into medical.pain_report (club_id, client_uuid, player_id, local_date, has_pain)
         values ($1, $2, $3, $4, false)`,
        [clubA, clientUuid, other, today],
      );
      const response = await submit(player15, { clientUuid, hasPain: false });
      expect(response.statusCode, response.body).toBe(409);
      expect(errorOf(response).code).toBe('conflict');
      expect(response.headers['x-idempotent-replay']).toBeUndefined();
    });

    it('checks the answer against the body map and the window', async () => {
      const cases: [unknown, string[]][] = [
        [{ hasPain: true, areas: [] }, ['body.areas']],
        [
          { hasPain: false, areas: [{ region: 'knee', side: 'left', intensity: 2 }] },
          ['body.areas'],
        ],
        [
          { hasPain: true, areas: [{ region: 'neck', side: 'left', intensity: 2 }] },
          ['body.areas.0.side'],
        ],
        [{ hasPain: false, comment: 'algo' }, ['body.comment']],
        [
          { hasPain: true, areas: [{ region: 'knee', side: 'left', intensity: 2 }], comment: '  ' },
          ['body.comment'],
        ],
        [
          {
            hasPain: true,
            areas: [
              { region: 'knee', side: 'left', intensity: 2 },
              { region: 'knee', side: 'left', intensity: 4 },
            ],
          },
          ['body.areas.1'],
        ],
      ];
      for (const [payload, expected] of cases) {
        const response = await submit(player15, payload);
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        expect(paths(response), JSON.stringify(payload)).toEqual(expected);
      }
      const contract = await submit(player15, {
        hasPain: true,
        areas: [{ region: 'other', side: 'central', intensity: 11 }],
      });
      expect(contract.statusCode).toBe(400);
      const { rows } = await database.admin.query<{ d: string }>(
        `select ($1::date - 2)::text as d`,
        [today],
      );
      const old = await submit(player15, { hasPain: false, localDate: rows[0]?.d });
      expect(old.statusCode).toBe(400);
      expect(paths(old)).toEqual(['body.localDate']);
    });

    it('needs the health consent, the modules and the player role', async () => {
      const noHealth = await submit(playerNoHealth, { hasPain: false });
      expect(noHealth.statusCode, noHealth.body).toBe(403);
      expect(errorOf(noHealth).code).toBe('consent_required');
      expect(errorOf(noHealth).details?.map((issue) => issue.path)).toEqual([
        ['consents', 'health'],
      ]);
      const off = await submit(playerB, { hasPain: false });
      expect(off.statusCode, off.body).toBe(403);
      for (const caller of [adminA, coachM15, scA, medicalM15, parent15]) {
        const response = await submit(caller, { hasPain: false });
        expect(response.statusCode, response.body).toBe(403);
      }
    });

    it('goes through the offline queue, and a resend is a replay', async () => {
      const clientUuid = randomUUID();
      const mutation = {
        mutationId: randomUUID(),
        hlc: formatHlc({ physicalMs: Date.now() - 60_000, counter: 0, node: '0123456789abcdef' }),
        op: 'pain_report.submit',
        body: {
          clientUuid,
          hasPain: true,
          areas: [{ region: 'ankle', side: 'right', intensity: 5 }],
        },
      };
      const push = () =>
        t.app.inject({
          method: 'POST',
          url: '/v1/sync/push',
          headers: player15.headers,
          payload: { mutations: [mutation] },
        });
      const first = await push();
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json<{ results: { status: string }[] }>().results[0]?.status).toBe('applied');
      const again = await push();
      expect(again.json<{ results: { status: string }[] }>().results[0]?.status).toBe('replayed');
      const { rows } = await database.admin.query<{ n: number }>(
        'select count(*)::int as n from medical.pain_report where client_uuid = $1',
        [clientUuid],
      );
      expect(rows[0]?.n).toBe(1);
      // A create without its clientUuid is rejected alone.
      const missing = await t.app.inject({
        method: 'POST',
        url: '/v1/sync/push',
        headers: player15.headers,
        payload: {
          mutations: [{ ...mutation, mutationId: randomUUID(), body: { hasPain: false } }],
        },
      });
      expect(missing.json<{ results: { status: string }[] }>().results[0]?.status).toBe('rejected');
    });
  });

  describe('who reads it', () => {
    it('the assigned medical staff, newest first, by pages and filters', async () => {
      const all = await list(medicalM15.headers);
      expect(all.statusCode, all.body).toBe(200);
      const items = all.json<Page<PainReportBody>>().items;
      expect(items.length).toBeGreaterThanOrEqual(4);
      expect(items.every((item) => item.playerId === p15)).toBe(true);
      const times = items.map((item) => item.submittedAt);
      expect([...times].sort().reverse()).toEqual(times);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query = `?limit=1${cursor === null ? '' : `&cursor=${cursor}`}`;
        const response = await list(medicalM15.headers, query);
        expect(response.statusCode, response.body).toBe(200);
        const page = response.json<Page<PainReportBody>>();
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor !== null);
      expect(seen).toEqual(items.map((item) => item.id));
      // A cursor of other filters is refused.
      const first = (await list(medicalM15.headers, '?limit=1')).json<Page<PainReportBody>>();
      const mixed = await list(
        medicalM15.headers,
        `?limit=1&status=pending&cursor=${first.nextCursor ?? ''}`,
      );
      expect(mixed.statusCode).toBe(400);

      const yesterdayOnly = await list(
        medicalM15.headers,
        `?from=${yesterday}&to=${yesterday}&categoryId=${m15}&playerId=${p15}`,
      );
      expect(
        yesterdayOnly.json<Page<PainReportBody>>().items.map((item) => item.localDate),
      ).toEqual([yesterday]);
      // The medical staff of another category sees none.
      const other = await list(medicalM17.headers);
      expect(other.json<Page<PainReportBody>>().items).toEqual([]);
    });

    it('the holder: the player and the guardian of a minor', async () => {
      const own = await list(player15.headers);
      expect(own.statusCode, own.body).toBe(200);
      const ownItems = own.json<Page<PainReportBody>>().items;
      expect(ownItems.length).toBeGreaterThan(0);
      const parent = await list(parent15.headers);
      expect(parent.json<Page<PainReportBody>>().items.map((item) => item.id)).toEqual(
        ownItems.map((item) => item.id),
      );
      // Without a health consent the holder reads nothing.
      const noHealth = await list(playerNoHealth.headers);
      expect(noHealth.json<Page<PainReportBody>>().items).toEqual([]);
    });

    it('never the coach, the S&C staff or the administration; the wellness shows no trace', async () => {
      for (const caller of [coachM15, scA, adminA]) {
        const response = await list(caller.headers);
        expect(response.statusCode, response.body).toBe(403);
      }
      const support = await list({
        ...superadmin.headers,
        'x-support-club-id': clubA,
        'x-support-reason': SUPPORT_REASON,
      });
      expect(support.statusCode, support.body).toBe(403);
      const wellness = await t.app.inject({ url: '/v1/wellness', headers: coachM15.headers });
      expect(wellness.statusCode, wellness.body).toBe(200);
      expect(wellness.body).not.toMatch(/pain|knee|lumbar/i);
    });
  });

  describe('review', () => {
    it('the assigned medical staff marks it once', async () => {
      const pending = (await list(medicalM15.headers, '?status=pending')).json<
        Page<PainReportBody>
      >().items;
      const target = pending[0];
      expect(target).toBeDefined();
      const id = target?.id ?? '';
      for (const caller of [coachM15, adminA, player15, parent15]) {
        expect((await review(caller, id)).statusCode).toBe(403);
      }
      // Outside the assignment: as if it did not exist.
      expect((await review(medicalM17, id)).statusCode).toBe(404);
      const done = await review(medicalM15, id);
      expect(done.statusCode, done.body).toBe(200);
      expect(done.json<PainReportBody>()).toMatchObject({ id, reviewedBy: medicalM15.userId });
      expect(done.json<PainReportBody>().reviewedAt).not.toBeNull();
      expect((await review(medicalM15, id)).statusCode).toBe(409);
      const stillPending = (await list(medicalM15.headers, '?status=pending')).json<
        Page<PainReportBody>
      >().items;
      expect(stillPending.map((item) => item.id)).not.toContain(id);
      expect((await review(medicalM15, randomUUID())).statusCode).toBe(404);
    });
  });
});
