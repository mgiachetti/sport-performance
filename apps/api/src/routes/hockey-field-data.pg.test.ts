/**
 * Hockey field data (B-803, ADR 0091) end to end against Postgres 16: the
 * field rules of the session's sport in the participation and drill
 * endpoints (no contacts in hockey; minutes by period in matches with
 * rolling substitutions, their sum kept by the database), the change
 * history of the periods, the offline sync resolving minutes and periods as
 * one field, and the pitch of the sport in the field session view.
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

interface ParticipationBody {
  id: string;
  playerId: string;
  status: string;
  minutes: number | null;
  periodMinutes: number[] | null;
  contactsN: number | null;
  version: string;
}

interface BatchBody {
  items: { outcome: string; participation: ParticipationBody }[];
}

interface SessionBody {
  id: string;
  version: string;
}

interface MutationResult {
  status: 'applied' | 'superseded' | 'replayed' | 'rejected';
  appliedFields: string[];
  supersededFields: string[];
  error: { code: string } | null;
}

const HOUR_MS = 60 * 60 * 1000;
/** A device clock at `physicalMs`: later than the online writes before it, never in the future. */
function hlc(physicalMs: number, counter = 0): string {
  return formatHlc({ physicalMs, counter, node: '0123456789abcdef' });
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * HOUR_MS).toISOString();
}

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

