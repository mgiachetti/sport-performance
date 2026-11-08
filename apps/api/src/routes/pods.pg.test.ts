/**
 * The pod fleet and its assignment (B-912, ADR 0106) against Postgres 16,
 * through the real connection roles: the registry of devices (superadmin),
 * the fleet (`pod.manage` for `sc` and the administration, `pod.read` for
 * the coach too), loans between clubs, and assignments with the matrix
 * (`data` + `location` consents), the categories with pods, no overlaps
 * (`409`, also from the offline queue, never "last writer wins") and
 * corrections with a reason.
 */
import { randomUUID } from 'node:crypto';
import { formatHlc, type ClubId } from '@sport-performance/domain';
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

interface PodBody {
  id: string;
  serialNumber: string;
  number: number;
  shortId: number;
  status: string;
  keyEpoch: number;
  keysRevokedAt: string | null;
  borrowedFromClubId: string | null;
  version: string;
}

interface AssignmentBody {
  id: string;
  podId: string;
  podNumber: number | null;
  playerId: string;
  startsAt: string;
  endsAt: string | null;
  reprocessRequestedAt: string | null;
  archivedAt: string | null;
  version: string;
}

interface ErrorBody {
  error: { code: string; details?: { path: (string | number)[]; code: string }[] };
}

const SUPPORT_REASON = encodeURIComponent('Alta de pods pedida por el club');

