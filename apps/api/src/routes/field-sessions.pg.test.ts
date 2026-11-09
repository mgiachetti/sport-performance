/**
 * Field sessions (B-408, ADR 0061) end to end against Postgres 16, through
 * the real connection role of the API (ADR 0026): the session through
 * `training_session.read`, every player through `load_metrics.read`, RLS
 * behind it, one total per player, metric and source, and the first-team
 * references of the squad. Field metrics are arranged with the owner
 * connection (their importer is B-601).
 */
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
} from '../testing/identity.js';
import { describeWithPostgres } from '../testing/support.js';

interface Envelope {
  error: { code: string };
}

interface FieldSessionBody {
  session: { id: string; kind: string; categoryId: string | null };
  columns: { metricCode: string; source: string; unit: string; direction: string }[];
  players: {
    playerId: string;
    firstName: string;
    lastName: string;
    position: { code: string; label: string | null; lineCode: string | null } | null;
    participation: Record<string, unknown> | null;
    values: { metricCode: string; source: string; value: number }[];
  }[];
  references: {
    metricCode: string;
    unit: string;
    value: number;
    method: string | null;
    validFrom: string;
    source: string;
  }[];
}

interface ListItemBody {
  session: { id: string; kind: string };
  playersN: number;
  sources: string[];
  metricCodes: string[];
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Alta de clubes para la vista de sesión');

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

describeWithPostgres('field sessions (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let coachA: SignedIn;
  let medicalA: SignedIn;
  let playerA: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let m15: string;
  let m17: string;
  /** M15, hooker (forwards), the player of `playerA`. */
  let p1: string;
  /** M15, fly half (backs). */
  let p2: string;
  /** M15 without field data: only participation. */
  let p3: string;
  /** M17 guest in the M15 match: outside the coach's assignment. */
  let p4: string;
  /** Club B. */
  let pB: string;
  /** M15 match with field data. */
  let match: string;
  /** M15 training without field data. */
  let bare: string;
  /** M17 training with field data. */
  let m17Training: string;
  /** Club B session with field data. */
  let sessionB: string;

  const registry = () => ({ ...superadmin.headers, 'x-support-reason': SUPPORT_REASON });

  async function newClub(slug: string): Promise<ClubId> {
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

  async function categoryId(clubId: ClubId, band: string): Promise<string> {
    const result = await database.admin.query<{ id: string }>(
      `select id from category where club_id = $1 and sport = 'rugby' and age_band_code = $2`,
      [clubId, band],
    );
    return result.rows[0]?.id ?? '';
  }

  async function insertPlayer(
    clubId: ClubId,
    options: {
      categoryId: string;
      firstName: string;
      lastName: string;
      positionCode?: string;
      userId?: string;
    },
  ): Promise<string> {
    const result = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, $3, $4, '2011-05-10', 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, options.userId ?? null, options.firstName, options.lastName],
    );
    const id = result.rows[0]?.id ?? '';
    if (options.positionCode !== undefined) {
      await database.admin.query(
        `insert into player_position (club_id, player_id, position_id, sort_order)
         values ($1, $2, (select id from position where club_id = $1 and sport = 'rugby' and code = $3), 0)`,
        [clubId, id, options.positionCode],
      );
    }
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, id, options.categoryId],
    );
    return id;
  }

  async function insertSession(
    clubId: ClubId,
    options: { categoryId: string; kind: string; localDate: string; title: string },
  ): Promise<string> {
    const result = await database.admin.query<{ id: string }>(
      `insert into training_session
         (club_id, sport, kind, category_id, title, starts_at, local_date, planned_duration_min)
       values ($1, 'rugby', $2, $3, $4, ($5::date + time '18:00') at time zone 'America/Argentina/Buenos_Aires', $5, 80)
       returning id`,
      [clubId, options.kind, options.categoryId, options.title, options.localDate],
    );
    return result.rows[0]?.id ?? '';
  }

  async function insertMetric(
    clubId: ClubId,
    options: {
      playerId: string;
      sessionId: string;
      code: string;
      value: number;
      source?: string;
      externalRef?: string;
      writtenAt?: string;
      drillId?: string;
    },
  ): Promise<void> {
    await database.admin.query(
      `insert into external_metric
         (club_id, player_id, training_session_id, drill_id, metric_definition_id, local_date,
          value, unit, source, external_ref, created_at, updated_at, method_variant,
          algorithm_version)
       select $1, $2, s.id, $3, d.id, s.local_date, $5, d.unit, $6::external_metric_source, $7,
              coalesce($8::timestamptz, now()), coalesce($8::timestamptz, now()),
              -- A pod value carries its variant and algorithm (B-919).
              case when $6::external_metric_source = 'pod' then 'pod_log'::pod_method_variant end,
              case when $6::external_metric_source = 'pod' then 'pod-metrics/1' end
         from training_session s, metric_definition d
        where s.club_id = $1 and s.id = $9 and d.club_id = $1 and d.code = $4`,
      [
        clubId,
        options.playerId,
        options.drillId ?? null,
        options.code,
        options.value,
        options.source ?? 'catapult',
        options.externalRef ?? null,
        options.writtenAt ?? null,
        options.sessionId,
      ],
    );
  }

  async function insertReference(
    clubId: ClubId,
    options: { code: string; value: number; validFrom: string; lineCode?: string },
  ): Promise<void> {
    await database.admin.query(
      `insert into reference_value
         (club_id, metric_definition_id, sport, sex, line_code, value, unit, method, valid_from, source)
       select $1, d.id, 'rugby', 'male', $3, $4, d.unit, 'pod', $5, 'Catapult de primera'
         from metric_definition d where d.club_id = $1 and d.code = $2`,
      [clubId, options.code, options.lineCode ?? null, options.value, options.validFrom],
    );
  }

  async function view(caller: SignedIn, sessionId: string): Promise<LightMyRequestResponse> {
    return t.app.inject({
      url: `/v1/training-sessions/${sessionId}/field-metrics`,
      headers: caller.headers,
    });
  }

  async function list(caller: SignedIn, query = ''): Promise<LightMyRequestResponse> {
    return t.app.inject({ url: `/v1/field-sessions${query}`, headers: caller.headers });
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
    medicalA = await signIn(t, 'medical@club-a.example.com');
    playerA = await signIn(t, 'player@club-a.example.com');

    clubA = await newClub('club-a');
    clubB = await newClub('club-b');
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    const coachMembership = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    await createMembership(database.admin, medicalA.userId, clubA, 'medical');
    await createMembership(database.admin, playerA.userId, clubA, 'player');
    m15 = await categoryId(clubA, 'm15');
    m17 = await categoryId(clubA, 'm17');
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, coachMembership, m15],
    );

    p1 = await insertPlayer(clubA, {
      categoryId: m15,
      firstName: 'Tomás',
      lastName: 'Álvarez',
      positionCode: 'hooker',
      userId: playerA.userId,
    });
    p2 = await insertPlayer(clubA, {
      categoryId: m15,
      firstName: 'Juan',
      lastName: 'Bianchi',
      positionCode: 'fly_half',
    });
    p3 = await insertPlayer(clubA, { categoryId: m15, firstName: 'Lucas', lastName: 'Castro' });
    p4 = await insertPlayer(clubA, {
      categoryId: m17,
      firstName: 'Mateo',
      lastName: 'Díaz',
      positionCode: 'wing',
    });
    pB = await insertPlayer(clubB, {
      categoryId: await categoryId(clubB, 'm15'),
      firstName: 'Otro',
      lastName: 'Club',
    });

    match = await insertSession(clubA, {
      categoryId: m15,
      kind: 'match',
      localDate: '2026-10-24',
      title: 'Fecha 12',
    });
    bare = await insertSession(clubA, {
      categoryId: m15,
      kind: 'training',
      localDate: '2026-10-22',
      title: 'Sin GPS',
    });
    m17Training = await insertSession(clubA, {
      categoryId: m17,
      kind: 'training',
      localDate: '2026-10-21',
      title: 'Velocidad',
    });
    sessionB = await insertSession(clubB, {
      categoryId: await categoryId(clubB, 'm15'),
      kind: 'match',
      localDate: '2026-10-24',
      title: 'Club B',
    });
    const drill = await database.admin.query<{ id: string }>(
      `insert into drill (club_id, training_session_id, name) values ($1, $2, 'Primer tiempo') returning id`,
      [clubA, match],
    );

    // p1: Catapult twice (a re-export: the latest wins), the pod once and a drill row.
    await insertMetric(clubA, {
      playerId: p1,
      sessionId: match,
      code: 'dist_m',
      value: 5000,
      externalRef: 'export-1',
      writtenAt: '2026-10-25T10:00:00Z',
    });
    await insertMetric(clubA, {
      playerId: p1,
      sessionId: match,
      code: 'dist_m',
      value: 5120,
      externalRef: 'export-2',
      writtenAt: '2026-10-25T11:00:00Z',
    });
    await insertMetric(clubA, {
      playerId: p1,
      sessionId: match,
      code: 'dist_m',
      value: 5090.5,
      source: 'pod',
    });
    await insertMetric(clubA, {
      playerId: p1,
      sessionId: match,
      code: 'dist_m',
      value: 2600,
      drillId: drill.rows[0]?.id ?? '',
    });
    await insertMetric(clubA, { playerId: p1, sessionId: match, code: 'hsr_abs_m', value: 310 });
    await insertMetric(clubA, { playerId: p2, sessionId: match, code: 'dist_m', value: 6200 });
    await insertMetric(clubA, { playerId: p2, sessionId: match, code: 'vmax_ms', value: 8.12 });
    // p4 (M17) played the M15 match; only they have accelerations.
    await insertMetric(clubA, { playerId: p4, sessionId: match, code: 'dist_m', value: 5800 });
    await insertMetric(clubA, { playerId: p4, sessionId: match, code: 'acc_n', value: 31 });
    await insertMetric(clubA, {
      playerId: p4,
      sessionId: m17Training,
      code: 'dist_m',
      value: 4100,
    });
    await insertMetric(clubB, { playerId: pB, sessionId: sessionB, code: 'dist_m', value: 4000 });

    await database.admin.query(
      `insert into participation (club_id, training_session_id, player_id, status, minutes, contacts_n, rpe, rpe_reported_at)
       values ($1, $2, $3, 'full', 70, 14, 8, now()),
              ($1, $2, $4, 'unavailable', null, null, null, null),
              ($1, $2, $5, 'partial', 20, 3, null, null)`,
      [clubA, match, p1, p2, p3],
    );

    await insertReference(clubA, { code: 'dist_m', value: 6000, validFrom: '2026-01-01' });
    await insertReference(clubA, { code: 'dist_m', value: 6400, validFrom: '2026-11-01' });
    await insertReference(clubA, {
      code: 'dist_m',
      value: 5600,
      validFrom: '2026-01-01',
      lineCode: 'forwards',
    });
    await insertReference(clubA, { code: 'cmj_height_cm', value: 45, validFrom: '2026-01-01' });
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('GET /v1/training-sessions/{id}/field-metrics', () => {
    it('gives the administration every player, one total per metric and source', async () => {
      const response = await view(adminA, match);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<FieldSessionBody>();
      expect(body.session).toMatchObject({ id: match, kind: 'match', categoryId: m15 });
      expect(body.columns.map((c) => `${c.metricCode}/${c.source}`)).toEqual([
        'dist_m/catapult',
        'dist_m/pod',
        'hsr_abs_m/catapult',
        'vmax_ms/catapult',
        'acc_n/catapult',
      ]);
      expect(body.columns[0]).toEqual({
        metricCode: 'dist_m',
        source: 'catapult',
        unit: 'm',
        direction: 'higher_is_better',
      });
      expect(body.players.map((p) => p.lastName)).toEqual(['Álvarez', 'Bianchi', 'Castro', 'Díaz']);

      const [alvarez, bianchi, castro, diaz] = body.players;
      expect(alvarez).toMatchObject({
        playerId: p1,
        position: { code: 'hooker', lineCode: 'forwards' },
        participation: { status: 'full', minutes: 70, contactsN: 14, rpe: 8, srpeAu: 560 },
      });
      // The latest Catapult export, the pod apart, and no drill row.
      expect(alvarez?.values).toEqual([
        { metricCode: 'dist_m', source: 'catapult', value: 5120 },
        { metricCode: 'dist_m', source: 'pod', value: 5090.5 },
        { metricCode: 'hsr_abs_m', source: 'catapult', value: 310 },
      ]);
      expect(bianchi?.position).toEqual({ code: 'fly_half', label: null, lineCode: 'backs' });
      // "No disponible", never the cause.
      expect(bianchi?.participation).toEqual({
        status: 'unavailable',
        minutes: null,
        periodMinutes: null,
        contactsN: null,
        rpe: null,
        srpeAu: null,
      });
      expect(castro).toMatchObject({ playerId: p3, position: null, values: [] });
      expect(diaz?.playerId).toBe(p4);
      expect(diaz?.participation).toBeNull();
    });

    it('adds the squad reference in force on the session day, never a line or a later one', async () => {
      const body = (await view(adminA, match)).json<FieldSessionBody>();
      expect(body.references).toEqual([
        {
          metricCode: 'dist_m',
          unit: 'm',
          value: 6000,
          method: 'pod',
          validFrom: '2026-01-01',
          source: 'Catapult de primera',
        },
      ]);
    });

    it('leaves out the players the coach does not see, and their columns', async () => {
      const response = await view(coachA, match);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<FieldSessionBody>();
      expect(body.players.map((p) => p.playerId)).toEqual([p1, p2, p3]);
      expect(body.columns.map((c) => c.metricCode)).not.toContain('acc_n');
    });

    it('answers 403 outside the assignment, 404 for another club and 403 to a player', async () => {
      const outside = await view(coachA, m17Training);
      expect(outside.statusCode).toBe(403);
      expect(errorOf(outside).code).toBe('forbidden');
      const other = await view(adminA, sessionB);
      expect(other.statusCode).toBe(404);
      expect(errorOf(other).code).toBe('not_found');
      const own = await view(playerA, match);
      expect(own.statusCode).toBe(403);
    });

    it('shows a session without field data with its participation only', async () => {
      const body = (await view(adminA, bare)).json<FieldSessionBody>();
      expect(body).toMatchObject({ columns: [], players: [], references: [] });
    });

    it('lets the medical staff read it with their assignments only', async () => {
      // Without an assignment the medical staff sees no category: the session is out of reach.
      expect((await view(medicalA, match)).statusCode).toBe(403);
    });
  });

  describe('GET /v1/field-sessions', () => {
    it('lists the sessions with field data, newest first, with what they hold', async () => {
      const response = await list(adminA);
      expect(response.statusCode, response.body).toBe(200);
      const page = response.json<Page<ListItemBody>>();
      expect(page.items.map((i) => i.session.id)).toEqual([match, m17Training]);
      expect(page.items[0]).toMatchObject({
        playersN: 3,
        sources: ['catapult', 'pod'],
        metricCodes: ['dist_m', 'hsr_abs_m', 'vmax_ms', 'acc_n'],
      });
      expect(page.nextCursor).toBeNull();
    });

    it('counts only what the coach sees and keeps to their categories', async () => {
      const page = (await list(coachA)).json<Page<ListItemBody>>();
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        session: { id: match },
        playersN: 2,
        metricCodes: ['dist_m', 'hsr_abs_m', 'vmax_ms'],
      });
    });

    it('filters by kind, category and club days, and pages by cursor', async () => {
      const byKind = (await list(adminA, '?kind=training')).json<Page<ListItemBody>>();
      expect(byKind.items.map((i) => i.session.id)).toEqual([m17Training]);
      const bySport = (await list(adminA, '?sport=hockey')).json<Page<ListItemBody>>();
      expect(bySport.items).toEqual([]);
      const byCategory = (await list(adminA, `?categoryId=${m15}`)).json<Page<ListItemBody>>();
      expect(byCategory.items.map((i) => i.session.id)).toEqual([match]);
      const byDays = (await list(adminA, '?from=2026-10-22&to=2026-10-31')).json<
        Page<ListItemBody>
      >();
      expect(byDays.items.map((i) => i.session.id)).toEqual([match]);

      const first = (await list(adminA, '?limit=1')).json<Page<ListItemBody>>();
      expect(first.items.map((i) => i.session.id)).toEqual([match]);
      expect(first.nextCursor).not.toBeNull();
      const second = (
        await list(adminA, `?limit=1&cursor=${encodeURIComponent(first.nextCursor ?? '')}`)
      ).json<Page<ListItemBody>>();
      expect(second.items.map((i) => i.session.id)).toEqual([m17Training]);
      expect(second.nextCursor).toBeNull();
    });

    it('never shows another club and is closed to players', async () => {
      const otherClub = (await list(adminB)).json<Page<ListItemBody>>();
      expect(otherClub.items.map((i) => i.session.id)).toEqual([sessionB]);
      expect((await list(playerA)).statusCode).toBe(403);
    });

    it('hides archived sessions unless asked', async () => {
      await database.admin.query('update training_session set archived_at = now() where id = $1', [
        m17Training,
      ]);
      try {
        const active = (await list(adminA)).json<Page<ListItemBody>>();
        expect(active.items.map((i) => i.session.id)).toEqual([match]);
        const archived = (await list(adminA, '?status=archived')).json<Page<ListItemBody>>();
        expect(archived.items.map((i) => i.session.id)).toEqual([m17Training]);
      } finally {
        await database.admin.query('update training_session set archived_at = null where id = $1', [
          m17Training,
        ]);
      }
    });
  });
});
