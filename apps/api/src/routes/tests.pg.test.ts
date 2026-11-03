/**
 * Test days and results end to end (B-320) against Postgres 16, through the
 * real connection roles (ADR 0026): the permission matrix in the handlers
 * (ADR 0025) with the data consent of the player, RLS behind it, the
 * endpoint conventions (ADR 0032), the stage rules of the battery, the
 * scoring formulas of the domain, append-only entries corrected by voiding
 * with the change history (ADR 0030), the `injured` projection (ADR 0029)
 * and the warnings when methods are mixed.
 */
import { randomUUID } from 'node:crypto';
import type { ClubId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

interface Envelope {
  error: { code: string; message: string; details?: { path: (string | number)[]; code: string }[] };
}

interface SessionBody {
  id: string;
  sport: string;
  categoryId: string;
  status: string;
  scheduledOn: string;
  evaluatorId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  conditions: Record<string, unknown>;
  version: string;
}

interface EntryBody {
  id: string;
  kind: string;
  attemptNumber: number | null;
  inputs: Record<string, unknown> | null;
  values: { id: string; metricCode: string; value: number; computed: boolean }[];
  issues: string[];
  voided: { reason: string } | null;
}

interface ResultBody {
  id: string;
  playerId: string;
  testCode: string;
  protocolVersion: number;
  status: string;
  notDoneReason: string | null;
  notDoneNote: string | null;
  method: string | null;
  evaluatorId: string | null;
  exercise: string | null;
  conditions: Record<string, unknown>;
  entries: EntryBody[];
  scores: { metricCode: string; value: number; aggregation: string; derived: boolean }[];
  version: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Alta del club para los tests de B-320');

// A test records several results through the real roles: room for a busy CI runner.
vi.setConfig({ testTimeout: 30_000 });

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

function scoreOf(result: ResultBody, metricCode: string): number | undefined {
  return result.scores.find((s) => s.metricCode === metricCode)?.value;
}

describeWithPostgres('test days and results (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let scA: SignedIn;
  let scM17: SignedIn;
  let coachA: SignedIn;
  let medicalA: SignedIn;
  let playerUser: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  const categories: Record<string, string> = {};
  const definitions: Record<string, string> = {};
  const players: Record<'p15' | 'p13' | 'p15NoConsent' | 'p17', string> = {
    p15: '',
    p13: '',
    p15NoConsent: '',
    p17: '',
  };
  let session: SessionBody;

  const registry = () => ({ ...superadmin.headers, 'x-support-reason': SUPPORT_REASON });

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
    clubId: ClubId,
    categoryId: string,
    birthDate: string,
    options: { userId?: string; consent?: boolean } = {},
  ): Promise<string> {
    const created = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', $3, $4, 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, options.userId ?? null, `P${randomUUID().slice(0, 6)}`, birthDate],
    );
    const id = created.rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, id, categoryId],
    );
    if (options.consent !== false) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, 'data', 'v1', 'guardian', $3)`,
        [clubId, id, adminA.userId],
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

  const post = (caller: SignedIn, url: string, payload: unknown) =>
    t.app.inject({ method: 'POST', url, headers: caller.headers, payload: payload as never });
  const patch = (caller: SignedIn, url: string, payload: unknown) =>
    t.app.inject({ method: 'PATCH', url, headers: caller.headers, payload: payload as never });
  const get = (caller: SignedIn, url: string) => t.app.inject({ url, headers: caller.headers });

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
    adminA = await signIn(t, 'admin@tests-a.example.com');
    adminB = await signIn(t, 'admin@tests-b.example.com');
    scA = await signIn(t, 'sc@tests-a.example.com');
    scM17 = await signIn(t, 'sc17@tests-a.example.com');
    coachA = await signIn(t, 'coach@tests-a.example.com');
    medicalA = await signIn(t, 'medical@tests-a.example.com');
    playerUser = await signIn(t, 'player@tests-a.example.com');

    clubA = await createClub('tests-a');
    clubB = await createClub('tests-b');
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
    const scMembership = await createMembership(database.admin, scA.userId, clubA, 'sc');
    const sc17Membership = await createMembership(database.admin, scM17.userId, clubA, 'sc');
    const coachMembership = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    const medicalMembership = await createMembership(
      database.admin,
      medicalA.userId,
      clubA,
      'medical',
    );
    await createMembership(database.admin, playerUser.userId, clubA, 'player');
    for (const band of ['m13', 'm15']) {
      await assign(scMembership, categories[band] ?? '');
      await assign(coachMembership, categories[band] ?? '');
      await assign(medicalMembership, categories[band] ?? '');
    }
    await assign(sc17Membership, categories.m17 ?? '');

    players.p15 = await insertPlayer(clubA, categories.m15 ?? '', '2011-05-01', {
      userId: playerUser.userId,
    });
    players.p13 = await insertPlayer(clubA, categories.m13 ?? '', '2013-05-01');
    players.p15NoConsent = await insertPlayer(clubA, categories.m15 ?? '', '2011-07-01', {
      consent: false,
    });
    players.p17 = await insertPlayer(clubA, categories.m17 ?? '', '2009-03-01');
    await database.admin.query(
      `insert into anthro_measurement (club_id, player_id, measured_on, weight_kg)
       values ($1, $2, '2026-02-01', 60)`,
      [clubA, players.p15],
    );
  }, 240_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('test days', () => {
    const clientUuid = randomUUID();
    const payload = () => ({
      clientUuid,
      categoryId: categories.m15,
      scheduledOn: '2026-03-02',
      location: 'Cancha 2',
      conditions: { surface: 'césped natural', footwear: 'botines', standardizedWarmUp: true },
      evaluatorId: scA.userId,
    });

    it('lets the sc of the category schedule one, idempotently', async () => {
      const created = await post(scA, '/v1/test-sessions', payload());
      expect(created.statusCode, created.body).toBe(201);
      session = created.json<SessionBody>();
      expect(session).toMatchObject({
        sport: 'rugby',
        categoryId: categories.m15,
        status: 'scheduled',
        evaluatorId: scA.userId,
        conditions: { surface: 'césped natural' },
      });
      const replay = await post(scA, '/v1/test-sessions', payload());
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<SessionBody>().id).toBe(session.id);
    });

    it('denies the other roles and the sc of another category', async () => {
      for (const caller of [coachA, medicalA, playerUser, scM17]) {
        const response = await post(caller, '/v1/test-sessions', {
          categoryId: categories.m15,
          scheduledOn: '2026-03-03',
        });
        expect(response.statusCode, response.body).toBe(403);
      }
      const notStaff = await post(scA, '/v1/test-sessions', {
        categoryId: categories.m15,
        scheduledOn: '2026-03-03',
        evaluatorId: playerUser.userId,
      });
      expect(notStaff.statusCode).toBe(400);
      expect(errorOf(notStaff).details?.[0]?.path).toEqual(['body', 'evaluatorId']);
    });

    it('lists by assignment, and hides other clubs', async () => {
      const ids = async (caller: SignedIn) =>
        (await get(caller, '/v1/test-sessions')).json<Page<SessionBody>>().items.map((s) => s.id);
      expect(await ids(scA)).toEqual([session.id]);
      expect(await ids(coachA)).toEqual([session.id]);
      expect(await ids(adminA)).toEqual([session.id]);
      expect(await ids(scM17)).toEqual([]);
      expect(await ids(adminB)).toEqual([]);
      expect((await get(adminB, `/v1/test-sessions/${session.id}`)).statusCode).toBe(404);
      expect((await get(playerUser, '/v1/test-sessions')).statusCode).toBe(403);
      // A superadmin supports the club only with a recorded reason (ADR 0029).
      const support = { ...superadmin.headers, 'x-support-club-id': clubA };
      const supported = await t.app.inject({
        url: '/v1/test-sessions',
        headers: { ...support, 'x-support-reason': SUPPORT_REASON },
      });
      expect(supported.statusCode, supported.body).toBe(200);
      expect(supported.json<Page<SessionBody>>().items.map((s) => s.id)).toEqual([session.id]);
      expect((await t.app.inject({ url: '/v1/test-sessions', headers: support })).statusCode).toBe(
        403,
      );
    });

    it('moves through its lifecycle with versions and reasons', async () => {
      const invalid = await patch(scA, `/v1/test-sessions/${session.id}`, {
        version: session.version,
        status: 'completed',
      });
      expect(invalid.statusCode).toBe(409);
      const started = await patch(scA, `/v1/test-sessions/${session.id}`, {
        version: session.version,
        status: 'in_progress',
      });
      expect(started.statusCode, started.body).toBe(200);
      const inProgress = started.json<SessionBody>();
      expect(inProgress.startedAt).not.toBeNull();
      const stale = await patch(scA, `/v1/test-sessions/${session.id}`, {
        version: session.version,
        notes: 'Viento fuerte',
      });
      expect(stale.statusCode).toBe(409);
      // The location had a value: changing it is a correction and needs a reason.
      const noReason = await patch(scA, `/v1/test-sessions/${session.id}`, {
        version: inProgress.version,
        location: 'Cancha 1',
      });
      expect(noReason.statusCode).toBe(400);
      expect(errorOf(noReason).details?.[0]?.path).toEqual(['body', 'changeReason']);
      const withReason = await patch(scA, `/v1/test-sessions/${session.id}`, {
        version: inProgress.version,
        location: 'Cancha 1',
        changeReason: 'Se cambió de cancha por lluvia',
      });
      expect(withReason.statusCode, withReason.body).toBe(200);
      session = withReason.json<SessionBody>();
    });
  });

  describe('results', () => {
    let cmj: ResultBody;

    it('computes the CMJ height from the flight times and keeps the best', async () => {
      const response = await post(scA, '/v1/test-results', {
        clientUuid: randomUUID(),
        status: 'done',
        playerId: players.p15,
        testDefinitionId: definitions.cmj,
        testSessionId: session.id,
        method: 'video',
        entries: [
          { kind: 'cmj_flight_time', attemptNumber: 1, flightTimeS: 0.5 },
          { kind: 'cmj_flight_time', attemptNumber: 2, flightTimeS: 0.52 },
          {
            kind: 'cmj_video_frames',
            attemptNumber: 3,
            takeoffFrame: 10,
            landingFrame: 130,
            frameRateFps: 240,
          },
        ],
      });
      expect(response.statusCode, response.body).toBe(201);
      cmj = response.json<ResultBody>();
      expect(cmj).toMatchObject({
        testCode: 'cmj',
        protocolVersion: 1,
        status: 'done',
        method: 'video',
        evaluatorId: scA.userId,
        conditions: { surface: 'césped natural' },
      });
      expect(cmj.entries).toHaveLength(3);
      expect(cmj.entries[0]?.inputs).toEqual({ kind: 'cmj_flight_time', flightTimeS: 0.5 });
      expect(cmj.entries[0]?.values[0]?.computed).toBe(true);
      expect(scoreOf(cmj, 'cmj_height_cm')).toBeCloseTo((9.81 * 0.52 * 0.52 * 100) / 8, 6);
      expect(cmj.scores[0]?.aggregation).toBe('best');
    });

    it('computes the sprint Vmax per attempt', async () => {
      const response = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p15,
        testDefinitionId: definitions.sprint_40,
        testSessionId: session.id,
        method: 'photocell',
        entries: [
          { kind: 'sprint_splits', attemptNumber: 1, split10S: 1.95, split20S: 3.3, split40S: 5.9 },
          {
            kind: 'sprint_splits',
            attemptNumber: 2,
            split10S: 1.9,
            split20S: 3.25,
            split40S: 5.75,
          },
        ],
      });
      expect(response.statusCode, response.body).toBe(201);
      const sprint = response.json<ResultBody>();
      expect(scoreOf(sprint, 'sprint_40_s')).toBe(5.75);
      expect(scoreOf(sprint, 'sprint_10_s')).toBe(1.9);
      expect(scoreOf(sprint, 'sprint_vmax_ms')).toBeCloseTo(20 / 2.5, 10);
      // Derived metrics are never typed in.
      const typed = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p15,
        testDefinitionId: definitions.sprint_40,
        method: 'photocell',
        measuredOn: '2026-03-02',
        entries: [{ kind: 'value', metricCode: 'sprint_vmax_ms', value: 9 }],
      });
      expect(typed.statusCode).toBe(400);
      expect(errorOf(typed).details?.[0]?.path).toEqual(['body', 'entries', 0, 'metricCode']);
    });

    it('estimates the 1RM of an M15 with protocol warnings and relative strength', async () => {
      const base = {
        status: 'done',
        playerId: players.p15,
        testDefinitionId: definitions.strength,
        testSessionId: session.id,
        method: 'manual',
      };
      const noExercise = await post(scA, '/v1/test-results', {
        ...base,
        entries: [{ kind: 'strength_set', loadKg: 60, reps: 5, rir: 2 }],
      });
      expect(noExercise.statusCode).toBe(400);
      const response = await post(scA, '/v1/test-results', {
        ...base,
        exercise: 'trap_bar_deadlift',
        entries: [
          { kind: 'strength_set', attemptNumber: 1, loadKg: 60, reps: 5, rir: 2 },
          { kind: 'strength_set', attemptNumber: 2, loadKg: 70, reps: 3, rir: 0 },
        ],
      });
      expect(response.statusCode, response.body).toBe(201);
      const strength = response.json<ResultBody>();
      expect(strength.entries[0]?.issues).toEqual([]);
      expect(strength.entries[1]?.issues).toEqual(['rir_below_protocol']);
      // Best of 60 kg × (1 + 7/30) = 74 and 70 kg × (1 + 3/30) = 77.
      expect(scoreOf(strength, 'e1rm_kg')).toBeCloseTo(77, 10);
      expect(scoreOf(strength, 'relative_strength_kg_kg')).toBeCloseTo(77 / 60, 10);
      expect(strength.entries.some((e) => e.kind === 'derived')).toBe(true);

      // A direct 1RM is not for the development stage.
      const direct = await post(scA, '/v1/test-results', {
        ...base,
        exercise: 'bench_press',
        entries: [{ kind: 'value', metricCode: 'rm1_kg', value: 80 }],
      });
      expect(direct.statusCode).toBe(400);
    });

    it('applies the stage rules of the battery', async () => {
      // M13: technique reps only, never an estimated 1RM.
      const e1rm = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p13,
        testDefinitionId: definitions.strength,
        measuredOn: '2026-03-02',
        method: 'manual',
        exercise: 'goblet_squat',
        entries: [{ kind: 'strength_set', loadKg: 20, reps: 5, rir: 3 }],
      });
      expect(e1rm.statusCode).toBe(400);
      const pushups = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p13,
        testDefinitionId: definitions.strength,
        measuredOn: '2026-03-02',
        method: 'manual',
        exercise: 'push_up',
        entries: [
          { kind: 'value', metricCode: 'pushups_n', value: 18 },
          { kind: 'value', metricCode: 'technique_score', value: 2 },
        ],
      });
      expect(pushups.statusCode, pushups.body).toBe(201);
      // The Bronco is only in the battery of the performance stage.
      const bronco = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p15,
        testDefinitionId: definitions.bronco,
        testSessionId: session.id,
        method: 'manual',
        entries: [{ kind: 'value', metricCode: 'bronco_time_s', value: 300 }],
      });
      expect(bronco.statusCode).toBe(400);
      expect(errorOf(bronco).details?.[0]).toMatchObject({
        path: ['body', 'status'],
        code: 'not_in_battery',
      });
      const notApplicable = await post(scA, '/v1/test-results', {
        status: 'not_done',
        playerId: players.p15,
        testDefinitionId: definitions.bronco,
        testSessionId: session.id,
        notDoneReason: 'not_applicable_to_stage',
      });
      expect(notApplicable.statusCode, notApplicable.body).toBe(201);
    });

    it('checks the role, the assignment and the data consent', async () => {
      const payload = (playerId: string) => ({
        status: 'not_done',
        playerId,
        testDefinitionId: definitions.cmj,
        testSessionId: session.id,
        notDoneReason: 'absent',
      });
      expect((await post(coachA, '/v1/test-results', payload(players.p15))).statusCode).toBe(403);
      expect((await post(playerUser, '/v1/test-results', payload(players.p15))).statusCode).toBe(
        403,
      );
      expect((await post(scA, '/v1/test-results', payload(players.p15NoConsent))).statusCode).toBe(
        403,
      );
      // The sc of M17 does not see the M15 player.
      const outOfScope = await post(scM17, '/v1/test-results', payload(players.p15));
      expect(outOfScope.statusCode).toBe(400);
      expect(errorOf(outOfScope).details?.[0]?.path).toEqual(['body', 'playerId']);
      expect((await get(adminB, `/v1/test-results/${cmj.id}`)).statusCode).toBe(404);
      expect((await get(scM17, `/v1/test-results/${cmj.id}`)).statusCode).toBe(404);
    });

    it('shows injured as unavailable to everyone but the medical staff', async () => {
      const created = await post(scA, '/v1/test-results', {
        status: 'not_done',
        playerId: players.p15,
        testDefinitionId: definitions.cod_505,
        testSessionId: session.id,
        notDoneReason: 'injured',
        notDoneNote: 'Esguince de tobillo',
      });
      expect(created.statusCode, created.body).toBe(201);
      const forSc = created.json<ResultBody>();
      expect(forSc.notDoneReason).toBe('unavailable');
      expect(forSc.notDoneNote).toBeNull();
      const forCoach = await get(coachA, `/v1/test-results/${forSc.id}`);
      expect(forCoach.json<ResultBody>().notDoneReason).toBe('unavailable');
      const forPlayer = await get(playerUser, `/v1/test-results/${forSc.id}`);
      expect(forPlayer.statusCode).toBe(200);
      expect(forPlayer.json<ResultBody>().notDoneReason).toBe('unavailable');
      const forMedical = await get(medicalA, `/v1/test-results/${forSc.id}`);
      expect(forMedical.json<ResultBody>()).toMatchObject({
        notDoneReason: 'injured',
        notDoneNote: 'Esguince de tobillo',
      });
    });

    it('voids entries with a reason, recalculating the derived asymmetry', async () => {
      const response = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p15,
        testDefinitionId: definitions.cod_505,
        measuredOn: '2026-03-03',
        method: 'photocell',
        entries: [
          { kind: 'value', attemptNumber: 1, metricCode: 'cod505_right_s', value: 2.4 },
          { kind: 'value', attemptNumber: 1, metricCode: 'cod505_left_s', value: 2.5 },
          { kind: 'value', attemptNumber: 2, metricCode: 'cod505_left_s', value: 2.3 },
        ],
      });
      expect(response.statusCode, response.body).toBe(201);
      const cod = response.json<ResultBody>();
      expect(scoreOf(cod, 'cod505_asymmetry_pct')).toBeCloseTo((0.1 / 2.3) * 100, 10);
      const typo = cod.entries.find((e) => e.values[0]?.value === 2.3);
      const derived = cod.entries.find((e) => e.kind === 'derived');

      const noReason = await post(scA, `/v1/test-results/${cod.id}/void`, {
        entryIds: [typo?.id],
      });
      expect(noReason.statusCode).toBe(400);
      const voidDerived = await post(scA, `/v1/test-results/${cod.id}/void`, {
        entryIds: [derived?.id],
        reason: 'No corresponde',
      });
      expect(voidDerived.statusCode).toBe(400);
      expect(
        (
          await post(coachA, `/v1/test-results/${cod.id}/void`, {
            entryIds: [typo?.id],
            reason: 'Mal cargado',
          })
        ).statusCode,
      ).toBe(403);

      const voided = await post(scA, `/v1/test-results/${cod.id}/void`, {
        entryIds: [typo?.id],
        reason: 'Se tipeó mal el tiempo',
      });
      expect(voided.statusCode, voided.body).toBe(200);
      const after = voided.json<ResultBody>();
      expect(after.entries.find((e) => e.id === typo?.id)?.voided?.reason).toBe(
        'Se tipeó mal el tiempo',
      );
      expect(scoreOf(after, 'cod505_left_s')).toBe(2.5);
      expect(scoreOf(after, 'cod505_asymmetry_pct')).toBeCloseTo((0.1 / 2.4) * 100, 10);
      // Idempotent.
      const again = await post(scA, `/v1/test-results/${cod.id}/void`, {
        entryIds: [typo?.id],
        reason: 'Se tipeó mal el tiempo',
      });
      expect(again.statusCode).toBe(200);
      // The void is in the change history with its reason (the recalculated asymmetry too).
      const history = await database.admin.query<{ reason: string }>(
        `select reason from change_history where table_name = 'test_result_value' and club_id = $1
          and record_id = $2`,
        [clubA, typo?.values[0]?.id],
      );
      expect(history.rows).toEqual([{ reason: 'Se tipeó mal el tiempo' }]);
      // The derived values (the first and the recalculated one) name their inputs in the
      // canonical order, the same as an import (issue #175).
      const derivedInputs = await database.admin.query<{ inputs: unknown }>(
        `select inputs from test_result_value where club_id = $1 and test_result_id = $2
            and inputs ->> 'kind' = 'derived' order by created_at, id`,
        [clubA, cod.id],
      );
      expect(derivedInputs.rows.map((r) => r.inputs)).toEqual([
        { kind: 'derived', from: ['cod505_left_s', 'cod505_right_s'] },
        { kind: 'derived', from: ['cod505_left_s', 'cod505_right_s'] },
      ]);
    });

    it('appends entries idempotently by their clientUuid', async () => {
      const entry = {
        kind: 'cmj_flight_time',
        clientUuid: randomUUID(),
        attemptNumber: 4,
        flightTimeS: 0.55,
      };
      const first = await post(scA, `/v1/test-results/${cmj.id}/entries`, { entries: [entry] });
      expect(first.statusCode, first.body).toBe(200);
      const second = await post(scA, `/v1/test-results/${cmj.id}/entries`, { entries: [entry] });
      expect(second.statusCode).toBe(200);
      const result = second.json<ResultBody>();
      expect(result.entries.filter((e) => e.id === entry.clientUuid)).toHaveLength(1);
      expect(result.entries).toHaveLength(4);
      expect(scoreOf(result, 'cmj_height_cm')).toBeCloseTo((9.81 * 0.55 * 0.55 * 100) / 8, 6);
      cmj = result;
    });

    it('corrects a result with its version and a reason', async () => {
      const noReason = await patch(scA, `/v1/test-results/${cmj.id}`, {
        version: cmj.version,
        method: 'app',
      });
      expect(noReason.statusCode).toBe(400);
      const corrected = await patch(scA, `/v1/test-results/${cmj.id}`, {
        version: cmj.version,
        method: 'app',
        changeReason: 'Se midió con la app, no con video',
      });
      expect(corrected.statusCode, corrected.body).toBe(200);
      expect(corrected.json<ResultBody>().method).toBe('app');
      const stale = await patch(scA, `/v1/test-results/${cmj.id}`, {
        version: cmj.version,
        notes: 'Buen salto',
      });
      expect(stale.statusCode).toBe(409);
      const toNotDone = await patch(scA, `/v1/test-results/${cmj.id}`, {
        version: corrected.json<ResultBody>().version,
        status: 'not_done',
        notDoneReason: 'absent',
        changeReason: 'No vino',
      });
      expect(toNotDone.statusCode).toBe(409);
      cmj = corrected.json<ResultBody>();
    });

    it('lists results by scope: the player sees only their own', async () => {
      const ids = async (caller: SignedIn, query = '') =>
        (await get(caller, `/v1/test-results${query}`)).json<Page<ResultBody>>().items;
      const own = await ids(playerUser);
      expect(own.length).toBeGreaterThan(0);
      expect(new Set(own.map((r) => r.playerId))).toEqual(new Set([players.p15]));
      expect((await ids(scA, '?testCode=strength')).map((r) => r.playerId).sort()).toEqual(
        [players.p15, players.p13].sort(),
      );
      expect(await ids(scM17)).toEqual([]);
      expect(await ids(adminB)).toEqual([]);
      const first = await get(adminA, '/v1/test-results?limit=2');
      const page = first.json<Page<ResultBody>>();
      expect(page.items).toHaveLength(2);
      const next = await get(adminA, `/v1/test-results?limit=2&cursor=${page.nextCursor ?? ''}`);
      expect(next.statusCode).toBe(200);
      expect(next.json<Page<ResultBody>>().items.map((r) => r.id)).not.toContain(page.items[0]?.id);
    });
  });

  describe('batch of a test day', () => {
    const p13Uuid = randomUUID();
    const p15Uuid = randomUUID();
    const batch = (p15Entries: unknown[]) => ({
      results: [
        {
          clientUuid: p13Uuid,
          status: 'done',
          playerId: players.p13,
          testDefinitionId: definitions.ift_3015,
          method: 'manual',
          entries: [{ kind: 'ift_stage', lastCompletedStage: 13 }],
        },
        {
          clientUuid: p15Uuid,
          status: 'done',
          playerId: players.p15,
          testDefinitionId: definitions.ift_3015,
          method: 'manual',
          entries: p15Entries,
        },
        {
          status: 'not_done',
          playerId: players.p13,
          testDefinitionId: definitions.ift_3015,
          notDoneReason: 'other',
        },
      ],
    });

    it('reports every invalid result and writes nothing', async () => {
      const before = await database.admin.query<{ n: string }>(
        'select count(*) as n from test_result where club_id = $1',
        [clubA],
      );
      const response = await post(scA, `/v1/test-sessions/${session.id}/results`, {
        results: batch([{ kind: 'ift_stage', lastCompletedStage: 0 }]).results.slice(0, 2),
      });
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).details?.map((d) => d.path.slice(0, 3))).toEqual([
        ['body', 'results', 1],
      ]);
      const missingNote = await post(scA, `/v1/test-sessions/${session.id}/results`, {
        results: [
          batch([]).results[0],
          batch([]).results[2],
          { ...batch([]).results[2], notDoneReason: 'absent' },
        ].map((r) => JSON.parse(JSON.stringify(r)) as unknown),
      });
      expect(missingNote.statusCode).toBe(400);
      expect(errorOf(missingNote).details?.map((d) => d.path)).toEqual([
        ['body', 'results', 1, 'notDoneNote'],
      ]);
      const after = await database.admin.query<{ n: string }>(
        'select count(*) as n from test_result where club_id = $1',
        [clubA],
      );
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    });

    it('records the whole batch and replays it by clientUuid', async () => {
      const payload = {
        results: batch([{ kind: 'ift_stage', lastCompletedStage: 17 }]).results.slice(0, 2),
      };
      const first = await post(scA, `/v1/test-sessions/${session.id}/results`, payload);
      expect(first.statusCode, first.body).toBe(201);
      const body = first.json<{ results: { result: ResultBody; replayed: boolean }[] }>();
      expect(body.results.map((r) => r.replayed)).toEqual([false, false]);
      const [p13Result, p15Result] = body.results.map((r) => r.result);
      expect(p13Result && scoreOf(p13Result, 'vift_kmh')).toBe(14);
      expect(p15Result && scoreOf(p15Result, 'vift_kmh')).toBe(16);
      const again = await post(scA, `/v1/test-sessions/${session.id}/results`, payload);
      expect(again.statusCode).toBe(201);
      const replayed = again.json<{ results: { result: ResultBody; replayed: boolean }[] }>();
      expect(replayed.results.map((r) => r.replayed)).toEqual([true, true]);
      expect(replayed.results.map((r) => r.result.id)).toEqual(
        body.results.map((r) => r.result.id),
      );
      expect(
        (await post(coachA, `/v1/test-sessions/${session.id}/results`, payload)).statusCode,
      ).toBe(403);
    });
  });

  describe('series of a metric', () => {
    it('warns when the methods of the compared results differ', async () => {
      const url = `/v1/players/${players.p15}/test-metrics/cmj_height_cm`;
      const single = await get(scA, url);
      expect(single.statusCode, single.body).toBe(200);
      const series = single.json<
        Page<{ value: number; method: string }> & {
          comparison: { methods: string[]; warnings: string[] };
        }
      >();
      expect(series.items).toHaveLength(1);
      expect(series.comparison).toMatchObject({ methods: ['app'], warnings: [] });

      const other = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p15,
        testDefinitionId: definitions.cmj,
        measuredOn: '2026-04-10',
        method: 'manual',
        entries: [{ kind: 'value', metricCode: 'cmj_height_cm', value: 30 }],
      });
      expect(other.statusCode, other.body).toBe(201);
      const mixed = (await get(scA, `${url}?limit=1`)).json<
        Page<{ measuredOn: string }> & {
          comparison: { methods: string[]; warnings: string[] };
        }
      >();
      expect(mixed.items.map((p) => p.measuredOn)).toEqual(['2026-03-02']);
      expect(mixed.nextCursor).not.toBeNull();
      // The comparison covers the whole range, not only the page.
      expect(mixed.comparison).toMatchObject({
        methods: ['app', 'manual'],
        warnings: ['mixed_methods'],
      });
      const oneMethod = (await get(scA, `${url}?method=manual`)).json<{
        comparison: { warnings: string[] };
      }>();
      expect(oneMethod.comparison.warnings).toEqual([]);
      expect((await get(playerUser, url)).statusCode).toBe(200);
      expect((await get(scM17, url)).statusCode).toBe(404);
      expect((await get(adminB, url)).statusCode).toBe(404);
    });

    it('shows the exercise of each strength point and warns when exercises are mixed', async () => {
      const url = `/v1/players/${players.p15}/test-metrics/e1rm_kg`;
      interface StrengthSeries {
        items: { value: number; exercise: string | null }[];
        comparison: { exercises: (string | null)[]; warnings: string[] };
      }
      const single = (await get(scA, url)).json<StrengthSeries>();
      expect(single.items.map((p) => p.exercise)).toEqual(['trap_bar_deadlift']);
      expect(single.comparison).toMatchObject({ exercises: ['trap_bar_deadlift'], warnings: [] });

      const bench = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p15,
        testDefinitionId: definitions.strength,
        measuredOn: '2026-03-20',
        method: 'manual',
        exercise: 'bench_press',
        entries: [{ kind: 'strength_set', attemptNumber: 1, loadKg: 40, reps: 5, rir: 2 }],
      });
      expect(bench.statusCode, bench.body).toBe(201);
      const mixed = await get(scA, url);
      expect(mixed.statusCode, mixed.body).toBe(200);
      const series = mixed.json<StrengthSeries>();
      expect(series.items.map((p) => p.exercise)).toEqual(['trap_bar_deadlift', 'bench_press']);
      expect([...series.comparison.exercises].sort()).toEqual(['bench_press', 'trap_bar_deadlift']);
      expect(series.comparison.warnings).toEqual(['mixed_exercises']);

      const oneExercise = (await get(scA, `${url}?exercise=bench_press`)).json<StrengthSeries>();
      expect(oneExercise.items).toHaveLength(1);
      expect(oneExercise.items[0]?.value).toBeCloseTo(40 * (1 + 7 / 30), 10);
      expect(oneExercise.comparison).toMatchObject({ exercises: ['bench_press'], warnings: [] });
    });
  });

  describe('entry and correction rules', () => {
    const cmjValue = (value: number) => ({ kind: 'value', metricCode: 'cmj_height_cm', value });

    it('rejects a second value of a metric without attempt number', async () => {
      const twice = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p15,
        testDefinitionId: definitions.cmj,
        measuredOn: '2026-04-20',
        method: 'manual',
        entries: [cmjValue(30), cmjValue(31)],
      });
      expect(twice.statusCode, twice.body).toBe(400);
      expect(errorOf(twice).details?.map((d) => d.path)).toEqual([
        ['body', 'entries', 1, 'attemptNumber'],
      ]);

      // In a batch the issue joins the others instead of aborting the transaction.
      const batch = await post(scA, `/v1/test-sessions/${session.id}/results`, {
        results: [
          {
            status: 'done',
            playerId: players.p15,
            testDefinitionId: definitions.cmj,
            method: 'manual',
            entries: [cmjValue(30), cmjValue(31)],
          },
          {
            status: 'done',
            playerId: players.p13,
            testDefinitionId: definitions.cmj,
            method: 'manual',
            entries: [{ kind: 'value', metricCode: 'sprint_vmax_ms', value: 9 }],
          },
        ],
      });
      expect(batch.statusCode, batch.body).toBe(400);
      expect(errorOf(batch).details?.map((d) => d.path)).toEqual([
        ['body', 'results', 0, 'entries', 1, 'attemptNumber'],
        ['body', 'results', 1, 'entries', 0, 'metricCode'],
      ]);

      // Against a stored result-level value too.
      const once = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p15,
        testDefinitionId: definitions.cmj,
        measuredOn: '2026-04-21',
        method: 'manual',
        entries: [cmjValue(30)],
      });
      expect(once.statusCode, once.body).toBe(201);
      const again = await post(scA, `/v1/test-results/${once.json<ResultBody>().id}/entries`, {
        entries: [cmjValue(32)],
      });
      expect(again.statusCode, again.body).toBe(400);
      expect(errorOf(again).details?.[0]?.path).toEqual(['body', 'entries', 0, 'attemptNumber']);
    });

    it('rejects an entry none of whose metrics the protocol version keeps', async () => {
      const removed = await database.admin.query<{ row: unknown }>(
        `with d as (
           delete from test_definition_metric tdm using metric_definition m
            where tdm.club_id = $1 and tdm.test_definition_id = $2
              and m.club_id = tdm.club_id and m.id = tdm.metric_definition_id
              and m.code = 'vift_kmh'
           returning tdm.*)
         select row_to_json(d) as row from d`,
        [clubA, definitions.ift_3015],
      );
      expect(removed.rows).toHaveLength(1);
      try {
        const response = await post(scA, '/v1/test-results', {
          status: 'done',
          playerId: players.p13,
          testDefinitionId: definitions.ift_3015,
          measuredOn: '2026-04-22',
          method: 'manual',
          entries: [{ kind: 'ift_stage', lastCompletedStage: 15 }],
        });
        expect(response.statusCode, response.body).toBe(400);
        expect(errorOf(response).details?.[0]?.path).toEqual(['body', 'entries', 0]);
      } finally {
        await database.admin.query(
          `insert into test_definition_metric
           select * from json_populate_record(null::test_definition_metric, $1::json)`,
          [JSON.stringify(removed.rows[0]?.row)],
        );
      }
    });

    it('rejects entries on a result of a cancelled test day', async () => {
      const day = await post(scA, '/v1/test-sessions', {
        categoryId: categories.m15,
        scheduledOn: '2026-03-10',
      });
      expect(day.statusCode, day.body).toBe(201);
      const created = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p15,
        testDefinitionId: definitions.cmj,
        testSessionId: day.json<SessionBody>().id,
        method: 'manual',
        entries: [{ ...cmjValue(30), attemptNumber: 1 }],
      });
      expect(created.statusCode, created.body).toBe(201);
      // Suspending a day is the calendar's `…/cancel` (B-317).
      const cancelled = await t.app.inject({
        method: 'POST',
        url: `/v1/test-sessions/${day.json<SessionBody>().id}/cancel`,
        headers: scA.headers,
      });
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      const url = `/v1/test-results/${created.json<ResultBody>().id}/entries`;
      const response = await post(scA, url, { entries: [{ ...cmjValue(31), attemptNumber: 2 }] });
      expect(response.statusCode, response.body).toBe(409);
    });

    it('never drops an entry whose clientUuid belongs to another result', async () => {
      const own = await post(scM17, '/v1/test-results', {
        status: 'done',
        playerId: players.p17,
        testDefinitionId: definitions.cmj,
        measuredOn: '2026-03-02',
        method: 'manual',
        entries: [{ ...cmjValue(35), attemptNumber: 1 }],
      });
      expect(own.statusCode, own.body).toBe(201);
      // An entry of an M15 result, which the sc of M17 cannot see.
      const foreign = (await get(scA, '/v1/test-results?testCode=cmj&playerId=' + players.p15))
        .json<Page<ResultBody>>()
        .items.flatMap((r) => r.entries)[0]?.id;
      expect(foreign).toBeDefined();
      const url = `/v1/test-results/${own.json<ResultBody>().id}/entries`;
      const response = await post(scM17, url, {
        entries: [{ ...cmjValue(36), clientUuid: foreign, attemptNumber: 2 }],
      });
      expect(response.statusCode, response.body).toBe(409);
      const after = (
        await get(scM17, `/v1/test-results/${own.json<ResultBody>().id}`)
      ).json<ResultBody>();
      expect(after.entries).toHaveLength(1);
    });

    it('applies the done rules when a result becomes done or changes day', async () => {
      const notDone = async (testDefinitionId: string | undefined) => {
        const response = await post(scA, '/v1/test-results', {
          status: 'not_done',
          playerId: players.p15,
          testDefinitionId,
          measuredOn: '2026-05-04',
          notDoneReason: 'absent',
        });
        expect(response.statusCode, response.body).toBe(201);
        return response.json<ResultBody>();
      };
      const strength = await notDone(definitions.strength);
      const noExercise = await patch(scA, `/v1/test-results/${strength.id}`, {
        version: strength.version,
        status: 'done',
        method: 'manual',
        changeReason: 'Vino más tarde',
      });
      expect(noExercise.statusCode, noExercise.body).toBe(400);
      expect(errorOf(noExercise).details?.map((d) => d.path)).toEqual([['body', 'exercise']]);

      const reaction = await notDone(definitions.reaction);
      const noDevice = await patch(scA, `/v1/test-results/${reaction.id}`, {
        version: reaction.version,
        status: 'done',
        method: 'app',
        changeReason: 'Vino más tarde',
      });
      expect(noDevice.statusCode, noDevice.body).toBe(400);
      expect(errorOf(noDevice).details?.map((d) => d.path)).toEqual([['body', 'deviceId']]);

      // An estimated 1RM moved to a day when the player is pinned to the foundation stage.
      const e1rm = await post(scA, '/v1/test-results', {
        status: 'done',
        playerId: players.p15,
        testDefinitionId: definitions.strength,
        measuredOn: '2026-05-20',
        method: 'manual',
        exercise: 'goblet_squat',
        entries: [{ kind: 'strength_set', attemptNumber: 1, loadKg: 30, reps: 5, rir: 2 }],
      });
      expect(e1rm.statusCode, e1rm.body).toBe(201);
      await database.admin.query(
        `insert into player_stage (club_id, player_id, stage, basis, reason, valid_from, valid_to)
         values ($1, $2, 'foundation', 'manual', 'pinned', '2026-06-01', '2026-07-01')`,
        [clubA, players.p15],
      );
      const moved = await patch(scA, `/v1/test-results/${e1rm.json<ResultBody>().id}`, {
        version: e1rm.json<ResultBody>().version,
        measuredOn: '2026-06-10',
        changeReason: 'Fecha mal cargada',
      });
      expect(moved.statusCode, moved.body).toBe(400);
      expect(errorOf(moved).details?.map((d) => d.path)).toEqual([['body', 'measuredOn']]);
    });
  });
});