describeWithPostgres('pods (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let sc: SignedIn;
  let coach: SignedIn;
  let medical: SignedIn;
  let parent: SignedIn;
  let admin: SignedIn;
  let adminB: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let m19: string;
  let m15: string;
  let session: string;
  /** M19, with data and location consents. */
  let withConsent: string;
  /** M19, data consent only. */
  let withoutLocation: string;
  /** M19, with consents (a second player for overlaps). */
  let second: string;
  let serials = 0;

  const request = (
    caller: SignedIn,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    url: string,
    payload?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) =>
    t.app.inject({
      method,
      url,
      headers: { ...caller.headers, ...headers },
      ...(payload !== undefined && { payload }),
    });
  const registry = { 'x-support-reason': SUPPORT_REASON };

  async function createClubAs(slug: string): Promise<ClubId> {
    const response = await request(
      superadmin,
      'POST',
      '/v1/clubs',
      {
        slug,
        name: `Club ${slug}`,
        shortName: slug.toUpperCase().slice(0, 16),
        branches: [{ sport: 'rugby', sex: 'male' }],
      },
      registry,
    );
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ club: { id: ClubId } }>().club.id;
  }

  async function categoryOf(clubId: ClubId, band: string): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      'select id from category where club_id = $1 and age_band_code = $2',
      [clubId, band],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`no ${band} category`);
    return id;
  }

  async function newPlayer(categoryId: string, consents: ('data' | 'location')[]) {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, 'Juan', $2, '2009-06-01', 'male', 'rugby', '2020-01-01') returning id`,
      [clubA, `P${randomUUID().slice(0, 6)}`],
    );
    const id = rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from) values ($1, $2, $3, '2020-01-01')`,
      [clubA, id, categoryId],
    );
    if (consents.includes('data')) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by, signed_at)
         values ($1, $2, 'data', '2026-01', 'guardian', $3, now() - interval '1 hour')`,
        [clubA, id, parent.userId],
      );
    }
    if (consents.includes('location')) {
      let doc = (
        await database.admin.query<{ id: string; version: string }>(
          `select id, version from consent_document where club_id = $1 and type = 'location'
            order by published_at desc, id desc limit 1`,
          [clubA],
        )
      ).rows[0];
      doc ??= (
        await database.admin.query<{ id: string; version: string }>(
          `insert into consent_document (club_id, type, version, locale, title, body, published_at)
           values ($1, 'location', '2026-11', 'es-AR', 'Ubicación', 'Texto', now() - interval '1 day')
           returning id, version`,
          [clubA],
        )
      ).rows[0];
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_id, document_version, signer_kind, signed_by, signed_at)
         values ($1, $2, 'location', $3, $4, 'guardian', $5, now() - interval '1 hour')`,
        [clubA, id, doc?.id, doc?.version, parent.userId],
      );
    }
    return id;
  }

  async function newDevice(owner: ClubId): Promise<string> {
    serials += 1;
    const serialNumber = `SPP-${String(1000 + serials)}`;
    const response = await request(
      superadmin,
      'POST',
      '/v1/pod-devices',
      {
        serialNumber: serialNumber.toLowerCase(),
        chipId: (0xabc000 + serials).toString(16).padStart(16, '0'),
        hardwareRevision: 'v0',
        provisioningState: 'provisioned',
        ownerClubId: owner,
      },
      registry,
    );
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json<{ serialNumber: string }>().serialNumber).toBe(serialNumber);
    return serialNumber;
  }

  async function newPod(caller: SignedIn = sc, owner: ClubId = clubA): Promise<PodBody> {
    const serialNumber = await newDevice(owner);
    const response = await request(caller, 'POST', '/v1/pods', {
      serialNumber,
      number: 10 + serials,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<PodBody>();
  }

  const assign = (caller: SignedIn, payload: Record<string, unknown>) =>
    request(caller, 'POST', '/v1/pod-assignments', payload);

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      routeClassLimits: { auth: { perIp: { name: 'api_auth_ip', max: 1000, windowS: 60 } } },
    });
    superadmin = await signIn(t, 'soporte@plataforma.example.com');
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);
    clubA = await createClubAs('pods-a');
    clubB = await createClubAs('pods-b');
    sc = await signIn(t, 'sc@pods-a.example.com');
    coach = await signIn(t, 'coach@pods-a.example.com');
    medical = await signIn(t, 'medical@pods-a.example.com');
    parent = await signIn(t, 'parent@pods-a.example.com');
    admin = await signIn(t, 'admin@pods-a.example.com');
    adminB = await signIn(t, 'admin@pods-b.example.com');
    await createMembership(database.admin, sc.userId, clubA, 'sc');
    const coachMembership = await createMembership(database.admin, coach.userId, clubA, 'coach');
    await createMembership(database.admin, medical.userId, clubA, 'medical');
    await createMembership(database.admin, parent.userId, clubA, 'parent');
    await createMembership(database.admin, admin.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    m19 = await categoryOf(clubA, 'm19');
    m15 = await categoryOf(clubA, 'm15');
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from) values ($1, $2, $3, '2020-01-01')`,
      [clubA, coachMembership, m19],
    );
    withConsent = await newPlayer(m19, ['data', 'location']);
    withoutLocation = await newPlayer(m19, ['data']);
    second = await newPlayer(m19, ['data', 'location']);
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into training_session (club_id, sport, kind, category_id, starts_at, local_date)
       values ($1, 'rugby', 'training', $2, now(), (now() at time zone 'America/Argentina/Buenos_Aires')::date)
       returning id`,
      [clubA, m19],
    );
    session = rows[0]?.id ?? '';
  }, 120_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('registry of devices', () => {
    it('only the superadmin on the registry, with unique serial numbers', async () => {
      const serial = await newDevice(clubA);
      const duplicate = await request(
        superadmin,
        'POST',
        '/v1/pod-devices',
        { serialNumber: serial, chipId: 'ffffffffffff0001', hardwareRevision: 'v0' },
        registry,
      );
      expect(duplicate.statusCode, duplicate.body).toBe(409);
      const list = await request(
        superadmin,
        'GET',
        `/v1/pod-devices?serialNumber=${serial}`,
        undefined,
        registry,
      );
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);
      for (const caller of [admin, sc]) {
        const denied = await request(caller, 'GET', '/v1/pod-devices');
        expect(denied.statusCode, denied.body).toBe(403);
      }
    });
  });

  describe('fleet', () => {
    it('S&C registers a device of the club as a pod, idempotent by clientUuid', async () => {
      const serialNumber = await newDevice(clubA);
      const clientUuid = randomUUID();
      const first = await request(sc, 'POST', '/v1/pods', { clientUuid, serialNumber, number: 7 });
      expect(first.statusCode, first.body).toBe(201);
      const pod = first.json<PodBody>();
      expect(pod).toMatchObject({ serialNumber, number: 7, status: 'active', keyEpoch: 0 });
      expect(pod.shortId).toBeGreaterThanOrEqual(1);
      const again = await request(sc, 'POST', '/v1/pods', { clientUuid, serialNumber, number: 7 });
      expect(again.statusCode).toBe(201);
      expect(again.json<PodBody>().id).toBe(pod.id);
      // The same device again, or the number taken: conflict.
      const twice = await request(sc, 'POST', '/v1/pods', { serialNumber, number: 8 });
      expect(twice.statusCode, twice.body).toBe(409);
      const otherSerial = await newDevice(clubA);
      const taken = await request(sc, 'POST', '/v1/pods', { serialNumber: otherSerial, number: 7 });
      expect(taken.statusCode, taken.body).toBe(409);
      expect(taken.json<ErrorBody>().error.details?.[0]?.path).toEqual(['body', 'number']);
    });

    it('a device of another club is not found; the coach reads but does not manage', async () => {
      const ofB = await newDevice(clubB);
      const missing = await request(sc, 'POST', '/v1/pods', { serialNumber: ofB, number: 99 });
      expect(missing.statusCode, missing.body).toBe(404);
      const serialNumber = await newDevice(clubA);
      const byCoach = await request(coach, 'POST', '/v1/pods', { serialNumber, number: 98 });
      expect(byCoach.statusCode).toBe(403);
      expect((await request(coach, 'GET', '/v1/pods')).statusCode).toBe(200);
      for (const caller of [medical, parent]) {
        expect((await request(caller, 'GET', '/v1/pods')).statusCode).toBe(403);
      }
    });

    it('lost: keys revoked and its assignment ended, also of players S&C does not see; recovered with the next key epoch', async () => {
      const pod = await newPod();
      const created = await assign(coach, { podId: pod.id, playerId: second });
      expect(created.statusCode, created.body).toBe(201);
      const lost = await request(sc, 'POST', `/v1/pods/${pod.id}/missing`, {
        version: pod.version,
        status: 'lost',
      });
      expect(lost.statusCode, lost.body).toBe(200);
      expect(lost.json<PodBody>()).toMatchObject({ status: 'lost' });
      expect(lost.json<PodBody>().keysRevokedAt).not.toBeNull();
      const ended = await request(
        coach,
        'GET',
        `/v1/pod-assignments/${created.json<AssignmentBody>().id}`,
      );
      expect(ended.json<AssignmentBody>().endsAt).not.toBeNull();
      const refused = await assign(coach, { podId: pod.id, playerId: withConsent });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json<ErrorBody>().error.details?.[0]?.code).toBe('pod_not_active');
      const stale = await request(sc, 'POST', `/v1/pods/${pod.id}/recover`, {
        version: pod.version,
      });
      expect(stale.statusCode, stale.body).toBe(409);
      const recovered = await request(sc, 'POST', `/v1/pods/${pod.id}/recover`, {
        version: lost.json<PodBody>().version,
      });
      expect(recovered.json<PodBody>()).toMatchObject({
        status: 'active',
        keyEpoch: 1,
        keysRevokedAt: null,
      });
    });

    it('renumbering needs a reason', async () => {
      const pod = await newPod();
      const noReason = await request(sc, 'PATCH', `/v1/pods/${pod.id}`, {
        version: pod.version,
        number: 500,
      });
      expect(noReason.statusCode, noReason.body).toBe(400);
      const ok = await request(sc, 'PATCH', `/v1/pods/${pod.id}`, {
        version: pod.version,
        number: 500,
        changeReason: 'Chaleco nuevo',
      });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json<PodBody>().number).toBe(500);
    });

    it('turns pods on per category (administration only), at its version', async () => {
      const list = async () =>
        (await request(coach, 'GET', '/v1/pods/categories')).json<{
          items: { categoryId: string; podsEnabled: boolean; version: string }[];
        }>().items;
      const items = await list();
      expect(items.find((c) => c.categoryId === m19)?.podsEnabled).toBe(true);
      const m15Row = items.find((c) => c.categoryId === m15);
      expect(m15Row?.podsEnabled).toBe(false);
      const version = m15Row?.version ?? '';
      expect(
        (await request(sc, 'PUT', `/v1/pods/categories/${m15}`, { version, podsEnabled: true }))
          .statusCode,
      ).toBe(403);
      const on = await request(admin, 'PUT', `/v1/pods/categories/${m15}`, {
        version,
        podsEnabled: true,
      });
      expect(on.statusCode, on.body).toBe(200);
      const stale = await request(admin, 'PUT', `/v1/pods/categories/${m15}`, {
        version,
        podsEnabled: false,
      });
      expect(stale.statusCode).toBe(409);
      await request(admin, 'PUT', `/v1/pods/categories/${m15}`, {
        version: on.json<{ version: string }>().version,
        podsEnabled: false,
      });
    });
  });

  describe('assignments', () => {
    it('the coach of the category assigns with the consents; never twice at once', async () => {
      const pod = await newPod();
      const other = await newPod();
      const created = await assign(coach, {
        podId: pod.id,
        playerId: withConsent,
        trainingSessionId: session,
      });
      expect(created.statusCode, created.body).toBe(201);
      const assignment = created.json<AssignmentBody>();
      expect(assignment).toMatchObject({ podNumber: pod.number, endsAt: null });
      // The same player with another pod, or the same pod with another player: 409.
      const samePlayer = await assign(coach, { podId: other.id, playerId: withConsent });
      expect(samePlayer.statusCode, samePlayer.body).toBe(409);
      expect(samePlayer.json<ErrorBody>().error.details?.[0]?.code).toBe('player_overlap');
      const samePod = await assign(coach, { podId: pod.id, playerId: second });
      expect(samePod.statusCode).toBe(409);
      expect(samePod.json<ErrorBody>().error.details?.[0]?.code).toBe('pod_overlap');
      // Without the location consent: consent_required.
      const noLocation = await assign(coach, { podId: other.id, playerId: withoutLocation });
      expect(noLocation.statusCode, noLocation.body).toBe(403);
      expect(noLocation.json<ErrorBody>().error.code).toBe('consent_required');
      // The medical staff and the guardian never assign nor read.
      // (A player they do not see is not found; one they see is forbidden.)
      for (const caller of [medical, parent]) {
        const denied = await assign(caller, { podId: other.id, playerId: second });
        expect([403, 404]).toContain(denied.statusCode);
      }
      const ended = await request(coach, 'POST', `/v1/pod-assignments/${assignment.id}/end`, {});
      expect(ended.statusCode, ended.body).toBe(200);
      expect(ended.json<AssignmentBody>().endsAt).not.toBeNull();
      const again = await request(coach, 'POST', `/v1/pod-assignments/${assignment.id}/end`, {});
      expect(again.statusCode).toBe(409);
    });

    it('only in categories with pods', async () => {
      const m15Player = await newPlayer(m15, ['data', 'location']);
      const pod = await newPod();
      const refused = await assign(admin, { podId: pod.id, playerId: m15Player });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json<ErrorBody>().error.details?.[0]?.code).toBe('category_not_enabled');
    });

    it('a correction of the range needs a reason and asks to reprocess; a void too', async () => {
      const pod = await newPod();
      const startsAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
      const endsAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
      const created = await assign(coach, { podId: pod.id, playerId: second, startsAt, endsAt });
      expect(created.statusCode, created.body).toBe(201);
      const row = created.json<AssignmentBody>();
      const noReason = await request(coach, 'PATCH', `/v1/pod-assignments/${row.id}`, {
        version: row.version,
        endsAt: new Date(Date.now() - 2.5 * 3_600_000).toISOString(),
      });
      expect(noReason.statusCode, noReason.body).toBe(400);
      const corrected = await request(coach, 'PATCH', `/v1/pod-assignments/${row.id}`, {
        version: row.version,
        endsAt: new Date(Date.now() - 2.5 * 3_600_000).toISOString(),
        changeReason: 'Se cambió de chaleco en el entretiempo',
      });
      expect(corrected.statusCode, corrected.body).toBe(200);
      const after = corrected.json<AssignmentBody>();
      expect(after.reprocessRequestedAt).not.toBeNull();
      const { rows } = await database.admin.query<{ reason: string }>(
        `select reason from change_history where table_name = 'pod_assignment' and record_id = $1`,
        [row.id],
      );
      expect(rows.map((r) => r.reason)).toEqual(['Se cambió de chaleco en el entretiempo']);
      const voided = await request(coach, 'POST', `/v1/pod-assignments/${row.id}/void`, {
        version: after.version,
        changeReason: 'Era otro jugador',
      });
      expect(voided.statusCode, voided.body).toBe(200);
      expect(voided.json<AssignmentBody>().archivedAt).not.toBeNull();
    });

    it('growing an assignment is assigning again: refused once the pod is lost', async () => {
      const pod = await newPod();
      const startsAt = new Date(Date.now() - 5 * 3_600_000).toISOString();
      const endsAt = new Date(Date.now() - 4.5 * 3_600_000).toISOString();
      const created = await assign(coach, {
        podId: pod.id,
        playerId: withConsent,
        startsAt,
        endsAt,
      });
      expect(created.statusCode, created.body).toBe(201);
      const row = created.json<AssignmentBody>();
      const lost = await request(sc, 'POST', `/v1/pods/${pod.id}/missing`, {
        version: pod.version,
        status: 'lost',
      });
      expect(lost.statusCode, lost.body).toBe(200);
      const reopen = await request(coach, 'PATCH', `/v1/pod-assignments/${row.id}`, {
        version: row.version,
        endsAt: null,
        changeReason: 'Siguió con el pod',
      });
      expect(reopen.statusCode, reopen.body).toBe(409);
      expect(reopen.json<ErrorBody>().error.details?.[0]?.code).toBe('pod_not_active');
      // Shrinking it is still allowed.
      const shrink = await request(coach, 'PATCH', `/v1/pod-assignments/${row.id}`, {
        version: row.version,
        endsAt: new Date(Date.now() - 4.75 * 3_600_000).toISOString(),
        changeReason: 'Salió antes',
      });
      expect(shrink.statusCode, shrink.body).toBe(200);
    });

    it('the session shows the consent state of each player', async () => {
      const response = await request(coach, 'GET', `/v1/training-sessions/${session}/pods`);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<{
        podsEnabled: boolean;
        players: { playerId: string; missingConsents: string[]; canAssign: boolean }[];
      }>();
      expect(body.podsEnabled).toBe(true);
      const byId = new Map(body.players.map((p) => [p.playerId, p]));
      expect(byId.get(withConsent)).toMatchObject({ missingConsents: [], canAssign: true });
      expect(byId.get(withoutLocation)).toMatchObject({
        missingConsents: ['location'],
        canAssign: false,
      });
    });
  });

  describe('offline sync', () => {
    const base = Date.now() - 10 * 60_000;
    const hlc = (step: number) =>
      formatHlc({ physicalMs: base + step * 1000, counter: 0, node: '0123456789abcdef' });

    it('the first create wins; an overlapping one is rejected with 409, never last writer wins', async () => {
      const pod = await newPod();
      const other = await newPod();
      const offline = await newPlayer(m19, ['data', 'location']);
      const firstId = randomUUID();
      const push = (mutations: Record<string, unknown>[]) =>
        request(coach, 'POST', '/v1/sync/push', { mutations });
      const startsAt = new Date(Date.now() - 60_000).toISOString();
      const first = {
        mutationId: firstId,
        hlc: hlc(1),
        op: 'pod_assignment.create',
        body: { clientUuid: randomUUID(), podId: pod.id, playerId: offline, startsAt },
      };
      const overlapping = {
        mutationId: randomUUID(),
        hlc: hlc(2),
        op: 'pod_assignment.create',
        body: { clientUuid: randomUUID(), podId: other.id, playerId: offline, startsAt },
      };
      const response = await push([first, overlapping]);
      expect(response.statusCode, response.body).toBe(200);
      const results = response.json<{
        results: { status: string; error: { code: string } | null }[];
      }>().results;
      expect(results.map((r) => r.status)).toEqual(['applied', 'rejected']);
      expect(results[1]?.error?.code).toBe('conflict');
      const replay = await push([first]);
      expect(replay.json<{ results: { status: string }[] }>().results[0]?.status).toBe('replayed');
      // The tablet pulls it, once the pull horizon (the oldest running transaction of the
      // server, shared by every test database) is past the push.
      const deadline = Date.now() + 120_000;
      for (;;) {
        const { rows } = await database.admin.query<{ done: boolean }>(
          `select coalesce(max(txid) < pg_snapshot_xmin(pg_current_snapshot()), true) as done
             from sync_change`,
        );
        if (rows[0]?.done === true) break;
        if (Date.now() > deadline) throw new Error('the pull horizon did not move');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const pulled = await request(coach, 'GET', '/v1/sync/changes?collections=pod_assignment');
      expect(pulled.statusCode, pulled.body).toBe(200);
      const items = pulled.json<{
        items: { collection: string; data: { podId: string } | null }[];
      }>().items;
      expect(items.some((i) => i.collection === 'pod_assignment' && i.data?.podId === pod.id)).toBe(
        true,
      );
    }, 180_000);
  });

  describe('loans', () => {
    it('asked by S&C, accepted by the other administration, returned by either side', async () => {
      const pod = await newPod();
      const lent = await request(sc, 'POST', `/v1/pods/${pod.id}/loans`, {
        borrowerClubSlug: 'pods-b',
      });
      expect(lent.statusCode, lent.body).toBe(201);
      const loan = lent.json<{ id: string; status: string; borrowerClubId: string | null }>();
      expect(loan).toMatchObject({ status: 'pending', borrowerClubId: null });
      // An unknown club gets the same answer: nothing tells whether a slug exists.
      const unknownPod = await newPod();
      const unknown = await request(sc, 'POST', `/v1/pods/${unknownPod.id}/loans`, {
        borrowerClubSlug: 'no-such-club',
      });
      expect(unknown.statusCode, unknown.body).toBe(201);
      expect(unknown.json<{ status: string; borrowerClubId: string | null }>()).toMatchObject({
        status: 'pending',
        borrowerClubId: null,
      });
      expect((await request(sc, 'GET', `/v1/pods/${pod.id}`)).json<PodBody>().status).toBe(
        'active',
      );
      // The other club sees it and accepts it (its administration only).
      const incoming = await request(adminB, 'GET', '/v1/pod-loans/incoming');
      expect(incoming.statusCode, incoming.body).toBe(200);
      expect(incoming.json<{ items: { id: string }[] }>().items.map((l) => l.id)).toContain(
        loan.id,
      );
      expect((await request(sc, 'GET', '/v1/pod-loans/incoming')).statusCode).toBe(403);
      const accepted = await request(
        adminB,
        'POST',
        `/v1/pod-loans/incoming/${loan.id}/accept`,
        {},
      );
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(accepted.json<{ status: string }>().status).toBe('active');
      expect((await request(sc, 'GET', `/v1/pods/${pod.id}`)).json<PodBody>().status).toBe('lent');
      const inB = (await request(adminB, 'GET', '/v1/pods')).json<{ items: PodBody[] }>().items;
      expect(inB.some((p) => p.borrowedFromClubId === clubA && p.number === pod.number)).toBe(true);
      expect((await request(coach, 'POST', `/v1/pod-loans/${loan.id}/end`)).statusCode).toBe(403);
      const returned = await request(adminB, 'POST', `/v1/pod-loans/incoming/${loan.id}/return`);
      expect(returned.statusCode, returned.body).toBe(200);
      expect(returned.json<{ status: string }>().status).toBe('returned');
      const back = (await request(sc, 'GET', `/v1/pods/${pod.id}`)).json<PodBody>();
      expect(back).toMatchObject({ status: 'active', keyEpoch: 1 });
      // The lender cancels the pending one.
      const cancelled = await request(
        sc,
        'POST',
        `/v1/pod-loans/${unknown.json<{ id: string }>().id}/end`,
      );
      expect(cancelled.json<{ status: string }>().status).toBe('cancelled');
    });

    it('the registry never moves a device that is in a fleet', async () => {
      const pod = await newPod();
      const devices = await request(
        superadmin,
        'GET',
        `/v1/pod-devices?serialNumber=${pod.serialNumber}`,
        undefined,
        registry,
      );
      const device = devices.json<{ items: { id: string; version: string }[] }>().items[0];
      const moved = await request(
        superadmin,
        'PATCH',
        `/v1/pod-devices/${device?.id ?? ''}`,
        { version: device?.version, ownerClubId: clubB },
        registry,
      );
      expect(moved.statusCode, moved.body).toBe(409);
    });
  });

  describe('consent revocation', () => {
    it('revoking the location consent ends the pod the player wears', async () => {
      const player = await newPlayer(m19, ['data', 'location']);
      const pod = await newPod();
      const created = await assign(coach, { podId: pod.id, playerId: player });
      expect(created.statusCode, created.body).toBe(201);
      await database.admin.query(
        `update consent set revoked_at = now(), revoked_by = $2 where player_id = $1 and type = 'location'`,
        [player, parent.userId],
      );
      const after = await request(
        coach,
        'GET',
        `/v1/pod-assignments/${created.json<AssignmentBody>().id}`,
      );
      expect(after.json<AssignmentBody>().endsAt).not.toBeNull();
    });
  });
});
