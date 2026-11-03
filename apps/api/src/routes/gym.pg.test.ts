/**
 * Gym end to end (B-607, ADR 0075) against Postgres 16, through the real
 * connection roles: programs by stage (M13/M14 without loads, M15/M16 never
 * to failure), sets logged by the player and the S&C staff with the e1RM
 * of the club's strength protocol, corrections with a reason in the change
 * history, voids instead of deletes, the permission matrix and the offline
 * sync of sets and programs.
 */
import { randomUUID } from 'node:crypto';
import { formatHlc, type ClubId } from '@sport-performance/domain';
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
} from '../testing/identity.js';
import { describeWithPostgres } from '../testing/support.js';

interface Envelope {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface ProgramBody {
  id: string;
  name: string;
  categoryId: string | null;
  playerId: string | null;
  stage: string | null;
  archivedAt: string | null;
  version: string;
}

interface SetBody {
  id: string;
  playerId: string;
  exerciseCode: string;
  loadKind: string;
  reps: number | null;
  loadKg: number | null;
  rir: number | null;
  techniqueScore: number | null;
  strengthAssessment: string | null;
  e1rmKg: number | null;
  warnings: string[];
  voidedAt: string | null;
  version: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Alta de clubes para las pruebas de gimnasio');

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

function paths(response: LightMyRequestResponse): string[] {
  return (errorOf(response).details ?? []).map((d) => d.path.join('.'));
}

const trapBar = (overrides: Record<string, unknown> = {}) => ({
  exerciseCode: 'trap_bar_deadlift',
  name: null,
  loadKind: 'external',
  measure: 'reps',
  sets: 3,
  repsMin: 3,
  repsMax: 5,
  durationS: null,
  targetRir: 2,
  loadKg: 60,
  restS: 120,
  notes: null,
  ...overrides,
});

const pushUps = {
  exerciseCode: 'push_up',
  name: null,
  loadKind: 'bodyweight',
  measure: 'reps',
  sets: 3,
  repsMin: 8,
  repsMax: 12,
  durationS: null,
  targetRir: null,
  loadKg: null,
  restS: 60,
  notes: null,
};

const plan = (...exercises: unknown[]) => ({ days: [{ key: 'a', name: 'Día A', exercises }] });

describeWithPostgres('gym (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let scM15: SignedIn;
  let coachM15: SignedIn;
  let coachM13: SignedIn;
  let player15: SignedIn;
  let player13: SignedIn;
  let playerNoConsent: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  const categories: Record<string, string> = {};
  let p15: string;
  let p13: string;
  let today: string;
  let m15Program: ProgramBody;

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

  function send(caller: SignedIn, method: 'POST' | 'PATCH', url: string, payload: unknown) {
    return t.app.inject({
      method,
      url,
      headers: caller.headers,
      payload: payload as Record<string, unknown>,
    });
  }

  function get(caller: SignedIn, url: string) {
    return t.app.inject({ url, headers: caller.headers });
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
    adminA = await signIn(t, 'admin@gym-a.example.com');
    adminB = await signIn(t, 'admin@gym-b.example.com');
    scM15 = await signIn(t, 'sc15@gym-a.example.com');
    coachM15 = await signIn(t, 'coach15@gym-a.example.com');
    coachM13 = await signIn(t, 'coach13@gym-a.example.com');
    player15 = await signIn(t, 'player15@gym-a.example.com');
    player13 = await signIn(t, 'player13@gym-a.example.com');
    playerNoConsent = await signIn(t, 'player-nc@gym-a.example.com');

    clubA = await createClub('gym-a');
    clubB = await createClub('gym-b');
    const rows = await database.admin.query<{ id: string; age_band_code: string }>(
      'select id, age_band_code from category where club_id = $1',
      [clubA],
    );
    for (const row of rows.rows) categories[row.age_band_code] = row.id;
    const day = await database.admin.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [clubA],
    );
    today = day.rows[0]?.today ?? '';

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    await assign(
      await createMembership(database.admin, scM15.userId, clubA, 'sc'),
      categories.m15 ?? '',
    );
    await assign(
      await createMembership(database.admin, coachM15.userId, clubA, 'coach'),
      categories.m15 ?? '',
    );
    await assign(
      await createMembership(database.admin, coachM13.userId, clubA, 'coach'),
      categories.m13 ?? '',
    );
    for (const user of [player15, player13, playerNoConsent]) {
      await createMembership(database.admin, user.userId, clubA, 'player');
    }
    p15 = await insertPlayer(clubA, categories.m15 ?? '', '2011-05-01', {
      userId: player15.userId,
    });
    p13 = await insertPlayer(clubA, categories.m13 ?? '', '2013-05-01', {
      userId: player13.userId,
    });
    await insertPlayer(clubA, categories.m15 ?? '', '2011-07-01', {
      userId: playerNoConsent.userId,
      consent: false,
    });
    // A body mass for the added load of a weighted pull-up.
    await database.admin.query(
      `insert into anthro_measurement (club_id, player_id, measured_on, height_cm, weight_kg, method)
       values ($1, $2, '2026-01-10', 170, 64, 'manual')`,
      [clubA, p15],
    );
  }, 240_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('programs', () => {
    it('lets the S&C staff create a program for their category, never to failure in M15/M16', async () => {
      const toFailure = await send(scM15, 'POST', '/v1/gym-programs', {
        name: 'Fuerza M15',
        categoryId: categories.m15,
        plan: plan(trapBar({ targetRir: 0 }), pushUps),
        validFrom: '2026-01-01',
      });
      expect(toFailure.statusCode, toFailure.body).toBe(400);
      expect(paths(toFailure)).toEqual(['body.plan.days.0.exercises.0.targetRir']);

      const clientUuid = randomUUID();
      const created = await send(scM15, 'POST', '/v1/gym-programs', {
        clientUuid,
        name: 'Fuerza M15',
        categoryId: categories.m15,
        plan: plan(trapBar(), pushUps),
        validFrom: '2026-01-01',
      });
      expect(created.statusCode, created.body).toBe(201);
      m15Program = created.json<ProgramBody>();
      expect(m15Program).toMatchObject({ categoryId: categories.m15, playerId: null, stage: null });

      const replay = await send(scM15, 'POST', '/v1/gym-programs', {
        clientUuid,
        name: 'Fuerza M15',
        categoryId: categories.m15,
        plan: plan(trapBar(), pushUps),
        validFrom: '2026-01-01',
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<ProgramBody>().id).toBe(m15Program.id);
    });

    it('keeps M13/M14 on the body or a stick', async () => {
      const loaded = await send(adminA, 'POST', '/v1/gym-programs', {
        name: 'Técnica M13',
        categoryId: categories.m13,
        plan: plan(trapBar()),
        validFrom: '2026-01-01',
      });
      expect(loaded.statusCode, loaded.body).toBe(400);
      expect(paths(loaded)).toEqual(['body.plan.days.0.exercises.0.loadKind']);
      const ok = await send(adminA, 'POST', '/v1/gym-programs', {
        name: 'Técnica M13',
        categoryId: categories.m13,
        plan: plan(pushUps),
        validFrom: '2026-01-01',
      });
      expect(ok.statusCode, ok.body).toBe(201);
    });

    it('refuses a program with no target or two, and the S&C staff outside their categories', async () => {
      const both = await send(adminA, 'POST', '/v1/gym-programs', {
        name: 'Doble',
        categoryId: categories.m15,
        playerId: p15,
        plan: plan(pushUps),
        validFrom: '2026-01-01',
      });
      expect(both.statusCode).toBe(400);
      const outside = await send(scM15, 'POST', '/v1/gym-programs', {
        name: 'Ajeno',
        categoryId: categories.m13,
        plan: plan(pushUps),
        validFrom: '2026-01-01',
      });
      expect(outside.statusCode).toBe(403);
      const coach = await send(coachM15, 'POST', '/v1/gym-programs', {
        name: 'Del coach',
        categoryId: categories.m15,
        plan: plan(pushUps),
        validFrom: '2026-01-01',
      });
      expect(coach.statusCode).toBe(403);
    });

    it('lists by scope: the coach their categories, the player what applies to them', async () => {
      const coach15 = await get(coachM15, '/v1/gym-programs');
      expect(coach15.json<Page<ProgramBody>>().items.map((p) => p.name)).toEqual(['Fuerza M15']);
      const coach13 = await get(coachM13, '/v1/gym-programs');
      expect(coach13.json<Page<ProgramBody>>().items.map((p) => p.name)).toEqual(['Técnica M13']);
      const mine = await get(player15, '/v1/gym-programs');
      expect(mine.json<Page<ProgramBody>>().items.map((p) => p.id)).toEqual([m15Program.id]);
      const other = await get(player13, `/v1/gym-programs/${m15Program.id}`);
      expect(other.statusCode).toBe(404);
      const clubB = await get(adminB, `/v1/gym-programs/${m15Program.id}`);
      expect(clubB.statusCode).toBe(404);
    });

    it('answers the programs in force for a player, with the stage and the e1RM protocol', async () => {
      const response = await get(player15, `/v1/players/${p15}/gym-programs`);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({
        playerId: p15,
        on: today,
        stage: 'development',
        strengthAssessment: 'estimated_rm',
        e1rmProtocol: { minReps: 3, maxReps: 5, minRir: 2 },
        programs: [{ id: m15Program.id }],
      });
    });

    it('edits at a version and archives instead of deleting', async () => {
      const stale = await send(scM15, 'PATCH', `/v1/gym-programs/${m15Program.id}`, {
        version: '1',
        name: 'Fuerza M15 (bloque 2)',
      });
      expect(stale.statusCode).toBe(409);
      const edited = await send(scM15, 'PATCH', `/v1/gym-programs/${m15Program.id}`, {
        version: m15Program.version,
        name: 'Fuerza M15 (bloque 2)',
      });
      expect(edited.statusCode, edited.body).toBe(200);
      m15Program = edited.json<ProgramBody>();
      const archived = await send(scM15, 'POST', `/v1/gym-programs/${m15Program.id}/archive`, {});
      expect(archived.json<ProgramBody>().archivedAt).not.toBeNull();
      expect(
        (await get(player15, `/v1/players/${p15}/gym-programs`)).json<{ programs: unknown[] }>()
          .programs,
      ).toEqual([]);
      const restored = await send(scM15, 'POST', `/v1/gym-programs/${m15Program.id}/restore`, {});
      m15Program = restored.json<ProgramBody>();
      expect(m15Program.archivedAt).toBeNull();
    });
  });

  describe('sets', () => {
    let loggedId: string;

    it('lets the player log their sets, with the e1RM and the warnings of the stage', async () => {
      const response = await send(player15, 'POST', '/v1/gym-sets', {
        gymProgramId: m15Program.id,
        dayKey: 'a',
        sets: [
          {
            clientUuid: randomUUID(),
            exerciseCode: 'trap_bar_deadlift',
            setNumber: 1,
            reps: 5,
            loadKg: 60,
            rir: 2,
          },
          {
            clientUuid: randomUUID(),
            exerciseCode: 'trap_bar_deadlift',
            setNumber: 2,
            reps: 5,
            loadKg: 65,
            rir: 0,
          },
          { clientUuid: randomUUID(), exerciseCode: 'push_up', setNumber: 1, reps: 10 },
          {
            clientUuid: randomUUID(),
            exerciseCode: 'weighted_pull_up',
            setNumber: 1,
            reps: 4,
            loadKg: 6,
            rir: 3,
          },
        ],
      });
      expect(response.statusCode, response.body).toBe(201);
      const items = response.json<{ items: { outcome: string; set: SetBody }[] }>().items;
      expect(items.map((i) => i.outcome)).toEqual(['created', 'created', 'created', 'created']);
      const [first, second, third, fourth] = items.map((i) => i.set);
      // 60 × (1 + 7/30) = 74.
      expect(first).toMatchObject({ strengthAssessment: 'estimated_rm', e1rmKg: 74, warnings: [] });
      // To failure: flagged and outside the protocol (RIR below 2): no e1RM.
      expect(second).toMatchObject({ e1rmKg: null, warnings: ['to_failure'] });
      expect(third).toMatchObject({ loadKind: 'bodyweight', e1rmKg: null });
      // (64 + 6) × (1 + 7/30) = 86.3.
      expect(fourth).toMatchObject({ loadKind: 'bodyweight_plus', e1rmKg: 86.3 });
      loggedId = first?.id ?? '';
    });

    it('replays a set by its clientUuid instead of loading it twice', async () => {
      const clientUuid = randomUUID();
      const payload = {
        sets: [
          { clientUuid, exerciseCode: 'bench_press', setNumber: 1, reps: 4, loadKg: 40, rir: 2 },
        ],
      };
      const first = await send(player15, 'POST', '/v1/gym-sets', payload);
      expect(first.statusCode, first.body).toBe(201);
      const again = await send(player15, 'POST', '/v1/gym-sets', payload);
      expect(again.statusCode).toBe(201);
      expect(again.headers['x-idempotent-replay']).toBe('true');
      expect(again.json<{ items: { outcome: string }[] }>().items[0]?.outcome).toBe('replayed');
      const { rows } = await database.admin.query('select 1 from gym_set where client_uuid = $1', [
        clientUuid,
      ]);
      expect(rows).toHaveLength(1);
    });

    it('checks the sets against the exercise, the stage and who logs them', async () => {
      const noRir = await send(player15, 'POST', '/v1/gym-sets', {
        sets: [{ exerciseCode: 'bench_press', setNumber: 1, reps: 5, loadKg: 40 }],
      });
      expect(noRir.statusCode).toBe(400);
      expect(paths(noRir)).toEqual(['body.sets.0.rir']);
      const technique = await send(player15, 'POST', '/v1/gym-sets', {
        sets: [{ exerciseCode: 'push_up', setNumber: 1, reps: 10, techniqueScore: 3 }],
      });
      expect(paths(technique)).toEqual(['body.sets.0.techniqueScore']);
      const unknown = await send(player15, 'POST', '/v1/gym-sets', {
        sets: [{ exerciseCode: 'sled_push', setNumber: 1, reps: 10 }],
      });
      expect(paths(unknown)).toEqual(['body.sets.0.exerciseCode']);
      const loaded13 = await send(player13, 'POST', '/v1/gym-sets', {
        sets: [{ exerciseCode: 'goblet_squat', setNumber: 1, reps: 8, loadKg: 8, rir: 3 }],
      });
      expect(loaded13.statusCode).toBe(400);
      expect(paths(loaded13)).toEqual(['body.sets.0.exerciseCode']);
      const future = await send(player15, 'POST', '/v1/gym-sets', {
        performedOn: '2999-01-01',
        sets: [{ exerciseCode: 'push_up', setNumber: 1, reps: 10 }],
      });
      expect(paths(future)).toEqual(['body.performedOn']);
    });

    it('lets the S&C staff log with a technique score, not the coach nor without consent', async () => {
      const staff = await send(scM15, 'POST', '/v1/gym-sets', {
        playerId: p15,
        performedOn: '2026-02-02',
        sets: [{ exerciseCode: 'push_up', setNumber: 1, reps: 12, techniqueScore: 2 }],
      });
      expect(staff.statusCode, staff.body).toBe(201);
      const coach = await send(coachM15, 'POST', '/v1/gym-sets', {
        playerId: p15,
        sets: [{ exerciseCode: 'push_up', setNumber: 1, reps: 12 }],
      });
      expect(coach.statusCode).toBe(403);
      const noConsent = await send(playerNoConsent, 'POST', '/v1/gym-sets', {
        sets: [{ exerciseCode: 'push_up', setNumber: 1, reps: 12 }],
      });
      expect(noConsent.statusCode).toBe(403);
      const outside = await send(scM15, 'POST', '/v1/gym-sets', {
        playerId: p13,
        sets: [{ exerciseCode: 'push_up', setNumber: 1, reps: 12 }],
      });
      // A player outside the assignments is not even visible (RLS).
      expect(outside.statusCode).toBe(404);
    });

    it('corrects at a version with a reason in the history', async () => {
      const current = (await get(player15, `/v1/gym-sets/${loggedId}`)).json<SetBody>();
      const corrected = await t.app.inject({
        method: 'PATCH',
        url: `/v1/gym-sets/${loggedId}`,
        headers: { ...player15.headers, 'x-request-id': 'req-gym-correct' },
        payload: { version: current.version, changeReason: 'Eran 62,5 kg', loadKg: 62.5 },
      });
      expect(corrected.statusCode, corrected.body).toBe(200);
      expect(corrected.json<SetBody>()).toMatchObject({ loadKg: 62.5, e1rmKg: 77.1 });
      const stale = await send(player15, 'PATCH', `/v1/gym-sets/${loggedId}`, {
        version: current.version,
        changeReason: 'Otra vez',
        loadKg: 60,
      });
      expect(stale.statusCode).toBe(409);
      const { rows } = await database.admin.query<{ reason: string; request_id: string }>(
        `select reason, request_id from change_history where table_name = 'gym_set' and record_id = $1`,
        [loggedId],
      );
      expect(rows).toEqual([{ reason: 'Eran 62,5 kg', request_id: 'req-gym-correct' }]);
    });

    it('voids a set instead of deleting it: it stops counting for the e1RM', async () => {
      const voided = await send(player15, 'POST', `/v1/gym-sets/${loggedId}/void`, {
        reason: 'Cargada dos veces',
      });
      expect(voided.statusCode, voided.body).toBe(200);
      expect(voided.json<SetBody>()).toMatchObject({ e1rmKg: null });
      expect(voided.json<SetBody>().voidedAt).not.toBeNull();
      const again = await send(player15, 'POST', `/v1/gym-sets/${loggedId}/void`, {
        reason: 'Cargada dos veces',
      });
      expect(again.statusCode).toBe(200);
      const list = await get(player15, `/v1/gym-sets?playerId=${p15}`);
      expect(list.json<Page<SetBody>>().items.map((s) => s.id)).not.toContain(loggedId);
      const withVoided = await get(player15, `/v1/gym-sets?includeVoided=true`);
      expect(withVoided.json<Page<SetBody>>().items.map((s) => s.id)).toContain(loggedId);
    });

    it('lists the sets by scope', async () => {
      const coach15 = await get(coachM15, `/v1/gym-sets?playerId=${p15}`);
      expect(coach15.json<Page<SetBody>>().items.length).toBeGreaterThan(0);
      const coach13 = await get(coachM13, `/v1/gym-sets?playerId=${p15}`);
      expect(coach13.json<Page<SetBody>>().items).toEqual([]);
      const other = await get(player13, `/v1/gym-sets/${loggedId}`);
      expect(other.statusCode).toBe(404);
    });

    it('summarizes the best e1RM per exercise', async () => {
      const response = await get(coachM15, `/v1/players/${p15}/gym-summary`);
      expect(response.statusCode, response.body).toBe(200);
      const exercises = response.json<{
        exercises: { exerciseCode: string; bestE1rmKg: number | null; setsN: number }[];
      }>().exercises;
      const bench = exercises.find((e) => e.exerciseCode === 'bench_press');
      // 40 × (1 + 6/30) = 48.
      expect(bench).toMatchObject({ bestE1rmKg: 48, setsN: 1 });
      // The voided set is gone: only the set to failure is left, without an e1RM.
      expect(exercises.find((e) => e.exerciseCode === 'trap_bar_deadlift')).toMatchObject({
        bestE1rmKg: null,
        setsN: 1,
      });
    });
  });

  describe('offline sync', () => {
    const BASE_MS = Date.now() - 10 * 60_000;
    const hlc = (step: number) =>
      formatHlc({ physicalMs: BASE_MS + step * 1000, counter: 0, node: '0123456789abcdef' });

    async function settled(): Promise<void> {
      const deadline = Date.now() + 30_000;
      for (;;) {
        const { rows } = await database.admin.query<{ done: boolean }>(
          `select coalesce(max(txid) < pg_snapshot_xmin(pg_current_snapshot()), true) as done
             from sync_change`,
        );
        if (rows[0]?.done === true) return;
        if (Date.now() > deadline) throw new Error('the pull horizon did not move');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    async function push(caller: SignedIn, mutations: Record<string, unknown>[]) {
      const response = await send(caller, 'POST', '/v1/sync/push', {
        mutations: mutations.map((m) => ({ mutationId: randomUUID(), ...m })),
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json<{ results: { status: string; error: { code: string } | null }[] }>()
        .results;
    }

    it('logs, corrects and voids sets through the queue', async () => {
      const clientUuid = randomUUID();
      const results = await push(player15, [
        {
          hlc: hlc(1),
          op: 'gym_set.log',
          body: {
            sets: [
              {
                clientUuid,
                exerciseCode: 'goblet_squat',
                setNumber: 1,
                reps: 5,
                loadKg: 20,
                rir: 3,
              },
            ],
          },
        },
        {
          hlc: hlc(2),
          op: 'gym_set.correct',
          target: { clientUuid },
          body: { changeReason: 'Eran 22 kg', loadKg: 22 },
        },
        // A create without its clientUuid is refused alone.
        {
          hlc: hlc(3),
          op: 'gym_set.log',
          body: {
            sets: [{ exerciseCode: 'goblet_squat', setNumber: 2, reps: 5, loadKg: 20, rir: 3 }],
          },
        },
      ]);
      expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'rejected']);
      const { rows } = await database.admin.query<{ id: string; load_kg: number }>(
        'select id, load_kg from gym_set where client_uuid = $1',
        [clientUuid],
      );
      expect(rows[0]?.load_kg).toBe(22);
      // An older edit of the load loses against the one already applied.
      const older = await push(player15, [
        {
          hlc: hlc(0),
          op: 'gym_set.correct',
          target: { clientUuid },
          body: { changeReason: 'Viejo', loadKg: 18 },
        },
      ]);
      expect(older.map((r) => r.status)).toEqual(['superseded']);
      const voided = await push(player15, [
        { hlc: hlc(4), op: 'gym_set.void', target: { clientUuid }, body: { reason: 'Error' } },
      ]);
      expect(voided.map((r) => r.status)).toEqual(['applied']);
    });

    it('pulls the player its own sets and the programs that apply to them', async () => {
      await settled();
      const response = await get(player15, '/v1/sync/changes?collections=gym_program,gym_set');
      expect(response.statusCode, response.body).toBe(200);
      const page = response.json<{
        items: { collection: string; op: string; data: { playerId?: string } | null }[];
      }>();
      const programs = page.items.filter(
        (i) => i.collection === 'gym_program' && i.op === 'upsert',
      );
      expect(programs.map((i) => (i.data as { id: string }).id)).toEqual([m15Program.id]);
      const sets = page.items.filter((i) => i.collection === 'gym_set' && i.op === 'upsert');
      expect(sets.length).toBeGreaterThan(0);
      expect(new Set(sets.map((i) => i.data?.playerId))).toEqual(new Set([p15]));

      const m13 = await get(player13, '/v1/sync/changes?collections=gym_program,gym_set');
      const m13Items = m13
        .json<{ items: { collection: string; op: string; data: { name?: string } | null }[] }>()
        .items.filter((i) => i.op === 'upsert');
      expect(m13Items.map((i) => i.data?.name)).toEqual(['Técnica M13']);
    });
  });

  describe('stage by maturation', () => {
    let lateMaturer: SignedIn;
    let pLate: string;
    let pEarlyM17: string;
    let foundationProgram: ProgramBody;
    let m17Program: ProgramBody;

    async function pin(playerId: string, stage: string): Promise<void> {
      await database.admin.query(
        `insert into player_stage (club_id, player_id, stage, basis, reason, valid_from)
         values ($1, $2, $3, 'manual', 'pinned', '2020-01-01')`,
        [clubA, playerId, stage],
      );
    }

    beforeAll(async () => {
      lateMaturer = await signIn(t, 'late15@gym-a.example.com');
      await createMembership(database.admin, lateMaturer.userId, clubA, 'player');
      // A late-maturing M15 pinned to `foundation`: assessed by technique, no loads.
      pLate = await insertPlayer(clubA, categories.m15 ?? '', '2011-09-01', {
        userId: lateMaturer.userId,
      });
      await pin(pLate, 'foundation');
      // An M17 pinned to `development`: e1RM, never to failure.
      pEarlyM17 = await insertPlayer(clubA, categories.m17 ?? '', '2009-09-01');
      await pin(pEarlyM17, 'development');

      const foundation = await send(adminA, 'POST', '/v1/gym-programs', {
        name: 'Técnica M15 (formación)',
        categoryId: categories.m15,
        stage: 'foundation',
        plan: plan(pushUps),
        validFrom: '2026-01-01',
      });
      expect(foundation.statusCode, foundation.body).toBe(201);
      foundationProgram = foundation.json<ProgramBody>();
      const m17 = await send(adminA, 'POST', '/v1/gym-programs', {
        name: 'Fuerza M17',
        categoryId: categories.m17,
        plan: plan(trapBar({ targetRir: 0 })),
        validFrom: '2026-01-01',
      });
      expect(m17.statusCode, m17.body).toBe(201);
      m17Program = m17.json<ProgramBody>();
    });

    it("keeps a category's stage-less program from a player pinned to another stage", async () => {
      const response = await get(lateMaturer, `/v1/players/${pLate}/gym-programs`);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({
        stage: 'foundation',
        strengthAssessment: 'technique_reps',
        programs: [{ id: foundationProgram.id }],
      });
      // The M15 program with loads neither lists nor reads for him.
      const list = await get(lateMaturer, '/v1/gym-programs');
      expect(list.json<Page<ProgramBody>>().items.map((p) => p.id)).toEqual([foundationProgram.id]);
      expect((await get(lateMaturer, `/v1/gym-programs/${m15Program.id}`)).statusCode).toBe(404);
      // Nor can he log against it.
      const logged = await send(lateMaturer, 'POST', '/v1/gym-sets', {
        gymProgramId: m15Program.id,
        dayKey: 'a',
        sets: [{ exerciseCode: 'push_up', setNumber: 1, reps: 10 }],
      });
      expect(logged.statusCode, logged.body).toBe(400);
      expect(paths(logged)).toContain('body.gymProgramId');
      // The program of his stage he logs against.
      const own = await send(lateMaturer, 'POST', '/v1/gym-sets', {
        gymProgramId: foundationProgram.id,
        dayKey: 'a',
        sets: [{ exerciseCode: 'push_up', setNumber: 1, reps: 10 }],
      });
      expect(own.statusCode, own.body).toBe(201);
      // The rest of the category still gets the stage-less program, not the foundation one.
      const others = await get(player15, `/v1/players/${p15}/gym-programs`);
      expect(others.json<{ programs: { id: string }[] }>().programs.map((p) => p.id)).toEqual([
        m15Program.id,
      ]);
    });

    it('never prescribes to failure to an M17 pinned to development', async () => {
      const response = await get(adminA, `/v1/players/${pEarlyM17}/gym-programs`);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({
        stage: 'development',
        strengthAssessment: 'estimated_rm',
        programs: [],
      });
      expect(m17Program.stage).toBeNull();
    });

    it('pulls a pinned player only the programs of their stage', async () => {
      const deadline = Date.now() + 30_000;
      for (;;) {
        const { rows } = await database.admin.query<{ done: boolean }>(
          `select coalesce(max(txid) < pg_snapshot_xmin(pg_current_snapshot()), true) as done
             from sync_change`,
        );
        if (rows[0]?.done === true) break;
        if (Date.now() > deadline) throw new Error('the pull horizon did not move');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const response = await get(lateMaturer, '/v1/sync/changes?collections=gym_program');
      expect(response.statusCode, response.body).toBe(200);
      const programs = response
        .json<{ items: { op: string; data: { id: string } | null }[] }>()
        .items.filter((i) => i.op === 'upsert');
      expect(programs.map((i) => i.data?.id)).toEqual([foundationProgram.id]);
    });
  });
});
