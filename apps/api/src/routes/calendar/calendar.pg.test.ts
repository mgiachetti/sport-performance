/**
 * The calendar end to end (B-317) against Postgres 16, through the real
 * connection roles (ADR 0026): seasons and windows, scheduled test days, the
 * fixture and the calendar of a category, with the permission matrix in the
 * handlers (ADR 0025), RLS behind it and the endpoint conventions (ADR 0032).
 */
import { randomUUID } from 'node:crypto';
import type { ClubId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMembership,
  createTestDatabase,
  signIn,
  startIdentityApp,
  type IdentityTestApp,
  type SignedIn,
  type TestDatabase,
} from '../../testing/identity.js';
import { describeWithPostgres } from '../../testing/support.js';

interface Envelope {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface WindowBody {
  id: string;
  seasonId: string;
  number: number;
  label: string;
  startsOn: string;
  endsOn: string;
  archivedAt: string | null;
  version: string;
}

interface SeasonBody {
  id: string;
  sport: string;
  name: string;
  startsOn: string;
  endsOn: string;
  testWindows: WindowBody[];
  archivedAt: string | null;
  version: string;
}

interface TestSessionBody {
  id: string;
  sport: string;
  categoryId: string | null;
  testWindowId: string | null;
  scheduledOn: string;
  status: string;
  location: string | null;
  version: string;
}

interface FixtureBody {
  id: string;
  sport: string;
  categoryId: string;
  opponent: string;
  venue: string;
  competition: string | null;
  date: string;
  kickoffTime: string | null;
  startsAt: string | null;
  status: string;
  archivedAt: string | null;
  version: string;
}

type EventBody =
  | {
      type: 'test_window';
      date: string;
      endDate: string;
      season: { id: string; name: string };
      testWindow: WindowBody;
    }
  | { type: 'test_session'; date: string; endDate: string; testSession: TestSessionBody }
  | { type: 'fixture'; date: string; endDate: string; fixture: FixtureBody };

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Carga del calendario pedida por el club');

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

describeWithPostgres(
  'calendar: seasons, windows, test days and fixture (Postgres)',
  (serverUrl) => {
    let database: TestDatabase;
    let t: IdentityTestApp;
    let superadmin: SignedIn;
    let adminA: SignedIn;
    let adminB: SignedIn;
    let coachA: SignedIn;
    let scA: SignedIn;
    let medicalA: SignedIn;
    let playerA: SignedIn;
    let clubA: ClubId;
    let clubB: ClubId;
    let m15: string;
    let m17: string;
    let hockeyM15: string;
    let rugby2027: SeasonBody;
    let hockey2027: SeasonBody;
    let v1: WindowBody;
    let v2: WindowBody;
    let testDay: TestSessionBody;
    let match: FixtureBody;

    const supporting = (clubId: string) => ({
      ...superadmin.headers,
      'x-support-club-id': clubId,
      'x-support-reason': SUPPORT_REASON,
    });

    const request = (
      caller: SignedIn | Record<string, string>,
      method: 'GET' | 'POST' | 'PATCH',
      url: string,
      payload?: Record<string, unknown>,
    ) =>
      t.app.inject({
        method,
        url,
        headers: 'headers' in caller ? (caller.headers as Record<string, string>) : caller,
        ...(payload !== undefined && { payload }),
      });

    async function categoryId(clubId: ClubId, sport: string, band: string): Promise<string> {
      const result = await database.admin.query<{ id: string }>(
        `select id from category where club_id = $1 and sport = $2 and age_band_code = $3`,
        [clubId, sport, band],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) throw new Error(`no ${sport} ${band}`);
      return id;
    }

    async function assign(
      membershipId: string,
      clubId: ClubId,
      target: { category?: string; sport?: string },
    ) {
      await database.admin.query(
        `insert into staff_assignment (club_id, membership_id, category_id, sport, valid_from)
       values ($1, $2, $3, $4, '2020-01-01')`,
        [clubId, membershipId, target.category ?? null, target.sport ?? null],
      );
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
      const registry = { ...superadmin.headers, 'x-support-reason': SUPPORT_REASON };
      const created = await Promise.all(
        [
          {
            slug: 'cal-a',
            branches: [
              { sport: 'rugby', sex: 'male' },
              { sport: 'hockey', sex: 'female' },
            ],
          },
          { slug: 'cal-b', branches: [{ sport: 'rugby', sex: 'male' }] },
        ].map(async ({ slug, branches }) => {
          const response = await t.app.inject({
            method: 'POST',
            url: '/v1/clubs',
            headers: registry,
            payload: {
              slug,
              name: `Club ${slug}`,
              shortName: slug.toUpperCase(),
              colors: { primary: '#F1882A', secondary: '#050505' },
              branches,
            },
          });
          expect(response.statusCode, response.body).toBe(201);
          return response.json<{ club: { id: ClubId } }>().club.id;
        }),
      );
      [clubA, clubB] = created as [ClubId, ClubId];

      adminA = await signIn(t, 'admin@cal-a.example.com');
      adminB = await signIn(t, 'admin@cal-b.example.com');
      coachA = await signIn(t, 'coach@cal-a.example.com');
      scA = await signIn(t, 'sc@cal-a.example.com');
      medicalA = await signIn(t, 'medical@cal-a.example.com');
      playerA = await signIn(t, 'player@cal-a.example.com');
      await createMembership(database.admin, adminA.userId, clubA, 'admin');
      await createMembership(database.admin, adminB.userId, clubB, 'admin');
      await createMembership(database.admin, playerA.userId, clubA, 'player');
      m15 = await categoryId(clubA, 'rugby', 'm15');
      m17 = await categoryId(clubA, 'rugby', 'm17');
      hockeyM15 = await categoryId(clubA, 'hockey', 'm15');
      await assign(await createMembership(database.admin, coachA.userId, clubA, 'coach'), clubA, {
        category: m15,
      });
      await assign(await createMembership(database.admin, scA.userId, clubA, 'sc'), clubA, {
        category: m15,
      });
      await assign(
        await createMembership(database.admin, medicalA.userId, clubA, 'medical'),
        clubA,
        {
          sport: 'rugby',
        },
      );
    }, 90_000);

    afterAll(async () => {
      await t.close();
      await database.drop();
    });

    describe('seasons', () => {
      const seasonUuid = randomUUID();

      it('lets the admin create a season idempotently', async () => {
        const payload = {
          clientUuid: seasonUuid,
          sport: 'rugby',
          name: '2027',
          startsOn: '2027-02-01',
          endsOn: '2027-11-30',
        };
        const first = await request(adminA, 'POST', '/v1/seasons', payload);
        expect(first.statusCode, first.body).toBe(201);
        rugby2027 = first.json<SeasonBody>();
        expect(rugby2027).toMatchObject({
          sport: 'rugby',
          name: '2027',
          startsOn: '2027-02-01',
          endsOn: '2027-11-30',
          testWindows: [],
          archivedAt: null,
        });
        const replay = await request(adminA, 'POST', '/v1/seasons', payload);
        expect(replay.statusCode).toBe(201);
        expect(replay.headers['x-idempotent-replay']).toBe('true');
        expect(replay.json<SeasonBody>().id).toBe(rugby2027.id);
      });

      it('keeps the active seasons of a sport apart, and caps them at a year', async () => {
        const overlap = await request(adminA, 'POST', '/v1/seasons', {
          sport: 'rugby',
          name: '2027 bis',
          startsOn: '2027-11-30',
          endsOn: '2028-03-01',
        });
        expect(overlap.statusCode).toBe(409);
        expect(errorOf(overlap).code).toBe('conflict');
        const sameName = await request(adminA, 'POST', '/v1/seasons', {
          sport: 'rugby',
          name: '2027',
          startsOn: '2029-02-01',
          endsOn: '2029-11-30',
        });
        expect(sameName.statusCode).toBe(409);
        for (const [startsOn, endsOn] of [
          ['2030-02-01', '2031-02-02'],
          ['2030-11-30', '2030-02-01'],
        ] as const) {
          const response = await request(adminA, 'POST', '/v1/seasons', {
            sport: 'rugby',
            name: `Mala ${startsOn}`,
            startsOn,
            endsOn,
          });
          expect(response.statusCode, response.body).toBe(400);
          expect(errorOf(response).details?.[0]?.path).toEqual(['body', 'endsOn']);
        }
        const hockey = await request(adminA, 'POST', '/v1/seasons', {
          sport: 'hockey',
          name: '2027',
          startsOn: '2027-02-01',
          endsOn: '2027-11-30',
        });
        expect(hockey.statusCode, hockey.body).toBe(201);
        hockey2027 = hockey.json<SeasonBody>();
      });

      it('needs an enabled branch of the sport', async () => {
        const response = await request(adminB, 'POST', '/v1/seasons', {
          sport: 'hockey',
          name: '2027',
          startsOn: '2027-02-01',
          endsOn: '2027-11-30',
        });
        expect(response.statusCode).toBe(400);
        expect(errorOf(response).details?.[0]?.path).toEqual(['body', 'sport']);
      });

      it('is managed only by the administration, read by every member', async () => {
        for (const caller of [coachA, scA, medicalA, playerA]) {
          const create = await request(caller, 'POST', '/v1/seasons', {
            sport: 'rugby',
            name: '2031',
            startsOn: '2031-02-01',
            endsOn: '2031-11-30',
          });
          expect(create.statusCode).toBe(403);
          expect(errorOf(create).message).toBe('You are not allowed to do this');
          const list = await request(caller, 'GET', '/v1/seasons?sport=rugby');
          expect(list.statusCode, list.body).toBe(200);
          expect(list.json<Page<SeasonBody>>().items.map((s) => s.id)).toEqual([rugby2027.id]);
        }
      });

      it('hides the seasons of another club', async () => {
        const read = await request(adminB, 'GET', `/v1/seasons/${rugby2027.id}`);
        expect(read.statusCode).toBe(404);
        const update = await request(adminB, 'PATCH', `/v1/seasons/${rugby2027.id}`, {
          version: rugby2027.version,
          name: 'Robada',
        });
        expect(update.statusCode).toBe(404);
        const list = await request(adminB, 'GET', '/v1/seasons?status=all');
        expect(list.json<Page<SeasonBody>>().items).toEqual([]);
      });

      it('lists with cursor pagination and sort', async () => {
        const first = await request(adminA, 'GET', '/v1/seasons?limit=1&sort=name');
        const page1 = first.json<Page<SeasonBody>>();
        expect(page1.items).toHaveLength(1);
        expect(page1.nextCursor).not.toBeNull();
        const second = await request(
          adminA,
          'GET',
          `/v1/seasons?limit=1&sort=name&cursor=${page1.nextCursor ?? ''}`,
        );
        const page2 = second.json<Page<SeasonBody>>();
        expect(page2.items).toHaveLength(1);
        expect(page2.nextCursor).toBeNull();
        expect(new Set([...page1.items, ...page2.items].map((s) => s.id))).toEqual(
          new Set([rugby2027.id, hockey2027.id]),
        );
        const reused = await request(
          adminA,
          'GET',
          `/v1/seasons?limit=1&sort=-name&cursor=${page1.nextCursor ?? ''}`,
        );
        expect(reused.statusCode).toBe(400);
      });

      it('lets a supporting superadmin manage seasons', async () => {
        const response = await request(supporting(clubB), 'POST', '/v1/seasons', {
          sport: 'rugby',
          name: '2027',
          startsOn: '2027-03-01',
          endsOn: '2027-10-31',
        });
        expect(response.statusCode, response.body).toBe(201);
      });
    });

    describe('testing windows', () => {
      const windowUrl = () => `/v1/seasons/${rugby2027.id}/test-windows`;

      it('lets the S&C staff plan them, idempotently', async () => {
        const clientUuid = randomUUID();
        const payload = { clientUuid, number: 1, startsOn: '2027-02-01', endsOn: '2027-02-28' };
        const first = await request(scA, 'POST', windowUrl(), payload);
        expect(first.statusCode, first.body).toBe(201);
        v1 = first.json<WindowBody>();
        expect(v1).toMatchObject({ number: 1, label: 'V1', seasonId: rugby2027.id });
        const replay = await request(scA, 'POST', windowUrl(), payload);
        expect(replay.statusCode).toBe(201);
        expect(replay.headers['x-idempotent-replay']).toBe('true');
        expect(replay.json<WindowBody>().id).toBe(v1.id);

        const second = await request(adminA, 'POST', windowUrl(), {
          number: 2,
          startsOn: '2027-04-01',
          endsOn: '2027-04-30',
        });
        expect(second.statusCode, second.body).toBe(201);
        v2 = second.json<WindowBody>();
      });

      it('keeps them inside the season, apart and in order', async () => {
        for (const [number, startsOn, endsOn, field] of [
          [3, '2027-04-20', '2027-05-10', 'startsOn'],
          [3, '2027-03-01', '2027-03-10', 'startsOn'],
          [4, '2027-11-20', '2027-12-10', 'endsOn'],
          [3, '2027-07-10', '2027-07-01', 'endsOn'],
        ] as const) {
          const response = await request(scA, 'POST', windowUrl(), { number, startsOn, endsOn });
          expect(response.statusCode, `${String(number)} ${startsOn}`).toBe(400);
          expect(errorOf(response).details?.[0]?.path).toEqual(['body', field]);
        }
        const repeated = await request(scA, 'POST', windowUrl(), {
          number: 1,
          startsOn: '2027-06-01',
          endsOn: '2027-06-10',
        });
        expect(repeated.statusCode).toBe(409);
      });

      it('denies the coach and other clubs', async () => {
        const coach = await request(coachA, 'POST', windowUrl(), {
          number: 3,
          startsOn: '2027-07-01',
          endsOn: '2027-07-31',
        });
        expect(coach.statusCode).toBe(403);
        const other = await request(adminB, 'POST', windowUrl(), {
          number: 3,
          startsOn: '2027-07-01',
          endsOn: '2027-07-31',
        });
        expect(other.statusCode).toBe(404);
      });

      it('moves a window with its version', async () => {
        const moved = await request(scA, 'PATCH', `/v1/test-windows/${v2.id}`, {
          version: v2.version,
          startsOn: '2027-04-05',
        });
        expect(moved.statusCode, moved.body).toBe(200);
        const stale = await request(scA, 'PATCH', `/v1/test-windows/${v2.id}`, {
          version: v2.version,
          endsOn: '2027-04-25',
        });
        expect(stale.statusCode).toBe(409);
        v2 = moved.json<WindowBody>();
        expect(v2.startsOn).toBe('2027-04-05');
        const overlapping = await request(scA, 'PATCH', `/v1/test-windows/${v2.id}`, {
          version: v2.version,
          startsOn: '2027-02-20',
        });
        expect(overlapping.statusCode).toBe(400);
      });

      it('does not let the season leave its windows outside', async () => {
        const shrink = await request(adminA, 'PATCH', `/v1/seasons/${rugby2027.id}`, {
          version: rugby2027.version,
          startsOn: '2027-03-01',
        });
        expect(shrink.statusCode).toBe(400);
        expect(errorOf(shrink).details?.[0]?.path).toEqual(['body', 'startsOn']);
        const rename = await request(adminA, 'PATCH', `/v1/seasons/${rugby2027.id}`, {
          version: rugby2027.version,
          name: 'Temporada 2027',
        });
        expect(rename.statusCode, rename.body).toBe(200);
        rugby2027 = rename.json<SeasonBody>();
        expect(rugby2027.testWindows.map((w) => w.label)).toEqual(['V1', 'V2']);
      });

      it('archives and restores a window', async () => {
        const archived = await request(scA, 'POST', `/v1/test-windows/${v2.id}/archive`);
        expect(archived.statusCode).toBe(200);
        expect(archived.json<WindowBody>().archivedAt).not.toBeNull();
        const again = await request(scA, 'POST', `/v1/test-windows/${v2.id}/archive`);
        expect(again.statusCode).toBe(200);
        // An archived V2 is still V2 of the season: a new V2 is a conflict, restoring is the way.
        const duplicate = await request(scA, 'POST', windowUrl(), {
          number: 2,
          startsOn: '2027-05-01',
          endsOn: '2027-05-10',
        });
        expect(duplicate.statusCode).toBe(409);
        const restored = await request(scA, 'POST', `/v1/test-windows/${v2.id}/restore`);
        expect(restored.statusCode, restored.body).toBe(200);
        v2 = restored.json<WindowBody>();
        expect(v2.archivedAt).toBeNull();
      });
    });

    describe('scheduled test days', () => {
      it('lets the S&C staff of the category schedule one in a window', async () => {
        const clientUuid = randomUUID();
        const payload = {
          clientUuid,
          categoryId: m15,
          scheduledOn: '2027-02-10',
          testWindowId: v1.id,
          location: 'Cancha 2',
        };
        const first = await request(scA, 'POST', '/v1/test-sessions', payload);
        expect(first.statusCode, first.body).toBe(201);
        testDay = first.json<TestSessionBody>();
        expect(testDay).toMatchObject({
          sport: 'rugby',
          categoryId: m15,
          testWindowId: v1.id,
          scheduledOn: '2027-02-10',
          status: 'scheduled',
          location: 'Cancha 2',
        });
        const replay = await request(scA, 'POST', '/v1/test-sessions', payload);
        expect(replay.headers['x-idempotent-replay']).toBe('true');
        expect(replay.json<TestSessionBody>().id).toBe(testDay.id);
      });

      it('checks the window: same sport, active, containing the day', async () => {
        const outside = await request(scA, 'POST', '/v1/test-sessions', {
          categoryId: m15,
          scheduledOn: '2027-03-10',
          testWindowId: v1.id,
        });
        expect(outside.statusCode).toBe(400);
        expect(errorOf(outside).details?.[0]?.path).toEqual(['body', 'scheduledOn']);
        const hockeyWindow = await request(
          adminA,
          'POST',
          `/v1/seasons/${hockey2027.id}/test-windows`,
          {
            number: 1,
            startsOn: '2027-02-01',
            endsOn: '2027-02-28',
          },
        );
        expect(hockeyWindow.statusCode).toBe(201);
        const otherSport = await request(adminA, 'POST', '/v1/test-sessions', {
          categoryId: m15,
          scheduledOn: '2027-02-10',
          testWindowId: hockeyWindow.json<WindowBody>().id,
        });
        expect(otherSport.statusCode).toBe(400);
        expect(errorOf(otherSport).details?.[0]?.path).toEqual(['body', 'testWindowId']);
        const unknown = await request(adminA, 'POST', '/v1/test-sessions', {
          categoryId: m15,
          scheduledOn: '2027-02-10',
          testWindowId: randomUUID(),
        });
        expect(unknown.statusCode).toBe(400);
      });

      it('is scheduled by the S&C staff of the category only', async () => {
        const outOfScope = await request(scA, 'POST', '/v1/test-sessions', {
          categoryId: m17,
          scheduledOn: '2027-02-11',
        });
        expect(outOfScope.statusCode).toBe(403);
        const coach = await request(coachA, 'POST', '/v1/test-sessions', {
          categoryId: m15,
          scheduledOn: '2027-02-11',
        });
        expect(coach.statusCode).toBe(403);
        const otherClub = await request(adminB, 'POST', '/v1/test-sessions', {
          categoryId: m15,
          scheduledOn: '2027-02-11',
        });
        expect(otherClub.statusCode).toBe(404);
        const m17Day = await request(adminA, 'POST', '/v1/test-sessions', {
          categoryId: m17,
          scheduledOn: '2027-02-12',
        });
        expect(m17Day.statusCode).toBe(201);
        const hockeyDay = await request(adminA, 'POST', '/v1/test-sessions', {
          categoryId: hockeyM15,
          scheduledOn: '2027-02-12',
        });
        expect(hockeyDay.statusCode).toBe(201);
      });

      it('is listed within the scope of each staff member', async () => {
        const days = async (caller: SignedIn, query = '') => {
          const response = await request(caller, 'GET', `/v1/test-sessions${query}`);
          expect(response.statusCode, response.body).toBe(200);
          return response.json<Page<TestSessionBody>>().items;
        };
        expect((await days(adminA)).map((d) => d.categoryId).sort()).toEqual(
          [m15, m17, hockeyM15].sort(),
        );
        expect((await days(coachA)).map((d) => d.id)).toEqual([testDay.id]);
        expect((await days(medicalA)).map((d) => d.categoryId).sort()).toEqual([m15, m17].sort());
        expect(await days(adminA, '?from=2027-02-11&to=2027-02-28&sport=rugby')).toHaveLength(1);
        expect(await days(adminA, `?testWindowId=${v1.id}`)).toHaveLength(1);
        const read = await request(coachA, 'GET', `/v1/test-sessions/${testDay.id}`);
        expect(read.statusCode).toBe(200);
        const player = await request(playerA, 'GET', '/v1/test-sessions');
        expect(player.statusCode).toBe(403);
        const foreign = await request(adminB, 'GET', `/v1/test-sessions/${testDay.id}`);
        expect(foreign.statusCode).toBe(404);
      });

      it('reschedules with a reason, recorded in the change history', async () => {
        const withoutReason = await request(scA, 'PATCH', `/v1/test-sessions/${testDay.id}`, {
          version: testDay.version,
          scheduledOn: '2027-02-12',
        });
        expect(withoutReason.statusCode).toBe(400);
        expect(errorOf(withoutReason).details?.[0]?.path).toEqual(['body', 'changeReason']);
        const response = await t.app.inject({
          method: 'PATCH',
          url: `/v1/test-sessions/${testDay.id}`,
          headers: { ...scA.headers, 'x-request-id': 'req-reschedule-test-day' },
          payload: {
            version: testDay.version,
            scheduledOn: '2027-02-12',
            changeReason: 'Lluvia: se pasa al viernes',
          },
        });
        expect(response.statusCode, response.body).toBe(200);
        const stale = await request(scA, 'PATCH', `/v1/test-sessions/${testDay.id}`, {
          version: testDay.version,
          location: 'Cancha 1',
          changeReason: 'Otra cancha',
        });
        expect(stale.statusCode).toBe(409);
        testDay = response.json<TestSessionBody>();
        expect(testDay.scheduledOn).toBe('2027-02-12');
        const history = await database.admin.query<{ reason: string; request_id: string }>(
          `select reason, request_id from change_history where record_id = $1`,
          [testDay.id],
        );
        expect(history.rows).toEqual([
          { reason: 'Lluvia: se pasa al viernes', request_id: 'req-reschedule-test-day' },
        ]);
        // A window cannot shrink leaving the day outside.
        const shrink = await request(scA, 'PATCH', `/v1/test-windows/${v1.id}`, {
          version: (await request(scA, 'GET', `/v1/seasons/${rugby2027.id}`))
            .json<SeasonBody>()
            .testWindows.find((w) => w.id === v1.id)?.version,
          endsOn: '2027-02-11',
        });
        expect(shrink.statusCode).toBe(409);
      });

      it('cancels and restores a scheduled day', async () => {
        const cancelled = await request(scA, 'POST', `/v1/test-sessions/${testDay.id}/cancel`);
        expect(cancelled.statusCode).toBe(200);
        expect(cancelled.json<TestSessionBody>().status).toBe('cancelled');
        const again = await request(scA, 'POST', `/v1/test-sessions/${testDay.id}/cancel`);
        expect(again.json<TestSessionBody>().status).toBe('cancelled');
        const edit = await request(scA, 'PATCH', `/v1/test-sessions/${testDay.id}`, {
          version: again.json<TestSessionBody>().version,
          location: 'Cancha 3',
          changeReason: 'Cambio de cancha',
        });
        expect(edit.statusCode).toBe(409);
        const restored = await request(scA, 'POST', `/v1/test-sessions/${testDay.id}/restore`);
        expect(restored.statusCode).toBe(200);
        testDay = restored.json<TestSessionBody>();
        expect(testDay.status).toBe('scheduled');
        // Running it is B-320; once it is under way it is no longer cancelled here.
        await database.admin.query(
          `update test_session set status = 'in_progress', started_at = now() where id = $1`,
          [testDay.id],
        );
        const running = await request(scA, 'POST', `/v1/test-sessions/${testDay.id}/cancel`);
        expect(running.statusCode).toBe(409);
        await database.admin.query(
          `update test_session set status = 'scheduled', started_at = null where id = $1`,
          [testDay.id],
        );
      });

      it('does not archive a window or season with days still to run', async () => {
        const window = await request(scA, 'POST', `/v1/test-windows/${v1.id}/archive`);
        expect(window.statusCode).toBe(409);
        const season = await request(adminA, 'POST', `/v1/seasons/${rugby2027.id}/archive`);
        expect(season.statusCode).toBe(409);
        const current = await request(adminA, 'GET', `/v1/seasons/${rugby2027.id}`);
        expect(current.json<SeasonBody>().archivedAt).toBeNull();
        expect(
          current.json<SeasonBody>().testWindows.find((w) => w.id === v1.id)?.archivedAt,
        ).toBeNull();
      });

      it('restores a cancelled day only into a window that still holds it', async () => {
        const windowVersion = async () =>
          (await request(scA, 'GET', `/v1/seasons/${rugby2027.id}`))
            .json<SeasonBody>()
            .testWindows.find((w) => w.id === v1.id)?.version;
        const restore = () => request(scA, 'POST', `/v1/test-sessions/${testDay.id}/restore`);
        const cancel = await request(scA, 'POST', `/v1/test-sessions/${testDay.id}/cancel`);
        expect(cancel.statusCode).toBe(200);

        // A cancelled day does not hold the window: it can shrink past it…
        const shrink = await request(scA, 'PATCH', `/v1/test-windows/${v1.id}`, {
          version: await windowVersion(),
          endsOn: '2027-02-05',
        });
        expect(shrink.statusCode, shrink.body).toBe(200);
        // …but then the day does not come back outside it.
        const outside = await restore();
        expect(outside.statusCode).toBe(409);
        const still = await request(scA, 'GET', `/v1/test-sessions/${testDay.id}`);
        expect(still.json<TestSessionBody>().status).toBe('cancelled');
        const grow = await request(scA, 'PATCH', `/v1/test-windows/${v1.id}`, {
          version: await windowVersion(),
          endsOn: '2027-02-28',
        });
        expect(grow.statusCode, grow.body).toBe(200);

        // Nor into an archived window or season.
        const archiveWindow = await request(scA, 'POST', `/v1/test-windows/${v1.id}/archive`);
        expect(archiveWindow.statusCode, archiveWindow.body).toBe(200);
        expect((await restore()).statusCode).toBe(409);
        const restoreWindow = await request(scA, 'POST', `/v1/test-windows/${v1.id}/restore`);
        expect(restoreWindow.statusCode, restoreWindow.body).toBe(200);
        const archiveSeason = await request(adminA, 'POST', `/v1/seasons/${rugby2027.id}/archive`);
        expect(archiveSeason.statusCode, archiveSeason.body).toBe(200);
        expect((await restore()).statusCode).toBe(409);
        const restoreSeason = await request(adminA, 'POST', `/v1/seasons/${rugby2027.id}/restore`);
        expect(restoreSeason.statusCode, restoreSeason.body).toBe(200);
        rugby2027 = restoreSeason.json<SeasonBody>();

        const restored = await restore();
        expect(restored.statusCode, restored.body).toBe(200);
        testDay = restored.json<TestSessionBody>();
        expect(testDay).toMatchObject({ status: 'scheduled', testWindowId: v1.id });
      });
    });

    describe('fixture', () => {
      it('lets the coach of the category add a match, kick-off in the club time zone', async () => {
        const clientUuid = randomUUID();
        const payload = {
          clientUuid,
          categoryId: m15,
          opponent: 'Club Atlético San Isidro',
          venue: 'away',
          competition: 'Torneo URBA M15',
          date: '2027-04-10',
          kickoffTime: '15:30',
        };
        const first = await request(coachA, 'POST', '/v1/fixtures', payload);
        expect(first.statusCode, first.body).toBe(201);
        match = first.json<FixtureBody>();
        expect(match).toMatchObject({
          sport: 'rugby',
          categoryId: m15,
          opponent: 'Club Atlético San Isidro',
          venue: 'away',
          competition: 'Torneo URBA M15',
          date: '2027-04-10',
          kickoffTime: '15:30',
          // Buenos Aires is UTC−3 all year.
          startsAt: '2027-04-10T18:30:00.000Z',
          status: 'scheduled',
          archivedAt: null,
        });
        const replay = await request(coachA, 'POST', '/v1/fixtures', payload);
        expect(replay.headers['x-idempotent-replay']).toBe('true');
        expect(replay.json<FixtureBody>().id).toBe(match.id);

        const noTime = await request(adminA, 'POST', '/v1/fixtures', {
          categoryId: m15,
          opponent: 'Belgrano Athletic',
          venue: 'home',
          date: '2027-04-17',
        });
        expect(noTime.statusCode).toBe(201);
        expect(noTime.json<FixtureBody>()).toMatchObject({ kickoffTime: null, startsAt: null });
      });

      it('validates the texts and the kick-off', async () => {
        for (const extra of [
          { kickoffTime: '24:00' },
          { kickoffTime: '15:30:00' },
          { opponent: ' Rival' },
          { venue: 'local' },
          { date: '2027-02-30' },
        ]) {
          const response = await request(coachA, 'POST', '/v1/fixtures', {
            categoryId: m15,
            opponent: 'Rival',
            venue: 'home',
            date: '2027-05-01',
            ...extra,
          });
          expect(response.statusCode, JSON.stringify(extra)).toBe(400);
        }
      });

      it('is managed by the coach of the category and the administration only', async () => {
        const payload = { categoryId: m17, opponent: 'Rival', venue: 'home', date: '2027-05-01' };
        expect((await request(coachA, 'POST', '/v1/fixtures', payload)).statusCode).toBe(403);
        expect(
          (await request(scA, 'POST', '/v1/fixtures', { ...payload, categoryId: m15 })).statusCode,
        ).toBe(403);
        expect((await request(adminB, 'POST', '/v1/fixtures', payload)).statusCode).toBe(404);
        const update = await request(scA, 'PATCH', `/v1/fixtures/${match.id}`, {
          version: match.version,
          status: 'postponed',
        });
        expect(update.statusCode).toBe(403);
      });

      it('postpones a match with its version, archives and restores it', async () => {
        const postponed = await request(coachA, 'PATCH', `/v1/fixtures/${match.id}`, {
          version: match.version,
          status: 'postponed',
          kickoffTime: null,
        });
        expect(postponed.statusCode, postponed.body).toBe(200);
        expect(postponed.json<FixtureBody>()).toMatchObject({
          status: 'postponed',
          kickoffTime: null,
          startsAt: null,
        });
        const stale = await request(coachA, 'PATCH', `/v1/fixtures/${match.id}`, {
          version: match.version,
          opponent: 'Otro',
        });
        expect(stale.statusCode).toBe(409);
        const rescheduled = await request(coachA, 'PATCH', `/v1/fixtures/${match.id}`, {
          version: postponed.json<FixtureBody>().version,
          status: 'scheduled',
          date: '2027-04-24',
          kickoffTime: '10:00',
        });
        expect(rescheduled.statusCode).toBe(200);
        match = rescheduled.json<FixtureBody>();
        expect(match.startsAt).toBe('2027-04-24T13:00:00.000Z');

        const archived = await request(coachA, 'POST', `/v1/fixtures/${match.id}/archive`);
        expect(archived.json<FixtureBody>().archivedAt).not.toBeNull();
        const list = await request(coachA, 'GET', '/v1/fixtures');
        expect(list.json<Page<FixtureBody>>().items.map((f) => f.id)).not.toContain(match.id);
        const restored = await request(coachA, 'POST', `/v1/fixtures/${match.id}/restore`);
        expect(restored.json<FixtureBody>().archivedAt).toBeNull();
      });

      it('lists the matches in scope, filtered and paged', async () => {
        await request(adminA, 'POST', '/v1/fixtures', {
          categoryId: m17,
          opponent: 'Hindú',
          venue: 'neutral',
          date: '2027-04-10',
        });
        const all = await request(adminA, 'GET', '/v1/fixtures?sport=rugby');
        expect(all.json<Page<FixtureBody>>().items.map((f) => f.date)).toEqual([
          '2027-04-10',
          '2027-04-17',
          '2027-04-24',
        ]);
        const coach = await request(coachA, 'GET', '/v1/fixtures');
        expect(coach.json<Page<FixtureBody>>().items.every((f) => f.categoryId === m15)).toBe(true);
        const away = await request(adminA, 'GET', '/v1/fixtures?venue=neutral');
        expect(away.json<Page<FixtureBody>>().items.map((f) => f.categoryId)).toEqual([m17]);
        const page = await request(adminA, 'GET', '/v1/fixtures?limit=2&sort=-date');
        const body = page.json<Page<FixtureBody>>();
        expect(body.items.map((f) => f.date)).toEqual(['2027-04-24', '2027-04-17']);
        const next = await request(
          adminA,
          'GET',
          `/v1/fixtures?limit=2&sort=-date&cursor=${body.nextCursor ?? ''}`,
        );
        expect(next.json<Page<FixtureBody>>().items.map((f) => f.date)).toEqual(['2027-04-10']);
        expect((await request(playerA, 'GET', '/v1/fixtures')).statusCode).toBe(403);
        expect((await request(adminB, 'GET', `/v1/fixtures/${match.id}`)).statusCode).toBe(404);
      });
    });

    describe('calendar of a category', () => {
      const calendarOf = (caller: SignedIn, query: string) =>
        request(caller, 'GET', `/v1/calendar?${query}`);

      it('merges windows, test days and matches by day, paged', async () => {
        const seen: EventBody[] = [];
        let cursor: string | null = null;
        do {
          const response: LightMyRequestResponse = await calendarOf(
            adminA,
            `categoryId=${m15}&from=2027-01-01&to=2027-12-31&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`,
          );
          expect(response.statusCode, response.body).toBe(200);
          const page: Page<EventBody> = response.json();
          seen.push(...page.items);
          cursor = page.nextCursor;
        } while (cursor !== null);
        expect(seen.map((e) => `${e.date} ${e.type}`)).toEqual([
          '2027-02-01 test_window',
          '2027-02-12 test_session',
          '2027-04-05 test_window',
          '2027-04-17 fixture',
          '2027-04-24 fixture',
        ]);
        const window = seen[0];
        expect(window?.type === 'test_window' && window.season.name).toBe('Temporada 2027');
        expect(window?.type === 'test_window' && window.endDate).toBe('2027-02-28');
      });

      it('includes a window that crosses the range', async () => {
        const response = await calendarOf(
          adminA,
          `categoryId=${m15}&from=2027-02-20&to=2027-03-31`,
        );
        expect(response.json<Page<EventBody>>().items.map((e) => e.type)).toEqual(['test_window']);
      });

      it('checks the range and the scope', async () => {
        const inverted = await calendarOf(
          adminA,
          `categoryId=${m15}&from=2027-12-31&to=2027-01-01`,
        );
        expect(inverted.statusCode).toBe(400);
        const long = await calendarOf(adminA, `categoryId=${m15}&from=2027-01-01&to=2028-01-02`);
        expect(long.statusCode).toBe(400);
        expect(errorOf(long).details?.[0]?.path).toEqual(['query', 'to']);
        const coach = await calendarOf(coachA, `categoryId=${m17}&from=2027-01-01&to=2027-12-31`);
        expect(coach.statusCode).toBe(403);
        const own = await calendarOf(coachA, `categoryId=${m15}&from=2027-01-01&to=2027-12-31`);
        expect(own.statusCode).toBe(200);
        const player = await calendarOf(playerA, `categoryId=${m15}&from=2027-01-01&to=2027-12-31`);
        expect(player.statusCode).toBe(403);
        const foreign = await calendarOf(adminB, `categoryId=${m15}&from=2027-01-01&to=2027-12-31`);
        expect(foreign.statusCode).toBe(404);
      });
    });

    describe('archived seasons', () => {
      it('leave the plan and come back only without overlapping', async () => {
        const archived = await request(adminA, 'POST', `/v1/seasons/${hockey2027.id}/archive`);
        expect(archived.statusCode).toBe(200);
        expect(archived.json<SeasonBody>().archivedAt).not.toBeNull();
        const replacement = await request(adminA, 'POST', '/v1/seasons', {
          sport: 'hockey',
          name: '2027 (nueva)',
          startsOn: '2027-03-01',
          endsOn: '2027-12-15',
        });
        expect(replacement.statusCode, replacement.body).toBe(201);
        const restore = await request(adminA, 'POST', `/v1/seasons/${hockey2027.id}/restore`);
        expect(restore.statusCode).toBe(409);
        // Windows of an archived season are not planned.
        const window = await request(adminA, 'POST', `/v1/seasons/${hockey2027.id}/test-windows`, {
          number: 2,
          startsOn: '2027-04-01',
          endsOn: '2027-04-30',
        });
        expect(window.statusCode).toBe(409);
        const list = await request(adminA, 'GET', '/v1/seasons?sport=hockey&status=archived');
        expect(list.json<Page<SeasonBody>>().items.map((s) => s.id)).toEqual([hockey2027.id]);
      });
    });
  },
);
