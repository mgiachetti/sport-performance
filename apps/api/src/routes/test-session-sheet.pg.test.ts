/**
 * The sheet of a test day (B-405, ADR 0068) against Postgres 16, through the
 * real connection roles: the permission matrix on the day's category, the
 * players filtered by what the caller may read (RLS behind), the stations of
 * the day's window resolved from the seeded battery, the stage rules per
 * player, the protocol version in effect, the previous result of each test
 * and the club's devices.
 */
import { randomUUID } from 'node:crypto';
import { DEVICE_KINDS as CONTRACT_DEVICE_KINDS } from '@sport-performance/contracts';
import { DEVICE_KINDS } from '@sport-performance/db/schema';
import type { ClubId } from '@sport-performance/domain';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  createMembership,
  createTestDatabase,
  signIn,
  startIdentityApp,
  type IdentityTestApp,
  type SignedIn,
  type TestDatabase,
} from '../testing/identity.js';
import { describeWithPostgres } from '../testing/support.js';

interface SheetBody {
  testSession: { id: string; status: string };
  testWindow: { number: number; label: string } | null;
  stations: {
    testCode: string;
    scheduled: boolean;
    definition: {
      id: string;
      version: number;
      attemptCount: number;
      sameDeviceOnly: boolean;
      entryKinds: string[];
      protocol: { summary: string | null; steps: string[]; restBetweenAttemptsS: number | null };
      metrics: { code: string; unit: string; derived: boolean }[];
    };
  }[];
  players: {
    id: string;
    lastName: string;
    inCategory: boolean;
    recording: string;
    video: string;
    stage: string | null;
    strengthAssessment: string | null;
    tests: { testCode: string; applicable: boolean; reason: string | null }[];
    previous: {
      testCode: string;
      measuredOn: string;
      method: string;
      scores: { metricCode: string; value: number }[];
    }[];
  }[];
  devices: { id: string; kind: string; label: string }[];
}

const SUPPORT_REASON = encodeURIComponent('Alta del club para la planilla de B-405');

vi.setConfig({ testTimeout: 30_000 });

