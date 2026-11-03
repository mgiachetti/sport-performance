/**
 * Offline sync end to end (B-323, ADR 0015, ADR 0050) against Postgres 16,
 * through the real connection roles: the push runs every mutation through
 * the handler of its online endpoint (permissions, consents, RLS, change
 * history), idempotent by `mutationId`, with per-field last-writer-wins by
 * HLC; the pull reads the change log by cursor, never skips a transaction
 * that commits late and resets when the caller's scope changes.
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

interface MutationResult {
  mutationId: string;
  op: string;
  status: 'applied' | 'superseded' | 'replayed' | 'rejected';
  hlc: string | null;
  clamped: boolean;
  appliedFields: string[];
  supersededFields: string[];
  error: { code: string; message: string; details?: { path: (string | number)[] }[] } | null;
}

interface PushBody {
  serverHlc: string;
  results: MutationResult[];
}

interface Change {
  collection: string;
  op: 'upsert' | 'delete';
  id: string;
  clientUuid: string | null;
  data: Record<string, unknown> | null;
}

interface PullBody {
  items: Change[];
  cursor: string;
  hasMore: boolean;
  reset: boolean;
  collections: string[];
  serverHlc: string;
}

const SUPPORT_REASON = encodeURIComponent('Alta de clubes para las pruebas de sincronización');
const DEVICE_A = '0123456789abcdef';
const DEVICE_B = 'fedcba9876543210';
/** Ten minutes ago: every offline clock of the tests is in the past of the server. */
const BASE_MS = Date.now() - 10 * 60_000;

/** The clock of a device `step` seconds after {@link BASE_MS}. */
function hlc(step: number, node = DEVICE_A, counter = 0): string {
  return formatHlc({ physicalMs: BASE_MS + step * 1000, counter, node });
}

interface Mutation {
  mutationId?: string;
  hlc: string;
  op: string;
  params?: unknown;
  target?: unknown;
  body?: unknown;
}