describeWithPostgres('hockey field data (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let admin: SignedIn;
  let clubId: ClubId;
  let hockeyM17: string;
  let rugbyM17: string;
  let ana: string;
  let bea: string;
  let match: SessionBody;
  let training: SessionBody;

  async function insertCategory(sport: 'rugby' | 'hockey', name: string): Promise<string> {
    const sex = sport === 'hockey' ? 'female' : 'male';
    await database.admin.query(
      `insert into club_branch (club_id, sport, sex) values ($1, $2, $3)
       on conflict (club_id, sport, sex) do nothing`,
      [clubId, sport, sex],
    );
    const result = await database.admin.query<{ id: string }>(
      `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
       values ($1, $2, $3, 'm17', $4, 'performance') returning id`,
      [clubId, sport, sex, name],
    );
    return result.rows[0]?.id ?? '';
  }

  async function insertPlayer(categoryId: string, firstName: string): Promise<string> {
    const result = await database.admin.query<{ id: string }>(
      `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Gómez', '2009-04-02', 'female', 'hockey', '2024-01-01') returning id`,
      [clubId, firstName],
    );
    const id = result.rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, id, categoryId],
    );
    await database.admin.query(
      `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
       values ($1, $2, 'data', 'v1', 'guardian', $3)`,
      [clubId, id, admin.userId],
    );
    return id;
  }

  async function createSession(payload: Record<string, unknown>): Promise<LightMyRequestResponse> {
    return t.app.inject({
      method: 'POST',
      url: '/v1/training-sessions',
      headers: admin.headers,
      payload,
    });
  }

  async function batch(
    sessionId: string,
    rows: Record<string, unknown>[],
    changeReason?: string,
  ): Promise<LightMyRequestResponse> {
    return t.app.inject({
      method: 'POST',
      url: `/v1/training-sessions/${sessionId}/participations/batch`,
      headers: admin.headers,
      payload: {
        ...(changeReason !== undefined && { changeReason }),
        rows: rows.map((row) => ({ clientUuid: randomUUID(), ...row })),
      },
    });
  }

  async function participationOf(playerId: string, sessionId = match.id) {
    const { rows } = await database.admin.query<{
      id: string;
      minutes: number | null;
      period_minutes: number[] | null;
    }>(
      `select id, minutes, period_minutes from participation
        where training_session_id = $1 and player_id = $2`,
      [sessionId, playerId],
    );
    return rows[0];
  }

  async function push(mutations: Record<string, unknown>[]): Promise<MutationResult[]> {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: admin.headers,
      payload: { mutations: mutations.map((m) => ({ mutationId: randomUUID(), ...m })) },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ results: MutationResult[] }>().results;
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
    admin = await signIn(t, 'admin@club-hockey.example.com');
    clubId = await createClub(database.admin, 'club-hockey');
    await createMembership(database.admin, admin.userId, clubId, 'admin');
    hockeyM17 = await insertCategory('hockey', 'Sub 17 hockey');
    rugbyM17 = await insertCategory('rugby', 'M17 rugby');
    ana = await insertPlayer(hockeyM17, 'Ana');
    bea = await insertPlayer(hockeyM17, 'Bea');

    const created = await createSession({
      kind: 'match',
      categoryId: hockeyM17,
      startsAt: hoursFromNow(-2),
      plannedDurationMin: 60,
      opponent: 'San Fernando',
    });
    expect(created.statusCode, created.body).toBe(201);
    match = created.json<SessionBody>();
    const createdTraining = await createSession({
      kind: 'training',
      categoryId: hockeyM17,
      startsAt: hoursFromNow(-30),
      plannedDurationMin: 90,
    });
    expect(createdTraining.statusCode, createdTraining.body).toBe(201);
    training = createdTraining.json<SessionBody>();
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('minutes by period', () => {
    it('stores the periods of a hockey match and their sum as the minutes', async () => {
      const response = await batch(match.id, [
        { playerId: ana, status: 'partial', periodMinutes: [12, 9, 15, 6] },
        { playerId: bea, status: 'full', periodMinutes: [15, 15, 15, 15], minutes: 60 },
      ]);
      expect(response.statusCode, response.body).toBe(200);
      const items = response.json<BatchBody>().items;
      expect(items.map((item) => [item.outcome, item.participation.minutes])).toEqual([
        ['created', 42],
        ['created', 60],
      ]);
      expect(items[0]?.participation.periodMinutes).toEqual([12, 9, 15, 6]);
      expect(await participationOf(ana)).toMatchObject({
        minutes: 42,
        period_minutes: [12, 9, 15, 6],
      });
    });

    it('refuses minutes that are not the sum of the periods', async () => {
      const response = await batch(match.id, [
        { playerId: ana, status: 'partial', periodMinutes: [12, 9, 15, 6], minutes: 40 },
      ]);
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).details?.map((d) => d.path)).toContainEqual([
        'body',
        'rows',
        0,
        'minutes',
      ]);
    });

    it('refuses periods in a training session and periods longer than the match', async () => {
      const inTraining = await batch(training.id, [
        { playerId: ana, status: 'full', periodMinutes: [45, 45] },
      ]);
      expect(inTraining.statusCode).toBe(400);
      expect(errorOf(inTraining).details?.map((d) => d.path)).toEqual([
        ['body', 'rows', 0, 'periodMinutes'],
      ]);
      const tooLong = await batch(match.id, [
        { playerId: ana, status: 'partial', periodMinutes: [12, 61] },
      ]);
      expect(tooLong.statusCode).toBe(400);
      expect(errorOf(tooLong).details?.map((d) => d.path)).toEqual([
        ['body', 'rows', 0, 'periodMinutes', 1],
      ]);
    });

    it('refuses periods adding up to more than 600 minutes, by batch and by the queue', async () => {
      // Without a planned duration no period is too long: the total cap is what stops it.
      const created = await createSession({
        kind: 'match',
        categoryId: hockeyM17,
        startsAt: hoursFromNow(-4),
        opponent: 'Banco Nación',
      });
      expect(created.statusCode, created.body).toBe(201);
      const unplanned = created.json<SessionBody>();
      const response = await batch(unplanned.id, [
        { playerId: ana, status: 'full', periodMinutes: [200, 200, 200, 200] },
      ]);
      expect(response.statusCode, response.body).toBe(400);
      expect(errorOf(response).code).toBe('validation_failed');
      expect(errorOf(response).details?.map((d) => d.path)).toContainEqual([
        'body',
        'rows',
        0,
        'periodMinutes',
      ]);
      expect(await participationOf(ana, unplanned.id)).toBeUndefined();

      const [result] = await push([
        {
          hlc: hlc(Date.now()),
          op: 'participation.update',
          target: { id: (await participationOf(ana))?.id ?? '' },
          body: { changeReason: 'Tramos', periodMinutes: [200, 200, 200, 200] },
        },
      ]);
      expect(result).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
    });

    it('records a correction of the periods in the change history', async () => {
      const current = await participationOf(ana);
      const response = await t.app.inject({
        method: 'PATCH',
        url: `/v1/participations/${current?.id ?? ''}`,
        headers: admin.headers,
        payload: {
          version: (await batch(match.id, [{ playerId: ana, status: 'partial' }])).json<BatchBody>()
            .items[0]?.participation.version,
          changeReason: 'Se cargó mal el tercer cuarto',
          periodMinutes: [12, 9, 10, 6],
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<ParticipationBody>()).toMatchObject({
        minutes: 37,
        periodMinutes: [12, 9, 10, 6],
      });
      const { rows } = await database.admin.query<{ changed_columns: string[]; reason: string }>(
        `select changed_columns, reason from change_history where record_id = $1 order by seq`,
        [current?.id ?? ''],
      );
      expect(rows.at(-1)).toMatchObject({ reason: 'Se cargó mal el tercer cuarto' });
      expect(rows.at(-1)?.changed_columns).toEqual(
        expect.arrayContaining(['minutes', 'period_minutes']),
      );
    });

    it('clears the periods when the minutes come as a total, and with an absence', async () => {
      const total = await batch(
        match.id,
        [{ playerId: bea, status: 'partial', minutes: 50 }],
        'Se fue en el último cuarto',
      );
      expect(total.statusCode, total.body).toBe(200);
      expect(total.json<BatchBody>().items[0]?.participation).toMatchObject({
        minutes: 50,
        periodMinutes: null,
      });
      await batch(match.id, [{ playerId: bea, status: 'partial', periodMinutes: [15, 15, 15, 5] }]);
      const absent = await batch(match.id, [{ playerId: bea, status: 'absent' }], 'No vino');
      expect(absent.statusCode, absent.body).toBe(200);
      expect(await participationOf(bea)).toMatchObject({ minutes: null, period_minutes: null });
    });
  });

  describe('no contacts in hockey', () => {
    it('refuses contacts in a participation of a hockey session', async () => {
      const response = await batch(training.id, [
        { playerId: ana, status: 'full', minutes: 90, contactsN: 3 },
      ]);
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).details?.map((d) => d.path)).toEqual([
        ['body', 'rows', 0, 'contactsN'],
      ]);
    });

    it('refuses a drill contact level other than none in hockey', async () => {
      const response = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${training.id}/drills`,
        headers: admin.headers,
        payload: { name: 'Salida de bola', contactLevel: 'controlled' },
      });
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).details?.map((d) => d.path)).toEqual([['body', 'contactLevel']]);
      const plain = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${training.id}/drills`,
        headers: admin.headers,
        payload: { name: 'Salida de bola' },
      });
      expect(plain.statusCode, plain.body).toBe(201);
      const withDrills = await createSession({
        kind: 'training',
        categoryId: hockeyM17,
        startsAt: hoursFromNow(-50),
        drills: [{ name: 'Presión', contactLevel: 'full' }],
      });
      expect(withDrills.statusCode).toBe(400);
      expect(errorOf(withDrills).details?.map((d) => d.path)).toEqual([
        ['body', 'drills', 0, 'contactLevel'],
      ]);
    });

    it('does not move a session with contacts to hockey, nor one with periods to training', async () => {
      const rugby = await createSession({
        kind: 'training',
        categoryId: rugbyM17,
        startsAt: hoursFromNow(-60),
        drills: [{ name: 'Tackle', contactLevel: 'controlled' }],
      });
      expect(rugby.statusCode, rugby.body).toBe(201);
      const session = rugby.json<SessionBody>();
      const moved = await t.app.inject({
        method: 'PATCH',
        url: `/v1/training-sessions/${session.id}`,
        headers: admin.headers,
        payload: { version: session.version, categoryId: hockeyM17 },
      });
      expect(moved.statusCode).toBe(409);

      const turned = await t.app.inject({
        method: 'PATCH',
        url: `/v1/training-sessions/${match.id}`,
        headers: admin.headers,
        payload: { version: match.version, kind: 'training', opponent: null },
      });
      expect(turned.statusCode).toBe(409);
    });
  });

  describe('offline sync', () => {
    it('resolves the minutes and the periods as one field', async () => {
      const current = await participationOf(ana);
      const id = current?.id ?? '';
      await new Promise((resolve) => setTimeout(resolve, 20));
      const nowMs = Date.now();
      // A phone that edits the periods later than another one that loaded a total…
      const results = await push([
        {
          hlc: hlc(nowMs, 1),
          op: 'participation.update',
          target: { id },
          body: { changeReason: 'Reloj de cancha', periodMinutes: [15, 9, 10, 6] },
        },
        {
          hlc: hlc(nowMs, 0),
          op: 'participation.update',
          target: { id },
          body: { changeReason: 'Total a mano', minutes: 30 },
        },
      ]);
      expect(results.map((r) => [r.status, r.appliedFields, r.supersededFields])).toEqual([
        ['applied', ['minutes'], []],
        ['superseded', [], ['minutes']],
      ]);
      // …keeps the periods and their sum, never the total of the older edit.
      expect(await participationOf(ana)).toMatchObject({
        minutes: 40,
        period_minutes: [15, 9, 10, 6],
      });
      const { rows } = await database.admin.query<{ field_hlc: Record<string, string> }>(
        `select field_hlc from sync_change where collection = 'participation' and row_id = $1
            and not deleted`,
        [id],
      );
      expect(rows[0]?.field_hlc).toMatchObject({
        minutes: hlc(nowMs, 1),
        period_minutes: hlc(nowMs, 1),
      });
    });

    it('refuses contacts of a hockey participation through the queue too', async () => {
      const [result] = await push([
        {
          hlc: hlc(Date.now()),
          op: 'participation.update',
          target: { id: (await participationOf(ana))?.id ?? '' },
          body: { changeReason: 'Contactos', contactsN: 2 },
        },
      ]);
      expect(result).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
    });
  });

  describe('field session view', () => {
    it('brings the rules and the pitch of the sport', async () => {
      // Without field metrics yet: the view still brings the participation and the rules.
      const response = await t.app.inject({
        url: `/v1/training-sessions/${match.id}/field-metrics`,
        headers: admin.headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<{
        fieldRules: unknown;
        players: { playerId: string; participation: { periodMinutes: number[] | null } | null }[];
      }>();
      expect(body.fieldRules).toEqual({
        substitutions: 'rolling',
        recordsContacts: false,
        matchPeriodCount: 4,
        pitch: { lengthM: 91.4, widthM: 55 },
      });
      expect(body.players.find((p) => p.playerId === ana)?.participation?.periodMinutes).toEqual([
        15, 9, 10, 6,
      ]);
    });
  });
});