describeWithPostgres('test day sheet (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let scA: SignedIn;
  let scM17: SignedIn;
  let coachA: SignedIn;
  let playerUser: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  const categories: Record<string, string> = {};
  const definitions: Record<string, string> = {};
  const windows: Record<number, string> = {};
  let ana = '';
  let bruno = '';
  let carla = '';
  let diego = '';
  let v1Session = '';
  let v2Session = '';
  let device = '';

  const registry = () => ({ ...superadmin.headers, 'x-support-reason': SUPPORT_REASON });
  const post = (caller: SignedIn, url: string, payload: unknown) =>
    t.app.inject({ method: 'POST', url, headers: caller.headers, payload: payload as never });
  const sheetOf = (caller: SignedIn, id: string) =>
    t.app.inject({ url: `/v1/test-sessions/${id}/sheet`, headers: caller.headers });

  async function createClub(slug: string): Promise<ClubId> {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: registry(),
      payload: {
        slug,
        name: `Club ${slug}`,
        shortName: slug.toUpperCase(),
        branches: [{ sport: 'rugby', sex: 'male' }],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ club: { id: ClubId } }>().club.id;
  }

  async function insertPlayer(
    lastName: string,
    categoryId: string,
    userId?: string,
    consent = true,
  ) {
    const created = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', $3, '2011-05-01', 'male', 'rugby', '2020-01-01') returning id`,
      [clubA, userId ?? null, lastName],
    );
    const id = created.rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, id, categoryId],
    );
    if (consent) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, 'data', 'v1', 'guardian', $3)`,
        [clubA, id, adminA.userId],
      );
    }
    return id;
  }

  async function assign(membershipId: string, categoryId: string): Promise<void> {
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, membershipId, categoryId],
    );
  }

  async function scheduleDay(scheduledOn: string, testWindowId: string): Promise<string> {
    const response = await post(adminA, '/v1/test-sessions', {
      categoryId: categories.m15,
      scheduledOn,
      testWindowId,
      location: 'Cancha 2',
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ id: string }>().id;
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
    adminA = await signIn(t, 'admin@sheet-a.example.com');
    adminB = await signIn(t, 'admin@sheet-b.example.com');
    scA = await signIn(t, 'sc@sheet-a.example.com');
    scM17 = await signIn(t, 'sc17@sheet-a.example.com');
    coachA = await signIn(t, 'coach@sheet-a.example.com');
    playerUser = await signIn(t, 'player@sheet-a.example.com');

    clubA = await createClub('sheet-a');
    clubB = await createClub('sheet-b');
    const rows = await database.admin.query<{ id: string; age_band_code: string }>(
      `select id, age_band_code from category where club_id = $1`,
      [clubA],
    );
    for (const row of rows.rows) categories[row.age_band_code] = row.id;
    const defs = await database.admin.query<{ id: string; code: string }>(
      `select id, code from test_definition where club_id = $1`,
      [clubA],
    );
    for (const row of defs.rows) definitions[row.code] = row.id;

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    await assign(
      await createMembership(database.admin, scA.userId, clubA, 'sc'),
      categories.m15 ?? '',
    );
    await assign(
      await createMembership(database.admin, scM17.userId, clubA, 'sc'),
      categories.m17 ?? '',
    );
    await assign(
      await createMembership(database.admin, coachA.userId, clubA, 'coach'),
      categories.m15 ?? '',
    );
    await createMembership(database.admin, playerUser.userId, clubA, 'player');

    ana = await insertPlayer('Álvarez', categories.m15 ?? '', playerUser.userId);
    bruno = await insertPlayer('Benítez', categories.m15 ?? '');
    carla = await insertPlayer('Castro', categories.m17 ?? '');
    diego = await insertPlayer('Díaz', categories.m15 ?? '', undefined, false);
    // Bruno's stage is pinned to performance: the bronco of V1 is his only.
    await database.admin.query(
      `insert into player_stage (club_id, player_id, stage, basis, reason, valid_from)
       values ($1, $2, 'performance', 'manual', 'pinned', '2026-01-01')`,
      [clubA, bruno],
    );

    const season = await post(adminA, '/v1/seasons', {
      sport: 'rugby',
      name: '2026',
      startsOn: '2026-02-01',
      endsOn: '2026-11-30',
    });
    expect(season.statusCode, season.body).toBe(201);
    const seasonId = season.json<{ id: string }>().id;
    const spans: [number, string, string][] = [
      [1, '2026-02-01', '2026-02-28'],
      [2, '2026-04-01', '2026-04-30'],
    ];
    for (const [number, startsOn, endsOn] of spans) {
      const created = await post(adminA, `/v1/seasons/${seasonId}/test-windows`, {
        number,
        startsOn,
        endsOn,
      });
      expect(created.statusCode, created.body).toBe(201);
      windows[number] = created.json<{ id: string }>().id;
    }
    v1Session = await scheduleDay('2026-02-10', windows[1] ?? '');
    v2Session = await scheduleDay('2026-04-14', windows[2] ?? '');

    const inserted = await database.admin.query<{ id: string }>(
      `insert into device (club_id, kind, label) values ($1, 'tablet', 'Tablet 1') returning id`,
      [clubA],
    );
    device = inserted.rows[0]?.id ?? '';
    await database.admin.query(
      `insert into device (club_id, kind, label, retired_at) values ($1, 'phone', 'Viejo', now())`,
      [clubA],
    );

    // A sprint before both days (outside a day), and a newer one on V1.
    const earlier = await post(scA, '/v1/test-results', {
      status: 'done',
      playerId: ana,
      testDefinitionId: definitions.sprint_40,
      measuredOn: '2026-01-20',
      method: 'photocell',
      entries: [
        { kind: 'sprint_splits', attemptNumber: 1, split10S: 1.9, split20S: 3.2, split40S: 5.6 },
      ],
    });
    expect(earlier.statusCode, earlier.body).toBe(201);
    const onV1 = await post(scA, `/v1/test-sessions/${v1Session}/results`, {
      results: [
        {
          status: 'done',
          playerId: ana,
          testDefinitionId: definitions.sprint_40,
          method: 'manual',
          entries: [{ kind: 'sprint_splits', attemptNumber: 1, split20S: 3.1, split40S: 5.4 }],
        },
      ],
    });
    expect(onV1.statusCode, onV1.body).toBe(201);
    // Mobility is not in V2, but it is in Ana's battery: recorded on V2, it shows as a station.
    const mobility = await post(scA, `/v1/test-sessions/${v2Session}/results`, {
      results: [
        {
          status: 'done',
          playerId: ana,
          testDefinitionId: definitions.mobility,
          method: 'manual',
          entries: [
            { kind: 'value', attemptNumber: 1, metricCode: 'knee_to_wall_left_cm', value: 10 },
          ],
        },
      ],
    });
    expect(mobility.statusCode, mobility.body).toBe(201);
    // A newer done sprint between V1 and V2 without any value: it says nothing,
    // so the previous sprint of V2 falls back to the one of V1.
    await database.admin.query(
      `insert into test_result (club_id, player_id, test_definition_id, measured_on, status, method)
       values ($1, $2, $3, '2026-03-05', 'done', 'manual')`,
      [clubA, ana, definitions.sprint_40],
    );
  }, 240_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('keeps the device kinds of the contract in step with the database', () => {
    expect([...CONTRACT_DEVICE_KINDS]).toEqual([...DEVICE_KINDS]);
  });

  it('gives the stations of the window, the version in effect and the protocol', async () => {
    const response = await sheetOf(scA, v2Session);
    expect(response.statusCode, response.body).toBe(200);
    const sheet = response.json<SheetBody>();
    expect(sheet.testWindow).toEqual({ id: windows[2], number: 2, label: 'V2' });
    expect(sheet.stations.map((s) => [s.testCode, s.scheduled])).toEqual([
      ['sprint_40', true],
      ['cmj', true],
      ['cod_505', true],
      ['ift_3015', true],
      ['strength', true],
      // Bruno is in the performance stage: neck in every window.
      ['mobility', false],
      ['neck', true],
    ]);
    const sprint = sheet.stations[0]?.definition;
    expect(sprint).toMatchObject({
      id: definitions.sprint_40,
      version: 1,
      attemptCount: 3,
      sameDeviceOnly: false,
      entryKinds: ['sprint_splits', 'sprint_video_frames', 'value'],
      protocol: { restBetweenAttemptsS: 180 },
    });
    expect(sprint?.protocol.steps.length).toBeGreaterThan(0);
    expect(sprint?.metrics.map((m) => [m.code, m.unit, m.derived])).toEqual([
      ['sprint_10_s', 's', false],
      ['sprint_20_s', 's', false],
      ['sprint_40_s', 's', false],
      ['sprint_vmax_ms', 'ms', true],
    ]);
  });

  it('lists the roster of the day with stage, applicability and previous results', async () => {
    const v1 = (await sheetOf(scA, v1Session)).json<SheetBody>();
    expect(v1.stations.map((s) => s.testCode)).toContain('bronco');
    expect(v1.stations.find((s) => s.testCode === 'reaction')?.definition.sameDeviceOnly).toBe(
      true,
    );
    expect(v1.players.map((p) => [p.id, p.inCategory, p.stage, p.recording])).toEqual([
      [ana, true, 'development', 'allowed'],
      [bruno, true, 'performance', 'allowed'],
      [diego, true, 'development', 'missing_consent'],
    ]);
    const bronco = (id: string) =>
      v1.players.find((p) => p.id === id)?.tests.find((x) => x.testCode === 'bronco');
    expect(bronco(ana)).toEqual({
      testCode: 'bronco',
      applicable: false,
      reason: 'not_in_battery',
    });
    expect(bronco(bruno)).toEqual({ testCode: 'bronco', applicable: true, reason: null });
    expect(v1.players[0]?.strengthAssessment).toBe('estimated_rm');
    // The previous sprint of V1 is the one of January, not the one of the day itself.
    expect(v1.players[0]?.previous).toEqual([
      expect.objectContaining({
        testCode: 'sprint_40',
        measuredOn: '2026-01-20',
        method: 'photocell',
      }),
    ]);
    const v2 = (await sheetOf(scA, v2Session)).json<SheetBody>();
    const previousSprint = v2.players[0]?.previous.find((p) => p.testCode === 'sprint_40');
    expect(previousSprint).toMatchObject({ measuredOn: '2026-02-10', method: 'manual' });
    expect(previousSprint?.scores.find((s) => s.metricCode === 'sprint_40_s')?.value).toBe(5.4);
    expect(v2.players[1]?.previous).toEqual([]);
    expect(v2.devices).toEqual([{ id: device, kind: 'tablet', label: 'Tablet 1' }]);
  });

  it('shows the day to its category staff and the administration only', async () => {
    const coach = await sheetOf(coachA, v2Session);
    expect(coach.statusCode).toBe(200);
    // The coach reads the day but never records results.
    expect(new Set(coach.json<SheetBody>().players.map((p) => p.recording))).toEqual(
      new Set(['forbidden']),
    );
    expect(new Set(coach.json<SheetBody>().players.map((p) => p.video))).toEqual(
      new Set(['forbidden']),
    );
    expect((await sheetOf(adminA, v2Session)).statusCode).toBe(200);
    expect((await sheetOf(scM17, v2Session)).statusCode).toBe(403);
    expect((await sheetOf(playerUser, v2Session)).statusCode).toBe(403);
    expect((await sheetOf(adminB, v2Session)).statusCode).toBe(404);
    expect((await sheetOf(scA, randomUUID())).statusCode).toBe(404);
    const support = await t.app.inject({
      url: `/v1/test-sessions/${v2Session}/sheet`,
      headers: { ...superadmin.headers, 'x-support-club-id': clubA, ...registry() },
    });
    expect(support.statusCode, support.body).toBe(200);
  });

  it('says who may be filmed: with an image consent, by who uploads media', async () => {
    const before = (await sheetOf(scA, v1Session)).json<SheetBody>();
    expect(before.players.map((p) => p.video)).toEqual([
      'missing_consent',
      'missing_consent',
      'missing_consent',
    ]);
    await database.admin.query(
      `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
       values ($1, $2, 'image', 'v1', 'guardian', $3)`,
      [clubA, ana, adminA.userId],
    );
    const after = (await sheetOf(scA, v1Session)).json<SheetBody>();
    expect(after.players.map((p) => [p.id, p.video])).toEqual([
      [ana, 'allowed'],
      [bruno, 'missing_consent'],
      [diego, 'missing_consent'],
    ]);
    // The coach reads the day but never films for a test.
    const coach = (await sheetOf(coachA, v1Session)).json<SheetBody>();
    expect(new Set(coach.players.map((p) => p.video))).toEqual(new Set(['forbidden']));
  });

  it('keeps players of other categories out of the roster', async () => {
    const sheet = (await sheetOf(adminA, v2Session)).json<SheetBody>();
    expect(sheet.players.map((p) => p.id)).not.toContain(carla);
  });

  it('marks a maximal loaded test as not allowed for a stage without maximal loads', async () => {
    await database.admin.query(
      `update test_definition set maximal_load = true where club_id = $1 and code = 'strength'`,
      [clubA],
    );
    try {
      const sheet = (await sheetOf(scA, v2Session)).json<SheetBody>();
      const strength = sheet.players
        .find((p) => p.id === ana)
        ?.tests.find((x) => x.testCode === 'strength');
      expect(strength).toEqual({
        testCode: 'strength',
        applicable: false,
        reason: 'maximal_load_not_allowed',
      });
    } finally {
      await database.admin.query(
        `update test_definition set maximal_load = false where club_id = $1 and code = 'strength'`,
        [clubA],
      );
    }
  });
});