describeWithPostgres('offline sync (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let coachM15: SignedIn;
  let coachM13: SignedIn;
  let scM15: SignedIn;
  let player15: SignedIn;
  let parent15: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let coachM13Membership: string;
  const categories: Record<string, string> = {};
  const definitions: Record<string, string> = {};
  let p15: string;
  let p15NoConsent: string;
  let p13: string;
  let sessionId: string;
  const wellnessUuid = randomUUID();

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

  async function push(
    caller: SignedIn,
    mutations: Mutation[],
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    return t.app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: { ...caller.headers, ...headers },
      payload: {
        mutations: mutations.map((m) => ({ mutationId: m.mutationId ?? randomUUID(), ...m })),
      },
    });
  }

  async function pushOk(caller: SignedIn, mutations: Mutation[]): Promise<MutationResult[]> {
    const response = await push(caller, mutations);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<PushBody>().results;
  }

  async function pull(caller: SignedIn, query = ''): Promise<LightMyRequestResponse> {
    return t.app.inject({ url: `/v1/sync/changes${query}`, headers: caller.headers });
  }

  /**
   * Waits until every change logged so far is below the pull horizon. The horizon is the
   * oldest transaction running on the server, and the other test files run their own
   * transactions on the same server (other databases): without this a pull right after a
   * write could transiently return fewer changes.
   */
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

  async function pullOk(caller: SignedIn, query = '', settle = true): Promise<PullBody> {
    if (settle) await settled();
    const response = await pull(caller, query);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<PullBody>();
  }

  /** Every page from `cursor` until `hasMore` is false. */
  async function pullAll(
    caller: SignedIn,
    options: { cursor?: string; limit?: number; collections?: string; settle?: boolean } = {},
  ): Promise<{ items: Change[]; cursor: string; reset: boolean; pages: number }> {
    const items: Change[] = [];
    let cursor = options.cursor;
    let reset = false;
    let pages = 0;
    for (;;) {
      const query = new URLSearchParams();
      if (cursor !== undefined) query.set('cursor', cursor);
      if (options.limit !== undefined) query.set('limit', String(options.limit));
      if (options.collections !== undefined) query.set('collections', options.collections);
      const page = await pullOk(caller, `?${query.toString()}`, options.settle ?? true);
      pages += 1;
      if (page.reset) reset = true;
      items.push(...page.items);
      cursor = page.cursor;
      if (!page.hasMore) return { items, cursor, reset, pages };
    }
  }

  async function wellnessRow(id: string) {
    const { rows } = await database.admin.query<Record<string, number | null>>(
      'select sleep, fatigue, soreness, stress, mood from wellness where id = $1',
      [id],
    );
    return rows[0];
  }

  async function clocksOf(collection: string, rowId: string): Promise<Record<string, string>> {
    const { rows } = await database.admin.query<{ field_hlc: Record<string, string> }>(
      'select field_hlc from sync_change where collection = $1 and row_id = $2 and not deleted',
      [collection, rowId],
    );
    return rows[0]?.field_hlc ?? {};
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
    adminA = await signIn(t, 'admin@sync-a.example.com');
    adminB = await signIn(t, 'admin@sync-b.example.com');
    coachM15 = await signIn(t, 'coach15@sync-a.example.com');
    coachM13 = await signIn(t, 'coach13@sync-a.example.com');
    scM15 = await signIn(t, 'sc15@sync-a.example.com');
    player15 = await signIn(t, 'player15@sync-a.example.com');
    parent15 = await signIn(t, 'parent15@sync-a.example.com');

    clubA = await createClub('sync-a');
    clubB = await createClub('sync-b');
    const rows = await database.admin.query<{ id: string; age_band_code: string }>(
      'select id, age_band_code from category where club_id = $1',
      [clubA],
    );
    for (const row of rows.rows) categories[row.age_band_code] = row.id;
    const defs = await database.admin.query<{ id: string; code: string }>(
      'select id, code from test_definition where club_id = $1',
      [clubA],
    );
    for (const row of defs.rows) definitions[row.code] = row.id;

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    await assign(
      await createMembership(database.admin, coachM15.userId, clubA, 'coach'),
      categories.m15 ?? '',
    );
    coachM13Membership = await createMembership(database.admin, coachM13.userId, clubA, 'coach');
    await assign(coachM13Membership, categories.m13 ?? '');
    await assign(
      await createMembership(database.admin, scM15.userId, clubA, 'sc'),
      categories.m15 ?? '',
    );
    await createMembership(database.admin, player15.userId, clubA, 'player');
    await createMembership(database.admin, parent15.userId, clubA, 'parent');

    p15 = await insertPlayer(clubA, categories.m15 ?? '', '2011-05-01', {
      userId: player15.userId,
    });
    p15NoConsent = await insertPlayer(clubA, categories.m15 ?? '', '2011-07-01', {
      consent: false,
    });
    p13 = await insertPlayer(clubA, categories.m13 ?? '', '2013-05-01');
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, p15, parent15.userId],
    );

    const session = await t.app.inject({
      method: 'POST',
      url: '/v1/training-sessions',
      headers: adminA.headers,
      payload: {
        kind: 'training',
        categoryId: categories.m15,
        startsAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
        plannedDurationMin: 90,
      },
    });
    expect(session.statusCode, session.body).toBe(201);
    sessionId = session.json<{ id: string }>().id;
  }, 240_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('push: idempotency and retries', () => {
    const mutationId = randomUUID();
    let wellnessId: string;

    it('applies an offline check-in through the online handler', async () => {
      const [result] = await pushOk(player15, [
        {
          mutationId,
          hlc: hlc(1),
          op: 'wellness.submit',
          body: {
            clientUuid: wellnessUuid,
            scores: { sleep: 3, fatigue: 3, soreness: 3, stress: 3, mood: 3 },
          },
        },
      ]);
      expect(result).toMatchObject({
        mutationId,
        status: 'applied',
        hlc: hlc(1),
        clamped: false,
        error: null,
      });
      const { rows } = await database.admin.query<{ id: string }>(
        'select id from wellness where client_uuid = $1',
        [wellnessUuid],
      );
      wellnessId = rows[0]?.id ?? '';
      expect(wellnessId).not.toBe('');
      // The insert stamped every item with the mutation's clock.
      expect(await clocksOf('wellness', wellnessId)).toEqual({
        sleep: hlc(1),
        fatigue: hlc(1),
        soreness: hlc(1),
        stress: hlc(1),
        mood: hlc(1),
      });
    });

    it('answers a resent mutation (lost response) as replayed, without applying it again', async () => {
      const [again] = await pushOk(player15, [
        {
          mutationId,
          hlc: hlc(1),
          op: 'wellness.submit',
          body: { clientUuid: wellnessUuid, scores: { sleep: 1, fatigue: 1, soreness: 1 } },
        },
      ]);
      // With what the first application did.
      expect(again).toMatchObject({
        status: 'replayed',
        hlc: hlc(1),
        firstOutcome: 'applied',
        error: null,
      });
      expect(await wellnessRow(wellnessId)).toMatchObject({ sleep: 3, fatigue: 3 });
      const { rows } = await database.admin.query<{ n: number }>(
        'select count(*)::int as n from wellness where player_id = $1',
        [p15],
      );
      expect(rows[0]?.n).toBe(1);
    });

    it('records a create the handler replayed by its clientUuid as replayed', async () => {
      const id = randomUUID();
      const [result] = await pushOk(player15, [
        {
          mutationId: id,
          hlc: hlc(1, DEVICE_B),
          op: 'wellness.submit',
          body: {
            clientUuid: wellnessUuid,
            scores: { sleep: 1, fatigue: 1, soreness: 1, stress: 1, mood: 1 },
          },
        },
      ]);
      expect(result).toMatchObject({ status: 'replayed', appliedFields: [], error: null });
      expect(await wellnessRow(wellnessId)).toMatchObject({ sleep: 3, fatigue: 3 });
      const { rows } = await database.admin.query<{ outcome: string }>(
        'select outcome from sync_mutation where client_uuid = $1',
        [id],
      );
      expect(rows[0]?.outcome).toBe('replayed');
      const [resent] = await pushOk(player15, [
        {
          mutationId: id,
          hlc: hlc(1, DEVICE_B),
          op: 'wellness.submit',
          body: {
            clientUuid: wellnessUuid,
            scores: { sleep: 1, fatigue: 1, soreness: 1, stress: 1, mood: 1 },
          },
        },
      ]);
      expect(resent).toMatchObject({ status: 'replayed', firstOutcome: 'replayed' });
    });

    it('replays a mutation repeated in the same push', async () => {
      const id = randomUUID();
      const correction = {
        mutationId: id,
        hlc: hlc(2),
        op: 'wellness.correct',
        target: { clientUuid: wellnessUuid },
        body: { changeReason: 'Me equivoqué al cargar', scores: { soreness: 4 } },
      };
      const results = await pushOk(player15, [correction, correction]);
      expect(results.map((r) => r.status)).toEqual(['applied', 'replayed']);
      expect(await wellnessRow(wellnessId)).toMatchObject({ soreness: 4 });
    });

    it('answers a mutationId of another user as a conflict, without saying whose it is', async () => {
      const [result] = await pushOk(coachM15, [
        {
          mutationId,
          hlc: hlc(3),
          op: 'participation.record',
          params: { trainingSessionId: sessionId },
          body: { rows: [{ clientUuid: randomUUID(), playerId: p15, status: 'full', minutes: 1 }] },
        },
      ]);
      expect(result).toMatchObject({ status: 'rejected', error: { code: 'conflict' } });
      const { rows } = await database.admin.query<{ n: number }>(
        'select count(*)::int as n from participation where training_session_id = $1',
        [sessionId],
      );
      expect(rows[0]?.n).toBe(0);
    });

    it('requires the clientUuid of offline creates', async () => {
      const [result] = await pushOk(player15, [
        { hlc: hlc(3), op: 'wellness.submit', body: { scores: { sleep: 3 } } },
      ]);
      expect(result?.status).toBe('rejected');
      expect(result?.error?.code).toBe('validation_failed');
      expect(result?.error?.details?.map((d) => d.path.join('.'))).toEqual([
        'body.mutations.0.body.clientUuid',
      ]);
      const [batch] = await pushOk(scM15, [
        {
          hlc: hlc(3),
          op: 'test_session.record_results',
          params: { testSessionId: randomUUID() },
          body: {
            results: [
              {
                status: 'not_done',
                playerId: p15,
                testDefinitionId: definitions.cmj,
                notDoneReason: 'absent',
              },
            ],
          },
        },
      ]);
      expect(batch?.error?.details?.map((d) => d.path.join('.'))).toEqual([
        'body.mutations.0.body.results.0.clientUuid',
      ]);
    });
  });

  describe('push: conflicts resolved per field by HLC', () => {
    it('lets two devices edit different items of the same entry', async () => {
      const results = await pushOk(player15, [
        {
          hlc: hlc(10, DEVICE_A),
          op: 'wellness.correct',
          target: { clientUuid: wellnessUuid },
          body: { changeReason: 'Dormí mejor de lo que puse', scores: { sleep: 5 } },
        },
        {
          hlc: hlc(8, DEVICE_B),
          op: 'wellness.correct',
          target: { clientUuid: wellnessUuid },
          body: { changeReason: 'Corrijo la fatiga', scores: { fatigue: 2 } },
        },
      ]);
      expect(results.map((r) => [r.status, r.appliedFields])).toEqual([
        ['applied', ['scores.sleep']],
        ['applied', ['scores.fatigue']],
      ]);
      const { rows } = await database.admin.query<{ id: string }>(
        'select id from wellness where client_uuid = $1',
        [wellnessUuid],
      );
      const id = rows[0]?.id ?? '';
      expect(await wellnessRow(id)).toMatchObject({ sleep: 5, fatigue: 2, soreness: 4 });
      expect(await clocksOf('wellness', id)).toMatchObject({
        sleep: hlc(10, DEVICE_A),
        fatigue: hlc(8, DEVICE_B),
      });
    });

    it('drops the fields of an older edit that arrives later, keeping the newer ones', async () => {
      const [stale] = await pushOk(player15, [
        {
          hlc: hlc(9, DEVICE_B),
          op: 'wellness.correct',
          target: { clientUuid: wellnessUuid },
          body: { changeReason: 'Edición vieja', scores: { sleep: 1, mood: 1 } },
        },
      ]);
      expect(stale).toMatchObject({
        status: 'applied',
        appliedFields: ['scores.mood'],
        supersededFields: ['scores.sleep'],
      });
      const [only] = await pushOk(player15, [
        {
          hlc: hlc(9, DEVICE_B, 1),
          op: 'wellness.correct',
          target: { clientUuid: wellnessUuid },
          body: { changeReason: 'Edición vieja', scores: { sleep: 2 } },
        },
      ]);
      expect(only).toMatchObject({
        status: 'superseded',
        appliedFields: [],
        supersededFields: ['scores.sleep'],
      });
      const { rows } = await database.admin.query<{ id: string }>(
        'select id from wellness where client_uuid = $1',
        [wellnessUuid],
      );
      expect(await wellnessRow(rows[0]?.id ?? '')).toMatchObject({ sleep: 5, mood: 1 });
    });

    it('breaks a tie of time and counter by node, the same on every server', async () => {
      // Same instant and counter as the edit of DEVICE_A: DEVICE_B's node sorts after it.
      const [tie] = await pushOk(player15, [
        {
          hlc: hlc(10, DEVICE_B),
          op: 'wellness.correct',
          target: { clientUuid: wellnessUuid },
          body: { changeReason: 'Empate', scores: { sleep: 4 } },
        },
      ]);
      expect(tie?.status).toBe('applied');
    });

    it('advances the clock of a field that wins with the value it already had', async () => {
      const { rows } = await database.admin.query<{ id: string }>(
        'select id from wellness where client_uuid = $1',
        [wellnessUuid],
      );
      const id = rows[0]?.id ?? '';
      const [same] = await pushOk(player15, [
        {
          hlc: hlc(30),
          op: 'wellness.correct',
          target: { id },
          body: { changeReason: 'Mismo valor', scores: { stress: 3 } },
        },
      ]);
      expect(same?.status).toBe('applied');
      expect((await clocksOf('wellness', id)).stress).toBe(hlc(30));
      // An edit older than that one (but newer than the creation) loses.
      const [older] = await pushOk(player15, [
        {
          hlc: hlc(20),
          op: 'wellness.correct',
          target: { id },
          body: { changeReason: 'Más vieja', scores: { stress: 1 } },
        },
      ]);
      expect(older?.status).toBe('superseded');
      expect(await wellnessRow(id)).toMatchObject({ stress: 3 });
    });

    it('never lets an offline edit older than an online correction win', async () => {
      const { rows } = await database.admin.query<{ id: string }>(
        'select id from wellness where client_uuid = $1',
        [wellnessUuid],
      );
      const id = rows[0]?.id ?? '';
      const read = await t.app.inject({ url: `/v1/wellness/${id}`, headers: player15.headers });
      const current = read.json<{ version: string; scores: Record<string, number> }>();
      const online = await t.app.inject({
        method: 'PATCH',
        url: `/v1/wellness/${id}`,
        headers: player15.headers,
        payload: {
          version: current.version,
          changeReason: 'Corrección en línea',
          scores: { ...current.scores, mood: 5 },
        },
      });
      expect(online.statusCode, online.body).toBe(200);
      // Stamped by the trigger with the server's clock (now), later than every offline clock.
      expect((await clocksOf('wellness', id)).mood).toMatch(/-000000-server$/);
      const [late] = await pushOk(player15, [
        {
          hlc: hlc(60),
          op: 'wellness.correct',
          target: { id },
          body: { changeReason: 'Llegó tarde', scores: { mood: 2 } },
        },
      ]);
      expect(late?.status).toBe('superseded');
      expect(await wellnessRow(id)).toMatchObject({ mood: 5 });
    });

    it('brings a clock ahead of the server back to the server time', async () => {
      const ahead = formatHlc({ physicalMs: Date.now() + 3_600_000, counter: 0, node: DEVICE_A });
      // The clock is brought to the time of Postgres, not of this host (they may skew).
      const { rows: now } = await database.admin.query<{ ms: string }>(
        'select floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text as ms',
      );
      const before = Number(now[0]?.ms);
      const [result] = await pushOk(player15, [
        {
          hlc: ahead,
          op: 'wellness.correct',
          target: { clientUuid: wellnessUuid },
          body: { changeReason: 'Reloj adelantado', scores: { mood: 4 } },
        },
      ]);
      expect(result).toMatchObject({ status: 'applied', clamped: true });
      const physical = Number(result?.hlc?.slice(0, 15));
      expect(physical).toBeGreaterThanOrEqual(before);
      expect(physical).toBeLessThan(before + 60_000);
      // The clock as the device sent it stays with the mutation, to audit devices.
      const { rows } = await database.admin.query<{ hlc: string; received_hlc: string }>(
        'select hlc, received_hlc from sync_mutation where hlc = $1',
        [result?.hlc],
      );
      expect(rows[0]).toEqual({ hlc: result?.hlc, received_hlc: ahead });
    });

    it('records the reason and the request id of an offline correction in the history', async () => {
      const { rows } = await database.admin.query<{ reason: string; request_id: string }>(
        `select reason, request_id from change_history
          where table_name = 'wellness' and reason = 'Dormí mejor de lo que puse'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.request_id).toMatch(/.+/);
    });
  });

  describe('push: rejections never block the queue', () => {
    it('answers each mutation with the error its online endpoint gives, and applies the rest', async () => {
      const results = await pushOk(coachM15, [
        { hlc: hlc(40), op: 'wellness.submit', body: { clientUuid: randomUUID(), scores: {} } },
        { hlc: hlc(40), op: 'gym.log', body: {} },
        {
          hlc: hlc(40),
          op: 'participation.record',
          params: { trainingSessionId: sessionId },
          body: {
            rows: [
              { clientUuid: randomUUID(), playerId: p15NoConsent, status: 'full', minutes: 60 },
            ],
          },
        },
        {
          hlc: hlc(40),
          op: 'participation.record',
          params: { trainingSessionId: sessionId },
          body: { rows: [{ clientUuid: randomUUID(), playerId: p15, status: 'full' }], extra: 1 },
        },
        {
          hlc: hlc(41),
          op: 'participation.record',
          params: { trainingSessionId: sessionId },
          body: {
            rows: [{ clientUuid: randomUUID(), playerId: p15, status: 'full', minutes: 60 }],
          },
        },
      ]);
      expect(results.map((r) => [r.status, r.error?.code ?? null])).toEqual([
        ['rejected', 'forbidden'],
        ['rejected', 'validation_failed'],
        ['rejected', 'consent_required'],
        ['rejected', 'validation_failed'],
        ['applied', null],
      ]);
      expect(results[1]?.error?.details?.[0]?.path).toEqual(['body', 'mutations', 1, 'op']);
      // The rejected participation of p15NoConsent was rolled back with its savepoint.
      const { rows } = await database.admin.query<{ player_id: string; minutes: number }>(
        'select player_id, minutes from participation where training_session_id = $1',
        [sessionId],
      );
      expect(rows).toEqual([{ player_id: p15, minutes: 60 }]);
    });

    it('rejects a whole push only when the envelope does not match the contract', async () => {
      const response = await push(coachM15, [{ hlc: 'yesterday', op: 'wellness.submit' }]);
      expect(response.statusCode).toBe(400);
    });

    it('applies the same RLS as online: rows of another club are not found', async () => {
      const [result] = await pushOk(adminB, [
        {
          hlc: hlc(42),
          op: 'participation.update',
          target: { clientUuid: wellnessUuid },
          body: { minutes: 10 },
        },
      ]);
      expect(result?.error?.code).toBe('not_found');
    });
  });

  describe('push: training load from the field', () => {
    it('resolves the RPE of the player and the minutes of the coach per field', async () => {
      const { rows } = await database.admin.query<{ id: string }>(
        'select id from participation where training_session_id = $1 and player_id = $2',
        [sessionId, p15],
      );
      const participationId = rows[0]?.id ?? '';
      const [rpe] = await pushOk(player15, [
        {
          hlc: hlc(50),
          op: 'rpe.submit',
          params: { trainingSessionId: sessionId },
          body: { clientUuid: randomUUID(), rpe: 7 },
        },
      ]);
      expect(rpe).toMatchObject({ status: 'applied', appliedFields: ['rpe'] });
      const results = await pushOk(coachM15, [
        // Older than the batch that loaded the minutes (hlc 41): loses.
        {
          hlc: hlc(39),
          op: 'participation.update',
          target: { id: participationId },
          body: { changeReason: 'Minutos', minutes: 45 },
        },
        // A later batch: the contacts win, the minutes of the same row too.
        {
          hlc: hlc(55),
          op: 'participation.record',
          params: { trainingSessionId: sessionId },
          body: {
            changeReason: 'Corrijo minutos',
            rows: [
              {
                clientUuid: randomUUID(),
                playerId: p15,
                status: 'full',
                minutes: 80,
                contactsN: 12,
              },
            ],
          },
        },
      ]);
      expect(results.map((r) => [r.status, r.appliedFields, r.supersededFields])).toEqual([
        ['superseded', [], ['minutes']],
        ['applied', ['rows.0.status', 'rows.0.minutes', 'rows.0.contactsN'], []],
      ]);
      const { rows: after } = await database.admin.query(
        'select minutes, contacts_n, rpe from participation where id = $1',
        [participationId],
      );
      expect(after[0]).toEqual({ minutes: 80, contacts_n: 12, rpe: 7 });
      // An RPE older than the one already sent loses; the device learns it from the result.
      const [old] = await pushOk(player15, [
        {
          hlc: hlc(45),
          op: 'rpe.submit',
          params: { trainingSessionId: sessionId },
          body: { clientUuid: randomUUID(), rpe: 3, changeReason: 'Vieja' },
        },
      ]);
      expect(old).toMatchObject({ status: 'superseded', supersededFields: ['rpe'] });
    });
  });

  describe('push: test day without connection', () => {
    const resultUuid = randomUUID();

    it('creates a result and lets two evaluators append attempts without conflicts', async () => {
      const results = await pushOk(scM15, [
        {
          hlc: hlc(70, DEVICE_A),
          op: 'test_result.create',
          body: {
            clientUuid: resultUuid,
            status: 'done',
            playerId: p15,
            testDefinitionId: definitions.cmj,
            measuredOn: '2026-03-02',
            method: 'video',
            entries: [{ kind: 'cmj_flight_time', attemptNumber: 1, flightTimeS: 0.5 }],
          },
        },
        {
          hlc: hlc(71, DEVICE_A),
          op: 'test_result.add_entries',
          target: { clientUuid: resultUuid },
          body: {
            entries: [
              {
                clientUuid: randomUUID(),
                kind: 'cmj_flight_time',
                attemptNumber: 2,
                flightTimeS: 0.51,
              },
            ],
          },
        },
        {
          hlc: hlc(71, DEVICE_B),
          op: 'test_result.add_entries',
          target: { clientUuid: resultUuid },
          body: {
            entries: [
              {
                clientUuid: randomUUID(),
                kind: 'cmj_flight_time',
                attemptNumber: 2,
                flightTimeS: 0.49,
              },
            ],
          },
        },
      ]);
      expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);
      // Only what the create authored has a clock: not the empty fields, not the evaluator or
      // the conditions the handler filled in.
      const created = await database.admin.query<{ id: string }>(
        'select id from test_result where client_uuid = $1',
        [resultUuid],
      );
      expect(Object.keys(await clocksOf('test_result', created.rows[0]?.id ?? '')).sort()).toEqual([
        'measured_on',
        'method',
        'status',
      ]);
      const { rows } = await database.admin.query<{ n: number }>(
        `select count(distinct v.entry_id)::int as n from test_result_value v
           join test_result r on r.id = v.test_result_id where r.client_uuid = $1`,
        [resultUuid],
      );
      expect(rows[0]?.n).toBe(3);
    });

    it('resolves the corrections of a result per field', async () => {
      const results = await pushOk(scM15, [
        {
          hlc: hlc(80, DEVICE_B),
          op: 'test_result.update',
          target: { clientUuid: resultUuid },
          body: { notes: 'Viento a favor' },
        },
        {
          hlc: hlc(75, DEVICE_A),
          op: 'test_result.update',
          target: { clientUuid: resultUuid },
          body: { notes: 'Sin viento', changeReason: 'Nota', deviceId: null },
        },
      ]);
      expect(results.map((r) => [r.status, r.appliedFields, r.supersededFields])).toEqual([
        ['applied', ['notes'], []],
        ['applied', ['deviceId'], ['notes']],
      ]);
      const { rows } = await database.admin.query<{ notes: string }>(
        'select notes from test_result where client_uuid = $1',
        [resultUuid],
      );
      expect(rows[0]?.notes).toBe('Viento a favor');
    });
  });

  describe('pull', () => {
    let adminCursor: string;

    it('gives the administration every collection of the club, with the clientUuid of each row', async () => {
      const all = await pullAll(adminA);
      expect(all.reset).toBe(false);
      const byCollection = (c: string) => all.items.filter((i) => i.collection === c);
      expect(byCollection('training_session').map((i) => i.id)).toEqual([sessionId]);
      expect(byCollection('wellness')).toHaveLength(1);
      expect(byCollection('wellness')[0]?.clientUuid).toBe(wellnessUuid);
      expect(byCollection('participation')).toHaveLength(1);
      expect(byCollection('test_result')).toHaveLength(1);
      const result = byCollection('test_result')[0]?.data as { entries: unknown[]; notes: string };
      expect(result.entries).toHaveLength(3);
      expect(result.notes).toBe('Viento a favor');
      // One row, once: the log keeps the last change of each row.
      expect(new Set(all.items.map((i) => i.id)).size).toBe(all.items.length);
      adminCursor = all.cursor;
    });

    it('pages by cursor with the same result as one page', async () => {
      const one = await pullAll(adminA, { limit: 500 });
      const paged = await pullAll(adminA, { limit: 1 });
      expect(paged.pages).toBeGreaterThan(2);
      expect(paged.items.map((i) => i.id)).toEqual(one.items.map((i) => i.id));
    });

    it('returns nothing new, and the same cursor position, when nothing changed', async () => {
      const page = await pullOk(adminA, `?cursor=${adminCursor}`);
      expect(page.items).toEqual([]);
      expect(page.hasMore).toBe(false);
      expect(page.cursor).toBe(adminCursor);
    });

    it('scopes each role as its lists do', async () => {
      const player = await pullAll(player15);
      expect(new Set(player.items.map((i) => i.collection))).toEqual(
        new Set(['wellness', 'participation', 'test_result']),
      );
      const page = await pullOk(player15);
      expect(page.collections).toEqual(['wellness', 'participation', 'test_result']);

      const coach = await pullAll(coachM15);
      expect(new Set(coach.items.map((i) => i.collection))).toEqual(
        new Set(['wellness', 'participation', 'training_session', 'test_result']),
      );
      // Not their category: nothing of p15 and not the m15 session.
      const other = await pullAll(coachM13);
      expect(other.items).toEqual([]);

      const parent = await pullOk(parent15);
      expect(parent).toMatchObject({ items: [], collections: [] });

      const clubBAdmin = await pullAll(adminB);
      expect(clubBAdmin.items).toEqual([]);
    });

    it('filters by the collections asked for', async () => {
      const only = await pullAll(adminA, { collections: 'training_session' });
      expect(only.items.map((i) => i.collection)).toEqual(['training_session']);
      const bad = await pull(adminA, '?collections=gym_set');
      expect(bad.statusCode).toBe(400);
    });

    it('brings the changes after the cursor, as tombstones when a row is gone', async () => {
      const before = await pullAll(adminA);
      await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${sessionId}/archive`,
        headers: adminA.headers,
      });
      // Deleting is the owner's (account erasure, B-329): it travels as a tombstone.
      const deleted = await database.admin.query<{ id: string }>(
        `insert into wellness (club_id, player_id, local_date, item_count, sleep, fatigue, soreness, stress, mood)
         values ($1, $2, '2026-01-10', 5, 3, 3, 3, 3, 3) returning id`,
        [clubA, p15],
      );
      const goneId = deleted.rows[0]?.id ?? '';
      await database.admin.query('delete from wellness where id = $1', [goneId]);
      const after = await pullAll(adminA, { cursor: before.cursor });
      expect(after.items.map((i) => [i.collection, i.op])).toEqual([
        ['training_session', 'upsert'],
        ['wellness', 'delete'],
      ]);
      expect((after.items[0]?.data as { archivedAt: string | null }).archivedAt).not.toBeNull();
      expect(after.items[1]).toMatchObject({ id: goneId, clientUuid: null, data: null });
      await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${sessionId}/restore`,
        headers: adminA.headers,
      });
    });

    it('never skips a transaction that commits after a later one', async () => {
      const start = await pullAll(adminA);
      const { rows } = await database.admin.query<{ id: string }>(
        'select id from wellness where client_uuid = $1',
        [wellnessUuid],
      );
      const wellnessId = rows[0]?.id ?? '';
      const slow = await database.admin.connect();
      try {
        await slow.query('begin');
        await slow.query('update wellness set stress = 2 where id = $1', [wellnessId]);
        // A later transaction commits first.
        await database.admin.query('update training_session set notes = $1 where id = $2', [
          'Cambio rápido',
          sessionId,
        ]);
        const meanwhile = await pullAll(adminA, { cursor: start.cursor, settle: false });
        // Neither shows up while the older transaction runs: nothing can be skipped.
        expect(meanwhile.items).toEqual([]);
        await slow.query('commit');
      } finally {
        slow.release();
      }
      const later = await pullAll(adminA, { cursor: start.cursor });
      expect(later.items.map((i) => i.collection).sort()).toEqual(['training_session', 'wellness']);
    });

    it('resets the cursor when what the caller sees changed', async () => {
      const first = await pullAll(coachM13);
      expect(first.items).toEqual([]);
      await assign(coachM13Membership, categories.m15 ?? '');
      const again = await pullOk(coachM13, `?cursor=${first.cursor}`);
      expect(again.reset).toBe(true);
      // From the beginning: the history of the players now in their view.
      expect(again.items.some((i) => i.collection === 'wellness')).toBe(true);
      const next = await pullOk(coachM13, `?cursor=${again.cursor}&limit=500`);
      expect(next.reset).toBe(false);
    });

    it('rejects a malformed cursor or one of another club', async () => {
      expect((await pull(adminA, '?cursor=bm9wZQ')).statusCode).toBe(400);
      const theirs = await pullOk(adminB);
      const response = await pull(adminA, `?cursor=${theirs.cursor}`);
      expect(response.statusCode).toBe(400);
    });

    it('logs the change of a value under its result', async () => {
      const { rows } = await database.admin.query<{ n: number }>(
        `select count(*)::int as n from sync_change where club_id = $1 and collection = 'test_result'`,
        [clubA],
      );
      expect(rows[0]?.n).toBe(1);
      expect(p13).not.toBe('');
      expect(clubB).not.toBe(clubA);
    });
  });

  describe('concurrency, checks of superseded edits and scope of the log', () => {
    let raceSessionId: string;

    /** Waits until some query of this database waits for a lock (the push behind `slow`). */
    async function lockWaiter(): Promise<void> {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const { rows } = await database.admin.query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'`,
        );
        if ((rows[0]?.n ?? 0) > 0) return;
        if (Date.now() > deadline) throw new Error('the push never waited for the lock');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }

    async function createSession(categoryId: string, startsAt: Date): Promise<string> {
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/training-sessions',
        headers: adminA.headers,
        payload: {
          kind: 'training',
          categoryId,
          startsAt: startsAt.toISOString(),
          plannedDurationMin: 60,
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json<{ id: string }>().id;
    }

    beforeAll(async () => {
      raceSessionId = await createSession(categories.m15 ?? '', new Date(Date.now() - 60 * 60_000));
    });

    it('never lets an older batch overwrite a newer one that committed while it was resolved', async () => {
      const record = (step: number, minutes: number): Mutation => ({
        hlc: hlc(step),
        op: 'participation.record',
        params: { trainingSessionId: raceSessionId },
        body: {
          changeReason: 'Minutos de la cancha',
          rows: [{ clientUuid: randomUUID(), playerId: p15, status: 'full', minutes }],
        },
      });
      const [created] = await pushOk(coachM15, [record(100, 50)]);
      expect(created?.status).toBe('applied');
      const { rows } = await database.admin.query<{ id: string }>(
        'select id from participation where training_session_id = $1 and player_id = $2',
        [raceSessionId, p15],
      );
      const participationId = rows[0]?.id ?? '';
      // Another push, newer (hlc 120), holds the row: it is writing and has not committed.
      const slow = await database.admin.connect();
      let older: Promise<LightMyRequestResponse> | undefined;
      try {
        await slow.query('begin');
        await slow.query(`select set_config('app.sync_hlc', $1, true)`, [hlc(120)]);
        await slow.query('update participation set minutes = 60 where id = $1', [participationId]);
        // The older batch (hlc 110) arrives meanwhile: it waits for the row before reading it.
        older = push(coachM15, [record(110, 40)]);
        await lockWaiter();
        await slow.query('commit');
      } finally {
        slow.release();
      }
      const response = await older;
      expect(response.statusCode, response.body).toBe(200);
      const [result] = response.json<PushBody>().results;
      expect(result).toMatchObject({
        status: 'applied',
        appliedFields: ['rows.0.status'],
        supersededFields: ['rows.0.minutes'],
      });
      const { rows: after } = await database.admin.query(
        'select minutes from participation where id = $1',
        [participationId],
      );
      expect(after[0]).toEqual({ minutes: 60 });
      expect((await clocksOf('participation', participationId)).minutes).toBe(hlc(120));
    });

    it('applies the newest clock even when a concurrent edit changed the version it read', async () => {
      const { rows } = await database.admin.query<{ id: string }>(
        'select id from wellness where client_uuid = $1',
        [wellnessUuid],
      );
      const wellnessId = rows[0]?.id ?? '';
      const slow = await database.admin.connect();
      let newer: Promise<LightMyRequestResponse> | undefined;
      try {
        await slow.query('begin');
        // An online edit (server clock) that has not committed yet.
        await slow.query('update wellness set sleep = 1 where id = $1', [wellnessId]);
        // A clock ahead of the server: brought to the server's time, after the online edit.
        newer = push(player15, [
          {
            hlc: formatHlc({ physicalMs: Date.now() + 3_600_000, counter: 0, node: DEVICE_A }),
            op: 'wellness.correct',
            target: { clientUuid: wellnessUuid },
            body: { changeReason: 'Dormí mejor de lo que cargué', scores: { sleep: 5 } },
          },
        ]);
        await lockWaiter();
        await slow.query('commit');
      } finally {
        slow.release();
      }
      const response = await newer;
      expect(response.statusCode, response.body).toBe(200);
      const [result] = response.json<PushBody>().results;
      expect(result).toMatchObject({ status: 'applied', clamped: true, error: null });
      expect(await wellnessRow(wellnessId)).toMatchObject({ sleep: 5 });
    });

    it('answers the same mutation in two concurrent pushes as applied once and replayed', async () => {
      const mutation: Mutation = {
        mutationId: randomUUID(),
        // Ahead of the server: brought to its time, so it wins over every earlier edit.
        hlc: formatHlc({ physicalMs: Date.now() + 3_600_000, counter: 0, node: DEVICE_B }),
        op: 'wellness.correct',
        target: { clientUuid: wellnessUuid },
        body: { changeReason: 'Reintento por timeout', scores: { mood: 2 } },
      };
      const responses = await Promise.all([push(player15, [mutation]), push(player15, [mutation])]);
      const statuses = responses.map((r) => {
        expect(r.statusCode, r.body).toBe(200);
        return r.json<PushBody>().results[0]?.status;
      });
      expect(statuses.sort()).toEqual(['applied', 'replayed']);
    });

    it('answers a superseded edit of a caller without the permission as online: forbidden', async () => {
      const { rows } = await database.admin.query<{ id: string }>(
        'select id from participation where training_session_id = $1 and player_id = $2',
        [raceSessionId, p15],
      );
      const [result] = await pushOk(scM15, [
        {
          // Older than every clock of the row: it would lose, but it is not theirs to edit.
          hlc: hlc(1),
          op: 'participation.update',
          target: { id: rows[0]?.id },
          body: { changeReason: 'Minutos', minutes: 10 },
        },
      ]);
      expect(result).toMatchObject({ status: 'rejected', error: { code: 'forbidden' } });
      const [mine] = await pushOk(coachM15, [
        {
          hlc: hlc(1),
          op: 'participation.update',
          target: { id: rows[0]?.id },
          body: { changeReason: 'Minutos', minutes: 10 },
        },
      ]);
      expect(mine).toMatchObject({ status: 'superseded', supersededFields: ['minutes'] });
      const { rows: after } = await database.admin.query(
        'select minutes from participation where id = $1',
        [rows[0]?.id],
      );
      expect(after[0]).toEqual({ minutes: 60 });
    });

    it('checks the RPE window when the RPE was recorded, not when it syncs', async () => {
      const startsAt = new Date(Date.now() - 4 * 24 * 60 * 60_000);
      const closedSession = await createSession(categories.m15 ?? '', startsAt);
      const at = (ms: number) => formatHlc({ physicalMs: ms, counter: 0, node: DEVICE_A });
      const results = await pushOk(player15, [
        // Before the session started on the device's clock: not open, as online.
        {
          hlc: at(startsAt.getTime() - 60_000),
          op: 'rpe.submit',
          params: { trainingSessionId: closedSession },
          body: { clientUuid: randomUUID(), rpe: 6 },
        },
        // Recorded inside the window, synced days later: it counts.
        {
          hlc: at(startsAt.getTime() + 90 * 60_000),
          op: 'rpe.submit',
          params: { trainingSessionId: closedSession },
          body: { clientUuid: randomUUID(), rpe: 6 },
        },
      ]);
      expect(results.map((r) => [r.status, r.error?.code ?? null])).toEqual([
        ['rejected', 'conflict'],
        ['applied', null],
      ]);
      // Online, now, the window is closed.
      const online = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${closedSession}/rpe`,
        headers: player15.headers,
        payload: { rpe: 7, changeReason: 'Cambio' },
      });
      expect(online.statusCode, online.body).toBe(409);
    });

    it('edits an RPE resent with the clientUuid of its create, by its clock', async () => {
      const session = await createSession(categories.m15 ?? '', new Date(Date.now() - 60 * 60_000));
      const uuid = randomUUID();
      const rpe = (step: number, value: number, clientUuid = uuid): Mutation => ({
        hlc: hlc(step),
        op: 'rpe.submit',
        params: { trainingSessionId: session },
        body: { clientUuid, rpe: value, changeReason: 'Cambio de RPE' },
      });
      const [created] = await pushOk(player15, [rpe(500, 5)]);
      expect(created).toMatchObject({ status: 'applied' });
      const { rows } = await database.admin.query<{ id: string }>(
        'select id from participation where client_uuid = $1',
        [uuid],
      );
      const participationId = rows[0]?.id ?? '';
      // Another mutation (another mutationId) with the same clientUuid: an edit, not a replay.
      const [edited] = await pushOk(player15, [rpe(560, 8)]);
      expect(edited).toMatchObject({ status: 'applied', appliedFields: ['rpe'] });
      // An RPE older than that edit loses, so the row keeps the newest value with its clock.
      const [older] = await pushOk(player15, [rpe(530, 6, randomUUID())]);
      expect(older).toMatchObject({ status: 'superseded', supersededFields: ['rpe'] });
      const { rows: after } = await database.admin.query(
        'select rpe from participation where id = $1',
        [participationId],
      );
      expect(after[0]).toEqual({ rpe: 8 });
      expect((await clocksOf('participation', participationId)).rpe).toBe(hlc(560));
    });

    it('edits a batch row resent with the clientUuid of its create, by its clock', async () => {
      const session = await createSession(categories.m15 ?? '', new Date(Date.now() - 60 * 60_000));
      const uuid = randomUUID();
      const record = (step: number, minutes: number, clientUuid = uuid): Mutation => ({
        hlc: hlc(step),
        op: 'participation.record',
        params: { trainingSessionId: session },
        body: {
          changeReason: 'Minutos de la cancha',
          rows: [{ clientUuid, playerId: p15, status: 'full', minutes }],
        },
      });
      const [created] = await pushOk(coachM15, [record(500, 60)]);
      expect(created).toMatchObject({ status: 'applied', appliedFields: ['rows.0'] });
      const { rows } = await database.admin.query<{ id: string }>(
        'select id from participation where client_uuid = $1',
        [uuid],
      );
      const participationId = rows[0]?.id ?? '';
      const [edited] = await pushOk(coachM15, [record(560, 45)]);
      expect(edited).toMatchObject({
        status: 'applied',
        appliedFields: ['rows.0.status', 'rows.0.minutes'],
        supersededFields: [],
      });
      const [older] = await pushOk(coachM15, [record(530, 50, randomUUID())]);
      expect(older).toMatchObject({
        status: 'superseded',
        appliedFields: [],
        supersededFields: ['rows.0.status', 'rows.0.minutes'],
      });
      const { rows: after } = await database.admin.query(
        'select minutes, client_uuid from participation where id = $1',
        [participationId],
      );
      // The row keeps the clientUuid it was created with (the pull reconciles by it).
      expect(after[0]).toEqual({ minutes: 45, client_uuid: uuid });
      expect((await clocksOf('participation', participationId)).minutes).toBe(hlc(560));
    });

    it('projects an injured result as unavailable to every role but medical', async () => {
      const medical = await signIn(t, 'medical15@sync-a.example.com');
      await assign(
        await createMembership(database.admin, medical.userId, clubA, 'medical'),
        categories.m15 ?? '',
      );
      const resultUuid = randomUUID();
      const [created] = await pushOk(scM15, [
        {
          hlc: hlc(300),
          op: 'test_result.create',
          body: {
            clientUuid: resultUuid,
            status: 'not_done',
            playerId: p15,
            testDefinitionId: definitions.sprint_40,
            measuredOn: '2026-03-02',
            notDoneReason: 'injured',
            notDoneNote: 'Esguince de tobillo',
          },
        },
      ]);
      expect(created?.status, JSON.stringify(created?.error)).toBe('applied');
      const seen = async (caller: SignedIn) => {
        const all = await pullAll(caller, { collections: 'test_result' });
        const item = all.items.find((i) => i.clientUuid === resultUuid);
        const data = item?.data as { notDoneReason: string; notDoneNote: string | null };
        return [data.notDoneReason, data.notDoneNote];
      };
      for (const caller of [adminA, scM15, coachM15, player15]) {
        expect(await seen(caller)).toEqual(['unavailable', null]);
      }
      expect(await seen(medical)).toEqual(['injured', 'Esguince de tobillo']);
    });

    it('gives the tombstone of a session only to who sees its category', async () => {
      const coachStart = await pullAll(coachM15, { collections: 'training_session' });
      const adminStart = await pullAll(adminA, { collections: 'training_session' });
      const m13Session = await createSession(
        categories.m13 ?? '',
        new Date(Date.now() - 30 * 60_000),
      );
      await database.admin.query('delete from training_session where id = $1', [m13Session]);
      const coach = await pullAll(coachM15, {
        cursor: coachStart.cursor,
        collections: 'training_session',
      });
      expect(coach.items.map((i) => i.id)).not.toContain(m13Session);
      const admin = await pullAll(adminA, {
        cursor: adminStart.cursor,
        collections: 'training_session',
      });
      expect(admin.items).toContainEqual(expect.objectContaining({ id: m13Session, op: 'delete' }));
      // Not even the id through the log's policy.
      const { rows } = await database.admin.query<{ n: number }>(
        `select count(*)::int as n from sync_change where row_id = $1 and category_id = $2`,
        [m13Session, categories.m13],
      );
      expect(rows[0]?.n).toBe(1);
    });

    /** Ids and ops of the changes of `collection` after `cursor`, for `id`. */
    async function changesOf(
      caller: SignedIn,
      cursor: string,
      collection: string,
      id: string,
    ): Promise<{ ops: string[]; reset: boolean; cursor: string }> {
      const page = await pullAll(caller, { cursor, collections: collection });
      return {
        ops: page.items.filter((i) => i.id === id).map((i) => i.op),
        reset: page.reset,
        cursor: page.cursor,
      };
    }

    it('takes a session moved to another category away from the staff of the old one', async () => {
      const coachM13Only = await signIn(t, 'coach13-only@sync-a.example.com');
      await assign(
        await createMembership(database.admin, coachM13Only.userId, clubA, 'coach'),
        categories.m13 ?? '',
      );
      const moving = await createSession(categories.m15 ?? '', new Date(Date.now() - 20 * 60_000));
      await settled();
      const m15 = await pullAll(coachM15, { collections: 'training_session' });
      expect(m15.items).toContainEqual(expect.objectContaining({ id: moving, op: 'upsert' }));
      const m13 = await pullAll(coachM13Only, { collections: 'training_session' });
      expect(m13.items.map((i) => i.id)).not.toContain(moving);
      const admin = await pullAll(adminA, { collections: 'training_session' });

      await database.admin.query('update training_session set category_id = $1 where id = $2', [
        categories.m13,
        moving,
      ]);
      // The staff of the old category gets a delete, without a reset; the new one, the row.
      const oldStaff = await changesOf(coachM15, m15.cursor, 'training_session', moving);
      expect(oldStaff).toMatchObject({ ops: ['delete'], reset: false });
      const newStaff = await changesOf(coachM13Only, m13.cursor, 'training_session', moving);
      expect(newStaff).toMatchObject({ ops: ['upsert'], reset: false });
      // Who sees both categories gets the row once, never a delete.
      const club = await changesOf(adminA, admin.cursor, 'training_session', moving);
      expect(club).toMatchObject({ ops: ['upsert'], reset: false });

      // Back to M15 and then, without a pull in between, on to M14: every staff that saw it on
      // the way gets it out of their view, whatever happened after.
      await database.admin.query('update training_session set category_id = $1 where id = $2', [
        categories.m15,
        moving,
      ]);
      await database.admin.query('update training_session set category_id = $1 where id = $2', [
        categories.m14,
        moving,
      ]);
      expect((await changesOf(coachM15, oldStaff.cursor, 'training_session', moving)).ops).toEqual([
        'delete',
      ]);
      expect(
        (await changesOf(coachM13Only, newStaff.cursor, 'training_session', moving)).ops,
      ).toEqual(['delete']);
      expect((await changesOf(adminA, club.cursor, 'training_session', moving)).ops).toEqual([
        'upsert',
      ]);
      // One entry per category it was in: the live one and the marks of the others.
      const { rows } = await database.admin.query<{ category_id: string; deleted: boolean }>(
        'select category_id, deleted from sync_change where row_id = $1 order by txid, seq',
        [moving],
      );
      expect(rows).toEqual([
        { category_id: categories.m13, deleted: true },
        { category_id: categories.m15, deleted: true },
        { category_id: categories.m14, deleted: false },
      ]);
    });

    it('takes a test day moved to another category away from the staff of the old one', async () => {
      const created = await database.admin.query<{ id: string }>(
        `insert into test_session (club_id, sport, category_id, scheduled_on)
         values ($1, 'rugby', $2, '2026-03-02') returning id`,
        [clubA, categories.m15],
      );
      const day = created.rows[0]?.id ?? '';
      await settled();
      const sc = await pullAll(scM15, { collections: 'test_session' });
      expect(sc.items).toContainEqual(expect.objectContaining({ id: day, op: 'upsert' }));
      const admin = await pullAll(adminA, { collections: 'test_session' });
      await database.admin.query('update test_session set category_id = $1 where id = $2', [
        categories.m13,
        day,
      ]);
      expect(await changesOf(scM15, sc.cursor, 'test_session', day)).toMatchObject({
        ops: ['delete'],
        reset: false,
      });
      expect((await changesOf(adminA, admin.cursor, 'test_session', day)).ops).toEqual(['upsert']);
    });

    it('keeps the field clocks of a row whose scope changed with its new entry', async () => {
      const { rows } = await database.admin.query<{ id: string; player_id: string }>(
        'select id, player_id from wellness where client_uuid = $1',
        [wellnessUuid],
      );
      const entry = rows[0];
      const before = await clocksOf('wellness', entry?.id ?? '');
      expect(Object.keys(before)).not.toHaveLength(0);
      const cursor = (await pullAll(coachM15, { collections: 'wellness' })).cursor;
      // Not something the API does: a row handed to another player by hand.
      await database.admin.query('update wellness set player_id = $1 where id = $2', [
        p15NoConsent,
        entry?.id,
      ]);
      try {
        expect(await clocksOf('wellness', entry?.id ?? '')).toEqual(before);
        // Both players are in the coach's view: the row is still there.
        expect((await changesOf(coachM15, cursor, 'wellness', entry?.id ?? '')).ops).toEqual([
          'upsert',
        ]);
      } finally {
        await database.admin.query('update wellness set player_id = $1 where id = $2', [
          entry?.player_id,
          entry?.id,
        ]);
      }
    });

    it('resets the cursor of the staff when a player leaves their category', async () => {
      const leaving = await insertPlayer(clubA, categories.m15 ?? '', '2011-09-01');
      await settled();
      const start = await pullAll(coachM15, { collections: 'wellness' });
      await database.admin.query(
        `update player_category set valid_to = '2020-01-02' where player_id = $1`,
        [leaving],
      );
      const after = await pullOk(coachM15, `?cursor=${start.cursor}&collections=wellness`);
      expect(after.reset).toBe(true);
    });
  });

  describe('push: a default or an empty field never wins over what someone entered', () => {
    async function freshSession(): Promise<string> {
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/training-sessions',
        headers: adminA.headers,
        payload: {
          kind: 'training',
          categoryId: categories.m15,
          startsAt: new Date(BASE_MS - 40 * 60_000).toISOString(),
          plannedDurationMin: 60,
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json<{ id: string }>().id;
    }

    async function participationOf(session: string) {
      const { rows } = await database.admin.query<{
        id: string;
        status: string;
        minutes: number | null;
        contacts_n: number | null;
        rpe: number | null;
      }>(
        `select id, status, minutes, contacts_n, rpe from participation
          where training_session_id = $1 and player_id = $2`,
        [session, p15],
      );
      return rows[0];
    }

    const coachBatch = (session: string, step: number) => ({
      hlc: hlc(step, DEVICE_B),
      op: 'participation.record',
      params: { trainingSessionId: session },
      body: {
        // The planned minutes the RPE filled in are a submitted value: the online rule asks a
        // reason to change them (ADR 0037), offline too.
        changeReason: 'Minutos de la planilla',
        rows: [
          { clientUuid: randomUUID(), playerId: p15, status: 'partial', minutes: 40, contactsN: 5 },
        ],
      },
    });

    const playerRpe = (session: string, step: number, rpe = 6) => ({
      hlc: hlc(step),
      op: 'rpe.submit',
      params: { trainingSessionId: session },
      body: { clientUuid: randomUUID(), rpe },
    });

    it('lets the coach load recorded earlier win over the defaults of an offline RPE', async () => {
      const session = await freshSession();
      const [rpe] = await pushOk(player15, [playerRpe(session, 100)]);
      expect(rpe?.status).toBe('applied');
      const created = await participationOf(session);
      expect(created).toMatchObject({ status: 'full', minutes: 60, rpe: 6 });
      // Only the RPE was entered: the status and the planned minutes have no clock.
      expect(await clocksOf('participation', created?.id ?? '')).toEqual({ rpe: hlc(100) });
      const [batch] = await pushOk(coachM15, [coachBatch(session, 80)]);
      expect(batch).toMatchObject({ status: 'applied', supersededFields: [] });
      expect(await participationOf(session)).toMatchObject({
        status: 'partial',
        minutes: 40,
        contacts_n: 5,
        rpe: 6,
      });
    });

    it('lets the coach load recorded earlier win over the defaults of an online RPE', async () => {
      const session = await freshSession();
      const online = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${session}/rpe`,
        headers: player15.headers,
        payload: { rpe: 7 },
      });
      expect(online.statusCode, online.body).toBe(200);
      const [batch] = await pushOk(coachM15, [coachBatch(session, 80)]);
      expect(batch).toMatchObject({ status: 'applied', supersededFields: [] });
      expect(await participationOf(session)).toMatchObject({
        status: 'partial',
        minutes: 40,
        rpe: 7,
      });
    });

    it('lets an RPE recorded earlier win over the empty RPE of an offline batch', async () => {
      const session = await freshSession();
      const [batch] = await pushOk(coachM15, [
        {
          hlc: hlc(200, DEVICE_B),
          op: 'participation.record',
          params: { trainingSessionId: session },
          body: {
            rows: [{ clientUuid: randomUUID(), playerId: p15, status: 'full', minutes: 50 }],
          },
        },
      ]);
      expect(batch?.status).toBe('applied');
      const created = await participationOf(session);
      expect(await clocksOf('participation', created?.id ?? '')).toEqual({
        status: hlc(200, DEVICE_B),
        minutes: hlc(200, DEVICE_B),
      });
      const [rpe] = await pushOk(player15, [playerRpe(session, 150)]);
      expect(rpe).toMatchObject({ status: 'applied', appliedFields: ['rpe'] });
      expect(await participationOf(session)).toMatchObject({ status: 'full', minutes: 50, rpe: 6 });
    });

    it('answers an older load against a later online absent as superseded, not invalid', async () => {
      const session = await freshSession();
      // The administration marks the player absent online: minutes and contacts stay empty,
      // and an empty field of an insert has no clock (nobody wrote it).
      const online = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${session}/participations/batch`,
        headers: adminA.headers,
        payload: { rows: [{ clientUuid: randomUUID(), playerId: p15, status: 'absent' }] },
      });
      expect(online.statusCode, online.body).toBe(200);
      const absent = await participationOf(session);
      expect(absent).toMatchObject({ status: 'absent', minutes: null, contacts_n: null });
      expect(Object.keys(await clocksOf('participation', absent?.id ?? ''))).toEqual(['status']);
      // The coach's offline batch, recorded before: its status loses, and its load goes with it.
      const [batch] = await pushOk(coachM15, [coachBatch(session, 80)]);
      expect(batch).toMatchObject({
        status: 'superseded',
        appliedFields: [],
        supersededFields: ['rows.0.status', 'rows.0.minutes', 'rows.0.contactsN'],
        error: null,
      });
      // An older edit of the load alone loses the same way.
      const [update] = await pushOk(coachM15, [
        {
          hlc: hlc(90, DEVICE_B),
          op: 'participation.update',
          target: { id: absent?.id ?? '' },
          body: { minutes: 40, contactsN: 5 },
        },
      ]);
      expect(update).toMatchObject({
        status: 'superseded',
        appliedFields: [],
        supersededFields: ['minutes', 'contactsN'],
        error: null,
      });
      expect(await participationOf(session)).toMatchObject({
        status: 'absent',
        minutes: null,
        contacts_n: null,
        rpe: null,
      });
      expect(Object.keys(await clocksOf('participation', absent?.id ?? ''))).toEqual(['status']);
      // A batch recorded after the absent (a clock ahead, brought to the server's time) wins
      // with its status, and its load with it.
      const [later] = await pushOk(coachM15, [coachBatch(session, 3600)]);
      expect(later).toMatchObject({
        status: 'applied',
        appliedFields: ['rows.0.status', 'rows.0.minutes', 'rows.0.contactsN'],
        supersededFields: [],
      });
      expect(await participationOf(session)).toMatchObject({
        status: 'partial',
        minutes: 40,
        contacts_n: 5,
      });
    });

    it('lets an RPE recorded earlier win over the empty RPE of an online batch', async () => {
      const session = await freshSession();
      const online = await t.app.inject({
        method: 'POST',
        url: `/v1/training-sessions/${session}/participations/batch`,
        headers: coachM15.headers,
        payload: {
          rows: [{ clientUuid: randomUUID(), playerId: p15, status: 'full', minutes: 50 }],
        },
      });
      expect(online.statusCode, online.body).toBe(200);
      const [rpe] = await pushOk(player15, [playerRpe(session, 150)]);
      expect(rpe).toMatchObject({ status: 'applied', appliedFields: ['rpe'] });
      expect(await participationOf(session)).toMatchObject({ minutes: 50, rpe: 6 });
    });
  });
});
