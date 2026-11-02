/**
 * Members and staff assignments end to end (B-314) against Postgres 16,
 * through the real connection roles (ADR 0026): the permission matrix in
 * the handlers (ADR 0025), RLS behind it, and the endpoint conventions (ADR
 * 0032). The assignments are what the permission subject of each staff
 * member reads, so the tests check what the staff then sees.
 */
import { randomUUID } from 'node:crypto';
import type { ClubId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCategory,
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

interface AssignmentBody {
  id: string;
  membershipId: string;
  member: { userId: string; name: string; role: string };
  target: { kind: 'category'; categoryId: string } | { kind: 'sport'; sport: string };
  validFrom: string;
  validTo: string | null;
  status: 'upcoming' | 'current' | 'ended';
  version: string;
}

interface MemberBody {
  id: string;
  user: { id: string; name: string; email: string };
  role: string;
  status: 'active' | 'ended';
  startedAt: string;
  endedAt: string | null;
  invitedBy: string | null;
  version: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Ayuda con el staff pedida por el club');

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

/** `YYYY-MM-DD` plus `days`. */
function plusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describeWithPostgres('members and staff assignments (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let admin2A: SignedIn;
  let coachA: SignedIn;
  let scA: SignedIn;
  let medicalA: SignedIn;
  let playerA: SignedIn;
  let adminB: SignedIn;
  let coachB: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let today: string;
  const m = {} as Record<
    'adminA' | 'admin2A' | 'coachA' | 'scA' | 'medicalA' | 'playerA' | 'adminB' | 'coachB',
    string
  >;
  const cat = {} as Record<'m15' | 'm16' | 'm17' | 'b15', string>;

  const supporting = (clubId: string) => ({
    ...superadmin.headers,
    'x-support-club-id': clubId,
    'x-support-reason': SUPPORT_REASON,
  });

  const assign = (caller: Record<string, string>, payload: Record<string, unknown>) =>
    t.app.inject({ method: 'POST', url: '/v1/staff-assignments', headers: caller, payload });

  async function visibleCategories(caller: SignedIn): Promise<string[]> {
    const response = await t.app.inject({
      url: '/v1/categories?limit=100',
      headers: caller.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response
      .json<Page<{ id: string }>>()
      .items.map((c) => c.id)
      .sort();
  }

  async function myAssignments(caller: SignedIn, query = ''): Promise<AssignmentBody[]> {
    const response = await t.app.inject({
      url: `/v1/me/staff-assignments${query}`,
      headers: caller.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page<AssignmentBody>>().items;
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
    admin2A = await signIn(t, 'admin2@club-a.example.com');
    coachA = await signIn(t, 'coach@club-a.example.com');
    scA = await signIn(t, 'sc@club-a.example.com');
    medicalA = await signIn(t, 'medical@club-a.example.com');
    playerA = await signIn(t, 'player@club-a.example.com');
    adminB = await signIn(t, 'admin@club-b.example.com');
    coachB = await signIn(t, 'coach@club-b.example.com');
    await database.admin.query(`update "user" set name = 'Ana Entrenadora' where id = $1`, [
      coachA.userId,
    ]);

    clubA = await createClub(database.admin, 'club-a');
    clubB = await createClub(database.admin, 'club-b');
    m.adminA = await createMembership(database.admin, adminA.userId, clubA, 'admin');
    m.admin2A = await createMembership(database.admin, admin2A.userId, clubA, 'admin');
    m.coachA = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    m.scA = await createMembership(database.admin, scA.userId, clubA, 'sc');
    m.medicalA = await createMembership(database.admin, medicalA.userId, clubA, 'medical');
    m.playerA = await createMembership(database.admin, playerA.userId, clubA, 'player');
    m.adminB = await createMembership(database.admin, adminB.userId, clubB, 'admin');
    m.coachB = await createMembership(database.admin, coachB.userId, clubB, 'coach');
    cat.m15 = await createCategory(database.admin, clubA, 'M15');
    cat.m16 = await createCategory(database.admin, clubA, 'M16');
    cat.m17 = await createCategory(database.admin, clubA, 'M17');
    cat.b15 = await createCategory(database.admin, clubB, 'M15');
    const day = await database.admin.query<{ today: string }>(
      `select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text as today`,
    );
    today = day.rows[0]?.today ?? '';
  }, 180_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('staff assignments', () => {
    let coachM15: AssignmentBody;
    const createUuid = randomUUID();

    it('starts with nothing assigned: the coach sees no category', async () => {
      expect(await visibleCategories(coachA)).toEqual([]);
      expect(await myAssignments(coachA)).toEqual([]);
    });

    it('assigns a coach to a category from the club day, idempotently', async () => {
      const response = await assign(adminA.headers, {
        clientUuid: createUuid,
        membershipId: m.coachA,
        target: { kind: 'category', categoryId: cat.m15 },
      });
      expect(response.statusCode, response.body).toBe(201);
      coachM15 = response.json<AssignmentBody>();
      expect(coachM15).toMatchObject({
        membershipId: m.coachA,
        member: { userId: coachA.userId, name: 'Ana Entrenadora', role: 'coach' },
        target: { kind: 'category', categoryId: cat.m15 },
        validFrom: today,
        validTo: null,
        status: 'current',
      });
      expect(response.headers['x-idempotent-replay']).toBeUndefined();

      const replay = await assign(adminA.headers, {
        clientUuid: createUuid,
        membershipId: m.coachA,
        target: { kind: 'category', categoryId: cat.m15 },
      });
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<AssignmentBody>().id).toBe(coachM15.id);
      const count = await database.admin.query<{ n: string }>(
        'select count(*) as n from staff_assignment where membership_id = $1',
        [m.coachA],
      );
      expect(count.rows[0]?.n).toBe('1');
    });

    it('drives what the coach sees, also for a second category', async () => {
      expect(await visibleCategories(coachA)).toEqual([cat.m15]);
      const second = await assign(adminA.headers, {
        membershipId: m.coachA,
        target: { kind: 'category', categoryId: cat.m16 },
      });
      expect(second.statusCode, second.body).toBe(201);
      expect(await visibleCategories(coachA)).toEqual([cat.m15, cat.m16].sort());
      const own = await myAssignments(coachA);
      expect(own.map((a) => a.target)).toHaveLength(2);
      expect(own.every((a) => a.membershipId === m.coachA)).toBe(true);
    });

    it('assigns the medical staff to a whole sport, only with an enabled branch', async () => {
      const response = await assign(adminA.headers, {
        membershipId: m.medicalA,
        target: { kind: 'sport', sport: 'rugby' },
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json<AssignmentBody>().target).toEqual({ kind: 'sport', sport: 'rugby' });
      expect(await visibleCategories(medicalA)).toEqual([cat.m15, cat.m16, cat.m17].sort());

      const hockey = await assign(adminA.headers, {
        membershipId: m.medicalA,
        target: { kind: 'sport', sport: 'hockey' },
      });
      expect(hockey.statusCode).toBe(400);
      expect(errorOf(hockey).details?.[0]?.path).toEqual(['body', 'target', 'sport']);
    });

    it('rejects overlapping assignments to the same target', async () => {
      const again = await assign(adminA.headers, {
        membershipId: m.coachA,
        target: { kind: 'category', categoryId: cat.m15 },
      });
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).code).toBe('conflict');
      // Overlapping only partly, in the past: still a conflict.
      const past = await assign(adminA.headers, {
        membershipId: m.coachA,
        target: { kind: 'category', categoryId: cat.m15 },
        validFrom: plusDays(today, -30),
        validTo: plusDays(today, 1),
      });
      expect(past.statusCode).toBe(409);
      // A closed range that ends before this one starts is history: fine.
      const history = await assign(adminA.headers, {
        membershipId: m.coachA,
        target: { kind: 'category', categoryId: cat.m15 },
        validFrom: plusDays(today, -60),
        validTo: plusDays(today, -30),
      });
      expect(history.statusCode, history.body).toBe(201);
      expect(history.json<AssignmentBody>().status).toBe('ended');
    });

    it('validates the membership, the target and the range', async () => {
      const cases: [Record<string, unknown>, (string | number)[]][] = [
        [
          { membershipId: m.playerA, target: { kind: 'category', categoryId: cat.m15 } },
          ['body', 'membershipId'],
        ],
        [
          { membershipId: m.adminA, target: { kind: 'category', categoryId: cat.m15 } },
          ['body', 'membershipId'],
        ],
        [
          { membershipId: m.coachB, target: { kind: 'category', categoryId: cat.m15 } },
          ['body', 'membershipId'],
        ],
        [
          { membershipId: m.coachA, target: { kind: 'category', categoryId: cat.b15 } },
          ['body', 'target', 'categoryId'],
        ],
        [
          { membershipId: m.coachA, target: { kind: 'category', categoryId: randomUUID() } },
          ['body', 'target', 'categoryId'],
        ],
        [
          {
            membershipId: m.coachA,
            target: { kind: 'category', categoryId: cat.m17 },
            validFrom: today,
            validTo: today,
          },
          ['body', 'validTo'],
        ],
        [
          {
            membershipId: m.coachA,
            target: { kind: 'category', categoryId: cat.m17 },
            validTo: plusDays(today, -1),
          },
          ['body', 'validTo'],
        ],
        [
          {
            membershipId: m.coachA,
            target: { kind: 'category', categoryId: cat.m17, sport: 'rugby' },
          },
          ['body', 'target'],
        ],
      ];
      for (const [payload, path] of cases) {
        const response = await assign(adminA.headers, payload);
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        expect(errorOf(response).code).toBe('validation_failed');
        expect(errorOf(response).details?.[0]?.path.slice(0, path.length)).toEqual(path);
      }
    });

    it('is managed and listed only by the administration', async () => {
      for (const caller of [coachA, scA, medicalA, playerA]) {
        const create = await assign(caller.headers, {
          membershipId: m.coachA,
          target: { kind: 'category', categoryId: cat.m17 },
        });
        expect(create.statusCode).toBe(403);
        const list = await t.app.inject({ url: '/v1/staff-assignments', headers: caller.headers });
        expect(list.statusCode).toBe(403);
        const one = await t.app.inject({
          url: `/v1/staff-assignments/${coachM15.id}`,
          headers: caller.headers,
        });
        expect(one.statusCode).toBe(403);
        const end = await t.app.inject({
          method: 'POST',
          url: `/v1/staff-assignments/${coachM15.id}/end`,
          headers: caller.headers,
        });
        expect(end.statusCode).toBe(403);
      }
      // Their own list is open to every role (empty when they have none).
      expect(await myAssignments(playerA)).toEqual([]);
    });

    it('lists the club assignments with filters and a cursor', async () => {
      const all = await t.app.inject({
        url: '/v1/staff-assignments?status=all&limit=100',
        headers: adminA.headers,
      });
      expect(all.statusCode, all.body).toBe(200);
      const items = all.json<Page<AssignmentBody>>().items;
      expect(items).toHaveLength(4);
      expect(items.map((a) => a.validFrom)).toEqual([...items.map((a) => a.validFrom)].sort());

      const active = await t.app.inject({
        url: '/v1/staff-assignments',
        headers: adminA.headers,
      });
      expect(active.json<Page<AssignmentBody>>().items).toHaveLength(3);
      const byMember = await t.app.inject({
        url: `/v1/staff-assignments?membershipId=${m.medicalA}`,
        headers: adminA.headers,
      });
      expect(byMember.json<Page<AssignmentBody>>().items.map((a) => a.member.role)).toEqual([
        'medical',
      ]);
      const byCategory = await t.app.inject({
        url: `/v1/staff-assignments?categoryId=${cat.m15}&status=ended`,
        headers: adminA.headers,
      });
      expect(byCategory.json<Page<AssignmentBody>>().items.map((a) => a.status)).toEqual(['ended']);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: LightMyRequestResponse = await t.app.inject({
          url: `/v1/staff-assignments?status=all&limit=1&sort=-createdAt${cursor === null ? '' : `&cursor=${cursor}`}`,
          headers: adminA.headers,
        });
        expect(page.statusCode, page.body).toBe(200);
        const body: Page<AssignmentBody> = page.json();
        seen.push(...body.items.map((a) => a.id));
        cursor = body.nextCursor;
      } while (cursor !== null);
      expect(new Set(seen).size).toBe(4);
      const first = await t.app.inject({
        url: '/v1/staff-assignments?status=all&limit=1&sort=-createdAt',
        headers: adminA.headers,
      });
      const firstCursor = first.json<Page<AssignmentBody>>().nextCursor ?? '';
      const otherFilters = await t.app.inject({
        url: `/v1/staff-assignments?status=current&limit=1&sort=-createdAt&cursor=${firstCursor}`,
        headers: adminA.headers,
      });
      expect(otherFilters.statusCode).toBe(400);
      expect(errorOf(otherFilters).code).toBe('bad_request');
    });

    it('hides the assignments of another club', async () => {
      const one = await t.app.inject({
        url: `/v1/staff-assignments/${coachM15.id}`,
        headers: adminB.headers,
      });
      expect(one.statusCode).toBe(404);
      const list = await t.app.inject({
        url: '/v1/staff-assignments?status=all',
        headers: adminB.headers,
      });
      expect(list.json<Page<AssignmentBody>>().items).toEqual([]);
      const end = await t.app.inject({
        method: 'POST',
        url: `/v1/staff-assignments/${coachM15.id}/end`,
        headers: adminB.headers,
      });
      expect(end.statusCode).toBe(404);
      const patch = await t.app.inject({
        method: 'PATCH',
        url: `/v1/staff-assignments/${coachM15.id}`,
        headers: adminB.headers,
        payload: { version: coachM15.version, validTo: null },
      });
      expect(patch.statusCode).toBe(404);
    });

    it('changes the validity with the current version', async () => {
      const stale = { version: coachM15.version };
      const updated = await t.app.inject({
        method: 'PATCH',
        url: `/v1/staff-assignments/${coachM15.id}`,
        headers: adminA.headers,
        payload: { ...stale, validTo: plusDays(today, 90) },
      });
      expect(updated.statusCode, updated.body).toBe(200);
      const body = updated.json<AssignmentBody>();
      expect(body).toMatchObject({ validTo: plusDays(today, 90), status: 'current' });
      expect(body.version).not.toBe(coachM15.version);

      const conflict = await t.app.inject({
        method: 'PATCH',
        url: `/v1/staff-assignments/${coachM15.id}`,
        headers: adminA.headers,
        payload: { ...stale, validTo: null },
      });
      expect(conflict.statusCode).toBe(409);
      // validFrom past the stored validTo: the merged range is checked.
      const inverted = await t.app.inject({
        method: 'PATCH',
        url: `/v1/staff-assignments/${coachM15.id}`,
        headers: adminA.headers,
        payload: { version: body.version, validFrom: plusDays(today, 91) },
      });
      expect(inverted.statusCode).toBe(400);
      // Back into the ended history range: overlap.
      const overlap = await t.app.inject({
        method: 'PATCH',
        url: `/v1/staff-assignments/${coachM15.id}`,
        headers: adminA.headers,
        payload: { version: body.version, validFrom: plusDays(today, -40) },
      });
      expect(overlap.statusCode).toBe(409);
      coachM15 = body;
    });

    it('ends an assignment today: the coach stops seeing the category at once', async () => {
      const end = () =>
        t.app.inject({
          method: 'POST',
          url: `/v1/staff-assignments/${coachM15.id}/end`,
          headers: adminA.headers,
        });
      const ended = await end();
      expect(ended.statusCode, ended.body).toBe(200);
      expect(ended.json<AssignmentBody>()).toMatchObject({ validTo: today, status: 'ended' });
      expect(await visibleCategories(coachA)).toEqual([cat.m16]);
      const again = await end();
      expect(again.statusCode).toBe(200);
      expect(again.json<AssignmentBody>().version).toBe(ended.json<AssignmentBody>().version);
      // The ended range does not block a new one from today.
      const reassign = await assign(adminA.headers, {
        membershipId: m.coachA,
        target: { kind: 'category', categoryId: cat.m15 },
      });
      expect(reassign.statusCode, reassign.body).toBe(201);
      expect(await visibleCategories(coachA)).toEqual([cat.m15, cat.m16].sort());
    });

    it('cancels an upcoming assignment with an empty range', async () => {
      const upcoming = await assign(adminA.headers, {
        membershipId: m.scA,
        target: { kind: 'category', categoryId: cat.m17 },
        validFrom: plusDays(today, 10),
      });
      expect(upcoming.statusCode, upcoming.body).toBe(201);
      const body = upcoming.json<AssignmentBody>();
      expect(body.status).toBe('upcoming');
      expect(await visibleCategories(scA)).toEqual([]);
      expect((await myAssignments(scA, '?status=upcoming')).map((a) => a.id)).toEqual([body.id]);

      const ended = await t.app.inject({
        method: 'POST',
        url: `/v1/staff-assignments/${body.id}/end`,
        headers: adminA.headers,
      });
      expect(ended.statusCode, ended.body).toBe(200);
      expect(ended.json<AssignmentBody>()).toMatchObject({
        validFrom: plusDays(today, 10),
        validTo: plusDays(today, 10),
        status: 'ended',
      });
      expect(await myAssignments(scA)).toEqual([]);
    });

    it('lets a supporting superadmin assign, and lists nothing as their own', async () => {
      const response = await assign(supporting(clubA), {
        membershipId: m.scA,
        target: { kind: 'category', categoryId: cat.m16 },
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(await visibleCategories(scA)).toEqual([cat.m16]);
      const own = await t.app.inject({
        url: '/v1/me/staff-assignments',
        headers: supporting(clubA),
      });
      expect(own.statusCode, own.body).toBe(200);
      expect(own.json<Page<AssignmentBody>>().items).toEqual([]);
    });
  });

  describe('members', () => {
    /** The first sc membership, ended by the role change. */
    let firstSc = '';

    async function member(id: string): Promise<MemberBody> {
      const response = await t.app.inject({
        url: `/v1/club/members/${id}`,
        headers: adminA.headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json<MemberBody>();
    }

    it('lists the members of the club to the administration only', async () => {
      const list = await t.app.inject({
        url: '/v1/club/members?limit=100&sort=email',
        headers: adminA.headers,
      });
      expect(list.statusCode, list.body).toBe(200);
      const items = list.json<Page<MemberBody>>().items;
      expect(items.map((i) => i.user.email).sort()).toEqual([
        'admin2@club-a.example.com',
        'admin@club-a.example.com',
        'coach@club-a.example.com',
        'medical@club-a.example.com',
        'player@club-a.example.com',
        'sc@club-a.example.com',
      ]);
      expect(items.every((i) => i.status === 'active' && i.endedAt === null)).toBe(true);

      const coaches = await t.app.inject({
        url: '/v1/club/members?role=coach',
        headers: adminA.headers,
      });
      expect(coaches.json<Page<MemberBody>>().items.map((i) => i.id)).toEqual([m.coachA]);
      const search = await t.app.inject({
        url: `/v1/club/members?q=${encodeURIComponent('entrenadora')}`,
        headers: adminA.headers,
      });
      expect(search.json<Page<MemberBody>>().items.map((i) => i.id)).toEqual([m.coachA]);

      for (const caller of [coachA, scA, medicalA, playerA]) {
        const denied = await t.app.inject({ url: '/v1/club/members', headers: caller.headers });
        expect(denied.statusCode).toBe(403);
        const one = await t.app.inject({
          url: `/v1/club/members/${m.coachA}`,
          headers: caller.headers,
        });
        expect(one.statusCode).toBe(403);
      }
      const otherClub = await t.app.inject({
        url: `/v1/club/members/${m.coachA}`,
        headers: adminB.headers,
      });
      expect(otherClub.statusCode).toBe(404);
      const end = await t.app.inject({
        method: 'POST',
        url: `/v1/club/members/${m.coachA}/end`,
        headers: adminB.headers,
      });
      expect(end.statusCode).toBe(404);
    });

    it('changes a role by ending the membership and opening another', async () => {
      firstSc = m.scA;
      const sc = await member(m.scA);
      const stale = await t.app.inject({
        method: 'POST',
        url: `/v1/club/members/${m.scA}/role`,
        headers: adminA.headers,
        payload: { version: '1', role: 'coach' },
      });
      expect(stale.statusCode).toBe(409);

      const changed = await t.app.inject({
        method: 'POST',
        url: `/v1/club/members/${m.scA}/role`,
        headers: adminA.headers,
        payload: { version: sc.version, role: 'coach' },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      const created = changed.json<MemberBody>();
      expect(created).toMatchObject({ role: 'coach', status: 'active', user: { id: scA.userId } });
      expect(created.id).not.toBe(m.scA);
      expect(await member(m.scA)).toMatchObject({ role: 'sc', status: 'ended' });
      // Its assignments ended with it: the new role starts without any.
      expect(await visibleCategories(scA)).toEqual([]);
      const open = await database.admin.query<{ n: string }>(
        `select count(*) as n from staff_assignment
          where membership_id = $1 and (valid_to is null or (valid_to > $2::date and valid_to > valid_from))`,
        [m.scA, today],
      );
      expect(open.rows[0]?.n).toBe('0');

      // An ended membership does not change again; a role it already holds is a conflict.
      const ended = await t.app.inject({
        method: 'POST',
        url: `/v1/club/members/${m.scA}/role`,
        headers: adminA.headers,
        payload: { version: (await member(m.scA)).version, role: 'medical' },
      });
      expect(ended.statusCode).toBe(409);
      await createMembership(database.admin, scA.userId, clubA, 'medical');
      const taken = await t.app.inject({
        method: 'POST',
        url: `/v1/club/members/${created.id}/role`,
        headers: adminA.headers,
        payload: { version: created.version, role: 'medical' },
      });
      expect(taken.statusCode).toBe(409);
      m.scA = created.id;
    });

    it('ends a membership with its assignments, idempotently', async () => {
      const end = () =>
        t.app.inject({
          method: 'POST',
          url: `/v1/club/members/${m.coachA}/end`,
          headers: adminA.headers,
        });
      expect(await visibleCategories(coachA)).not.toEqual([]);
      const ended = await end();
      expect(ended.statusCode, ended.body).toBe(200);
      const body = ended.json<MemberBody>();
      expect(body).toMatchObject({ status: 'ended', role: 'coach' });
      expect(body.endedAt).not.toBeNull();
      const open = await database.admin.query<{ n: string }>(
        `select count(*) as n from staff_assignment
          where membership_id = $1 and (valid_to is null or (valid_to > $2::date and valid_to > valid_from))`,
        [m.coachA, today],
      );
      expect(open.rows[0]?.n).toBe('0');
      // Left without memberships, the member is signed out everywhere (B-333).
      const after = await t.app.inject({ url: '/v1/categories', headers: coachA.headers });
      expect(after.statusCode).toBe(401);
      const sessions = await database.admin.query<{ n: string }>(
        'select count(*) as n from session where user_id = $1',
        [coachA.userId],
      );
      expect(sessions.rows[0]?.n).toBe('0');
      const again = await end();
      expect(again.statusCode).toBe(200);
      expect(again.json<MemberBody>().endedAt).toBe(body.endedAt);

      // An ended membership takes no new assignments.
      const assignEnded = await assign(adminA.headers, {
        membershipId: m.coachA,
        target: { kind: 'category', categoryId: cat.m17 },
      });
      expect(assignEnded.statusCode).toBe(409);

      const list = await t.app.inject({
        url: '/v1/club/members?status=ended',
        headers: adminA.headers,
      });
      expect(
        list
          .json<Page<MemberBody>>()
          .items.map((i) => i.id)
          .sort(),
      ).toEqual([m.coachA, firstSc].sort());
    });

    it('keeps the sessions of a member who still belongs elsewhere', async () => {
      // scA holds a coach and a medical membership: ending one (here by support) signs nobody out.
      const ended = await t.app.inject({
        method: 'POST',
        url: `/v1/club/members/${m.scA}/end`,
        headers: supporting(clubA),
      });
      expect(ended.statusCode, ended.body).toBe(200);
      expect(ended.json<MemberBody>().status).toBe('ended');
      const me = await t.app.inject({ url: '/v1/me/memberships', headers: scA.headers });
      expect(me.statusCode).toBe(200);
      expect(me.json<{ items: { role: string }[] }>().items.map((i) => i.role)).toEqual([
        'medical',
      ]);
      // The medical member has no other membership: support ending it signs them out.
      const medical = await t.app.inject({
        method: 'POST',
        url: `/v1/club/members/${m.medicalA}/end`,
        headers: supporting(clubA),
      });
      expect(medical.statusCode, medical.body).toBe(200);
      const signedOut = await t.app.inject({ url: '/v1/me', headers: medicalA.headers });
      expect(signedOut.statusCode).toBe(401);
    });

    it('keeps the club governable', async () => {
      const own = await member(m.adminA);
      const endOwn = await t.app.inject({
        method: 'POST',
        url: `/v1/club/members/${m.adminA}/end`,
        headers: adminA.headers,
      });
      expect(endOwn.statusCode).toBe(409);
      const demoteOwn = await t.app.inject({
        method: 'POST',
        url: `/v1/club/members/${m.adminA}/role`,
        headers: adminA.headers,
        payload: { version: own.version, role: 'coach' },
      });
      expect(demoteOwn.statusCode).toBe(409);

      // Another admin can be ended while one remains; the last one cannot, not even by support.
      const endSecond = await t.app.inject({
        method: 'POST',
        url: `/v1/club/members/${m.admin2A}/end`,
        headers: adminA.headers,
      });
      expect(endSecond.statusCode, endSecond.body).toBe(200);
      const endLast = await t.app.inject({
        method: 'POST',
        url: `/v1/club/members/${m.adminA}/end`,
        headers: supporting(clubA),
      });
      expect(endLast.statusCode).toBe(409);
      const demoteLast = await t.app.inject({
        method: 'POST',
        url: `/v1/club/members/${m.adminA}/role`,
        headers: supporting(clubA),
        payload: { version: own.version, role: 'coach' },
      });
      expect(demoteLast.statusCode).toBe(409);
    });
  });
});
