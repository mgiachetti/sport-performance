/**
 * Alerts end to end (B-327, ADR 0053) against Postgres 16, through the real
 * connection roles: listing by the scope of the permission matrix
 * (`alert.read`), the detail with its history, and the staff's review
 * (`alert.acknowledge`), once and with the version read. Players and
 * guardians never see alerts.
 */
import type { ClubId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
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

interface AlertBody {
  id: string;
  playerId: string;
  ruleCode: string;
  kind: string;
  severity: string;
  currentSeverity: string;
  raisedOn: string;
  resolvedOn: string | null;
  messageKey: string;
  suggestionKey: string;
  values: Record<string, number>;
  status: string;
  acknowledgedBy: string | null;
  acknowledgementNote: string | null;
  version: string;
  events?: { type: string; note: string | null; actorId: string | null }[];
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

describeWithPostgres('alerts (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let coachM15: SignedIn;
  let medicalM15: SignedIn;
  let player15: SignedIn;
  let parent15: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let m15: string;
  let p15: string;
  let p17: string;
  let alert15: string;
  let alert15Resolved: string;
  let alert17: string;
  let alertB: string;

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
    return playerId;
  }

  async function insertRule(clubId: ClubId, code: string, kind: string): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into alert_rule (club_id, code, kind, params) values ($1, $2, $3, '{}') returning id`,
      [clubId, code, kind],
    );
    return rows[0]?.id ?? '';
  }

  /** An episode as the worker writes it. */
  async function insertAlert(
    clubId: ClubId,
    ruleId: string,
    playerId: string,
    values: { kind: string; severity: string; raisedOn: string; resolvedOn?: string },
  ): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into alert (club_id, alert_rule_id, player_id, kind, severity, current_severity,
                          local_date, last_seen_on, resolved_on, observed_on, values)
       values ($1, $2, $3, $4, $5, $5, $6, $6, $7, $6, '{"acwrRatio": 1.45, "thresholdRatio": 1.4}')
       returning id`,
      [
        clubId,
        ruleId,
        playerId,
        values.kind,
        values.severity,
        values.raisedOn,
        values.resolvedOn ?? null,
      ],
    );
    return rows[0]?.id ?? '';
  }

  async function assign(membershipId: string, clubId: ClubId, categoryId: string): Promise<void> {
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, membershipId, categoryId],
    );
  }

  async function list(caller: Record<string, string>, query = ''): Promise<AlertBody[]> {
    const response = await t.app.inject({ url: `/v1/alerts${query}`, headers: caller });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page<AlertBody>>().items;
  }

  function get(caller: Record<string, string>, id: string) {
    return t.app.inject({ url: `/v1/alerts/${id}`, headers: caller });
  }

  function review(caller: Record<string, string>, id: string, payload: Record<string, unknown>) {
    return t.app.inject({
      method: 'POST',
      url: `/v1/alerts/${id}/review`,
      headers: caller,
      payload,
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
    adminA = await signIn(t, 'admin@club-a.example.com');
    adminB = await signIn(t, 'admin@club-b.example.com');
    coachM15 = await signIn(t, 'coach15@club-a.example.com');
    medicalM15 = await signIn(t, 'medical15@club-a.example.com');
    player15 = await signIn(t, 'player15@club-a.example.com');
    parent15 = await signIn(t, 'parent15@club-a.example.com');

    clubA = await createClub(database.admin, 'club-a');
    clubB = await createClub(database.admin, 'club-b');
    m15 = await insertCategory(clubA, 'm15', 'development');
    const m17 = await insertCategory(clubA, 'm17', 'performance');
    p15 = await insertPlayer(clubA, player15, m15);
    p17 = await insertPlayer(clubA, null, m17);
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
      await createMembership(database.admin, medicalM15.userId, clubA, 'medical'),
      clubA,
      m15,
    );
    await createMembership(database.admin, player15.userId, clubA, 'player');
    await createMembership(database.admin, parent15.userId, clubA, 'parent');

    const acwr = await insertRule(clubA, 'acwr_high', 'acwr_high');
    const wellness = await insertRule(clubA, 'wellness_low', 'wellness_low');
    alert15Resolved = await insertAlert(clubA, acwr, p15, {
      kind: 'acwr_high',
      severity: 'warning',
      raisedOn: '2026-10-01',
      resolvedOn: '2026-10-03',
    });
    alert15 = await insertAlert(clubA, acwr, p15, {
      kind: 'acwr_high',
      severity: 'critical',
      raisedOn: '2026-10-20',
    });
    alert17 = await insertAlert(clubA, wellness, p17, {
      kind: 'wellness_low',
      severity: 'warning',
      raisedOn: '2026-10-21',
    });
    const mB = await insertCategory(clubB, 'm15', 'development');
    const pB = await insertPlayer(clubB, null, mB);
    alertB = await insertAlert(clubB, await insertRule(clubB, 'acwr_high', 'acwr_high'), pB, {
      kind: 'acwr_high',
      severity: 'warning',
      raisedOn: '2026-10-21',
    });
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('lists by scope: the assigned staff its players, the administration the club', async () => {
    expect((await list(adminA.headers)).map((a) => a.id)).toEqual([
      alert17,
      alert15,
      alert15Resolved,
    ]);
    expect((await list(coachM15.headers)).map((a) => a.id)).toEqual([alert15, alert15Resolved]);
    expect((await list(medicalM15.headers)).map((a) => a.id)).toEqual([alert15, alert15Resolved]);
    expect((await list(adminB.headers)).map((a) => a.id)).toEqual([alertB]);
    const [first] = await list(coachM15.headers, '?state=active');
    expect(first).toMatchObject({
      id: alert15,
      playerId: p15,
      ruleCode: 'acwr_high',
      kind: 'acwr_high',
      severity: 'critical',
      raisedOn: '2026-10-20',
      resolvedOn: null,
      messageKey: 'alert.acwr_high.message',
      suggestionKey: 'alert.acwr_high.suggestion',
      values: { acwrRatio: 1.45, thresholdRatio: 1.4 },
      status: 'open',
    });
  });

  it('filters by state, severity, kind, category, player and days, with a cursor', async () => {
    const ids = async (query: string) => (await list(adminA.headers, query)).map((a) => a.id);
    expect(await ids('?state=resolved')).toEqual([alert15Resolved]);
    expect(await ids('?severity=warning')).toEqual([alert17, alert15Resolved]);
    expect(await ids('?kind=wellness_low')).toEqual([alert17]);
    expect(await ids(`?categoryId=${m15}`)).toEqual([alert15, alert15Resolved]);
    expect(await ids(`?playerId=${p17}`)).toEqual([alert17]);
    expect(await ids('?from=2026-10-02&to=2026-10-20')).toEqual([alert15]);
    expect(await ids('?sort=raisedOn')).toEqual([alert15Resolved, alert15, alert17]);
    const page = await t.app.inject({ url: '/v1/alerts?limit=2', headers: adminA.headers });
    const body = page.json<Page<AlertBody>>();
    expect(body.items).toHaveLength(2);
    const next = await list(adminA.headers, `?limit=2&cursor=${body.nextCursor ?? ''}`);
    expect(next.map((a) => a.id)).toEqual([alert15Resolved]);
    const bad = await t.app.inject({ url: '/v1/alerts?state=open', headers: adminA.headers });
    expect(bad.statusCode).toBe(400);
  });

  it('players and guardians never see alerts', async () => {
    for (const caller of [player15, parent15]) {
      const response = await t.app.inject({ url: '/v1/alerts', headers: caller.headers });
      expect(response.statusCode).toBe(403);
      expect((await get(caller.headers, alert15)).statusCode).toBe(404);
      const reviewed = await review(caller.headers, alert15, {
        version: '1',
        status: 'acknowledged',
      });
      expect(reviewed.statusCode).toBe(404);
    }
  });

  it('shows an alert with its history; another club or an unseen player is 404', async () => {
    const response = await get(coachM15.headers, alert15);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<AlertBody>().events).toEqual([
      expect.objectContaining({ type: 'raised', note: null, actorId: null }),
    ]);
    expect((await get(coachM15.headers, alert17)).statusCode).toBe(404);
    expect((await get(adminB.headers, alert15)).statusCode).toBe(404);
    expect((await get(adminA.headers, alertB)).statusCode).toBe(404);
  });

  it('the staff acknowledges an open alert once, with the version read', async () => {
    const current = (await get(coachM15.headers, alert15)).json<AlertBody>();
    const stale = await review(coachM15.headers, alert15, {
      version: '1',
      status: 'acknowledged',
    });
    expect(stale.statusCode).toBe(409);

    const response = await review(coachM15.headers, alert15, {
      version: current.version,
      status: 'acknowledged',
      note: '  Bajamos la carga del jueves  ',
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<AlertBody>();
    expect(body).toMatchObject({
      status: 'acknowledged',
      acknowledgedBy: coachM15.userId,
      acknowledgementNote: 'Bajamos la carga del jueves',
    });
    expect(body.events?.map((e) => e.type)).toEqual(['raised', 'acknowledged']);
    expect(body.events?.at(-1)).toMatchObject({
      note: 'Bajamos la carga del jueves',
      actorId: coachM15.userId,
    });

    const again = await review(adminA.headers, alert15, {
      version: body.version,
      status: 'dismissed',
      note: 'No aplica',
    });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe('conflict');
  });

  it('a dismissal needs a note; the coach cannot review players outside its categories', async () => {
    const current = (await get(adminA.headers, alert17)).json<AlertBody>();
    const noNote = await review(adminA.headers, alert17, {
      version: current.version,
      status: 'dismissed',
    });
    expect(noNote.statusCode).toBe(400);
    expect(errorOf(noNote).details?.map((d) => d.path.join('.'))).toEqual(['body.note']);
    expect(
      (await review(coachM15.headers, alert17, { version: current.version, status: 'dismissed' }))
        .statusCode,
    ).toBe(404);
    const dismissed = await review(adminA.headers, alert17, {
      version: current.version,
      status: 'dismissed',
      note: 'Venía de un viaje largo, ya lo hablamos',
    });
    expect(dismissed.statusCode, dismissed.body).toBe(200);
    expect(dismissed.json<AlertBody>().status).toBe('dismissed');
    expect(await list(adminA.headers, '?status=open')).toEqual([
      expect.objectContaining({ id: alert15Resolved }),
    ]);
  });
});
