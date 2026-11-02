/**
 * Clubs, brand, branches, categories and positions end to end (B-313)
 * against Postgres 16, through the real connection roles (ADR 0026): the
 * permission matrix in the handlers (ADR 0025), RLS behind it, the
 * superadmin's audited support access (ADR 0029) and the endpoint
 * conventions (ADR 0032): idempotent creates, versions, archive, cursors.
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
} from '../testing/identity.js';
import { describeWithPostgres } from '../testing/support.js';

interface Envelope {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface ClubBody {
  id: ClubId;
  slug: string;
  name: string;
  shortName: string;
  timeZone: string;
  locale: string;
  colors: { primary: string; secondary: string };
  logoFileId: string | null;
  version: string;
}

interface BranchBody {
  id: string;
  sport: string;
  sex: string;
  archivedAt: string | null;
  version: string;
}

interface CategoryBody {
  id: string;
  sport: string;
  sex: string;
  ageBandCode: string;
  name: string;
  defaultStage: string;
  sortOrder: number;
  archivedAt: string | null;
  version: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Alta del club pedida por la comisión directiva');

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

describeWithPostgres('clubs, branches and categories (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let coachA: SignedIn;
  let playerA: SignedIn;
  let parentA: SignedIn;
  let clubA: ClubBody;
  let clubB: ClubBody;
  let coachM15: string;
  const createClubUuid = randomUUID();

  const registry = (extra: Record<string, string> = {}) => ({
    ...superadmin.headers,
    'x-support-reason': SUPPORT_REASON,
    ...extra,
  });
  const supporting = (clubId: string, extra: Record<string, string> = {}) => ({
    ...superadmin.headers,
    'x-support-club-id': clubId,
    'x-support-reason': SUPPORT_REASON,
    ...extra,
  });

  const createClubPayload = (slug: string, clientUuid?: string) => ({
    ...(clientUuid !== undefined && { clientUuid }),
    slug,
    name: `Club ${slug}`,
    shortName: slug.toUpperCase(),
    colors: { primary: '#F1882A', secondary: '#050505' },
    branches: [
      { sport: 'rugby', sex: 'male' },
      { sport: 'hockey', sex: 'female' },
    ],
  });

  async function categoriesOf(caller: SignedIn, query = ''): Promise<CategoryBody[]> {
    const response = await t.app.inject({ url: `/v1/categories${query}`, headers: caller.headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page<CategoryBody>>().items;
  }

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      // Every request of this file comes from the same IP.
      routeClassLimits: {
        auth: { perIp: { name: 'api_auth_ip', max: 1000, windowS: 60 } },
        write: {
          perIp: { name: 'api_write_ip', max: 10_000, windowS: 60 },
          perUser: { name: 'api_write_user', max: 10_000, windowS: 60 },
        },
      },
    });
    superadmin = await signIn(t, 'soporte@plataforma.example.com');
    // Only an operator connected as the owner turns the flag on (ADR 0026).
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);
    adminA = await signIn(t, 'admin@club-a.example.com');
    adminB = await signIn(t, 'admin@club-b.example.com');
    coachA = await signIn(t, 'coach@club-a.example.com');
    playerA = await signIn(t, 'player@club-a.example.com');
    parentA = await signIn(t, 'parent@club-a.example.com');
    // Migrating a database and six sign-ins: slow when CI runs every package at once.
  }, 60_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('registry of clubs (superadmin)', () => {
    it('creates a club with its branches and seeded configuration, audited', async () => {
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/clubs',
        headers: registry({ 'x-request-id': 'req-create-club-a' }),
        payload: createClubPayload('club-a', createClubUuid),
      });
      expect(response.statusCode, response.body).toBe(201);
      const body = response.json<{ club: ClubBody; branches: BranchBody[] }>();
      clubA = body.club;
      expect(clubA).toMatchObject({
        slug: 'club-a',
        name: 'Club club-a',
        shortName: 'CLUB-A',
        timeZone: 'America/Argentina/Buenos_Aires',
        locale: 'es-AR',
        colors: { primary: '#f1882a', secondary: '#050505' },
        logoFileId: null,
      });
      expect(body.branches.map((b) => `${b.sport}:${b.sex}`)).toEqual([
        'hockey:female',
        'rugby:male',
      ]);
      const seeded = await database.admin.query<{ categories: string; positions: string }>(
        `select (select count(*) from category where club_id = $1) as categories,
                (select count(*) from position where club_id = $1) as positions`,
        [clubA.id],
      );
      expect(seeded.rows[0]).toEqual({ categories: '12', positions: '14' });
      // The registry access and the access to the new club are both on the support log.
      const log = await database.admin.query<{ club_id: string | null; reason: string }>(
        `select club_id, reason from support.access_log where request_id = 'req-create-club-a'
          order by logged_at`,
      );
      expect(log.rows).toEqual([
        { club_id: null, reason: 'Alta del club pedida por la comisión directiva' },
        { club_id: clubA.id, reason: 'Alta del club pedida por la comisión directiva' },
      ]);
    });

    it('replays the same create by clientUuid without duplicating', async () => {
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/clubs',
        headers: registry(),
        payload: createClubPayload('club-a', createClubUuid),
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.headers['x-idempotent-replay']).toBe('true');
      expect(response.json<{ club: ClubBody }>().club.id).toBe(clubA.id);
      const count = await database.admin.query<{ n: string }>(
        `select count(*) as n from club where slug = 'club-a'`,
      );
      expect(count.rows[0]?.n).toBe('1');
    });

    it('answers conflict for a taken slug', async () => {
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/clubs',
        headers: registry(),
        payload: createClubPayload('club-a'),
      });
      expect(response.statusCode).toBe(409);
      expect(errorOf(response).code).toBe('conflict');
    });

    it('needs a superadmin with a support reason', async () => {
      for (const headers of [
        superadmin.headers,
        { ...superadmin.headers, 'x-support-reason': '%E0%A4%A' },
        { ...superadmin.headers, 'x-support-reason': encodeURIComponent('   ') },
        { ...adminA.headers, 'x-support-reason': SUPPORT_REASON },
      ]) {
        const response = await t.app.inject({
          method: 'POST',
          url: '/v1/clubs',
          headers,
          payload: createClubPayload('club-z'),
        });
        expect(response.statusCode, response.body).toBe(403);
        const list = await t.app.inject({ url: '/v1/clubs', headers });
        expect(list.statusCode).toBe(403);
      }
      const anonymous = await t.app.inject({ url: '/v1/clubs' });
      expect(anonymous.statusCode).toBe(401);
    });

    it('lists clubs with cursor pagination, sorting and search', async () => {
      const created = await t.app.inject({
        method: 'POST',
        url: '/v1/clubs',
        headers: registry(),
        payload: { ...createClubPayload('club-b'), branches: [{ sport: 'rugby', sex: 'male' }] },
      });
      expect(created.statusCode, created.body).toBe(201);
      clubB = created.json<{ club: ClubBody }>().club;

      const first = await t.app.inject({ url: '/v1/clubs?limit=1', headers: registry() });
      expect(first.statusCode, first.body).toBe(200);
      const page1 = first.json<Page<ClubBody>>();
      expect(page1.items.map((c) => c.slug)).toEqual(['club-a']);
      expect(page1.nextCursor).not.toBeNull();
      const second = await t.app.inject({
        url: `/v1/clubs?limit=1&cursor=${page1.nextCursor ?? ''}`,
        headers: registry(),
      });
      const page2 = second.json<Page<ClubBody>>();
      expect(page2.items.map((c) => c.slug)).toEqual(['club-b']);
      expect(page2.nextCursor).toBeNull();

      const descending = await t.app.inject({ url: '/v1/clubs?sort=-name', headers: registry() });
      expect(descending.json<Page<ClubBody>>().items.map((c) => c.slug)).toEqual([
        'club-b',
        'club-a',
      ]);
      const search = await t.app.inject({ url: '/v1/clubs?q=B-B', headers: registry() });
      expect(search.json<Page<ClubBody>>().items.map((c) => c.slug)).toEqual(['club-b']);

      // A cursor is only valid for the sort and filters it was made for.
      const reused = await t.app.inject({
        url: `/v1/clubs?limit=1&q=club&cursor=${page1.nextCursor ?? ''}`,
        headers: registry(),
      });
      expect(reused.statusCode).toBe(400);
      expect(errorOf(reused).code).toBe('bad_request');
      const garbage = await t.app.inject({ url: '/v1/clubs?cursor=bm9wZQ', headers: registry() });
      expect(garbage.statusCode).toBe(400);
      const badSort = await t.app.inject({ url: '/v1/clubs?sort=slug', headers: registry() });
      expect(badSort.statusCode).toBe(400);
      expect(errorOf(badSort).code).toBe('validation_failed');
    });

    it('lets members in: memberships and an assignment of the coach', async () => {
      await createMembership(database.admin, adminA.userId, clubA.id, 'admin');
      await createMembership(database.admin, adminB.userId, clubB.id, 'admin');
      const coachMembership = await createMembership(
        database.admin,
        coachA.userId,
        clubA.id,
        'coach',
      );
      await createMembership(database.admin, playerA.userId, clubA.id, 'player');
      await createMembership(database.admin, parentA.userId, clubA.id, 'parent');
      const m15 = await database.admin.query<{ id: string }>(
        `select id from category where club_id = $1 and sport = 'rugby' and age_band_code = 'm15'`,
        [clubA.id],
      );
      coachM15 = m15.rows[0]?.id ?? '';
      await database.admin.query(
        `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
         values ($1, $2, $3, '2020-01-01')`,
        [clubA.id, coachMembership, coachM15],
      );
    });
  });

  describe('club profile and brand', () => {
    it('is readable by every member of the club', async () => {
      for (const caller of [adminA, coachA, playerA, parentA]) {
        const response = await t.app.inject({ url: '/v1/club', headers: caller.headers });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json<ClubBody>().id).toBe(clubA.id);
      }
      const other = await t.app.inject({ url: '/v1/club', headers: adminB.headers });
      expect(other.json<ClubBody>().id).toBe(clubB.id);
    });

    it('lets the admin edit it with the current version, normalizing colors', async () => {
      const current = (
        await t.app.inject({ url: '/v1/club', headers: adminA.headers })
      ).json<ClubBody>();
      const response = await t.app.inject({
        method: 'PATCH',
        url: '/v1/club',
        headers: adminA.headers,
        payload: {
          version: current.version,
          name: 'Club A',
          shortName: 'CA',
          timeZone: 'America/Montevideo',
          colors: { primary: '#00A3E0' },
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      const updated = response.json<ClubBody>();
      expect(updated).toMatchObject({
        name: 'Club A',
        shortName: 'CA',
        timeZone: 'America/Montevideo',
        colors: { primary: '#00a3e0', secondary: '#050505' },
      });
      expect(updated.version).not.toBe(current.version);

      // The version read before the update is stale now.
      const stale = await t.app.inject({
        method: 'PATCH',
        url: '/v1/club',
        headers: adminA.headers,
        payload: { version: current.version, name: 'Otro nombre' },
      });
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale).code).toBe('conflict');
      clubA = updated;
    });

    it('validates the time zone, the locale and the trimmed names', async () => {
      for (const payload of [
        { timeZone: 'Mars/Olympus' },
        { locale: 'en-US' },
        { name: ' Club A' },
        { shortName: 'X'.repeat(17) },
        { colors: { primary: 'orange' } },
        { unknown: true },
      ]) {
        const response = await t.app.inject({
          method: 'PATCH',
          url: '/v1/club',
          headers: adminA.headers,
          payload: { version: clubA.version, ...payload },
        });
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        expect(errorOf(response).code).toBe('validation_failed');
      }
    });

    it('denies the profile to the rest of the staff, and the slug to the admin', async () => {
      for (const caller of [coachA, playerA, parentA]) {
        const response = await t.app.inject({
          method: 'PATCH',
          url: '/v1/club',
          headers: caller.headers,
          payload: { version: clubA.version, name: 'Hackeado' },
        });
        expect(response.statusCode).toBe(403);
        expect(errorOf(response)).toMatchObject({
          code: 'forbidden',
          message: 'You are not allowed to do this',
        });
      }
      const slug = await t.app.inject({
        method: 'PATCH',
        url: '/v1/club',
        headers: adminA.headers,
        payload: { version: clubA.version, slug: 'nuevo-slug' },
      });
      expect(slug.statusCode).toBe(403);
    });

    it('lets a superadmin support the club with a reason, and change its slug', async () => {
      const read = await t.app.inject({
        url: '/v1/club',
        headers: supporting(clubA.id, { 'x-request-id': 'req-support-club-a' }),
      });
      expect(read.statusCode, read.body).toBe(200);
      const log = await database.admin.query<{ club_id: string }>(
        `select club_id from support.access_log where request_id = 'req-support-club-a'`,
      );
      expect(log.rows).toEqual([{ club_id: clubA.id }]);

      const slug = await t.app.inject({
        method: 'PATCH',
        url: '/v1/club',
        headers: supporting(clubA.id),
        payload: { version: read.json<ClubBody>().version, slug: 'club-a2' },
      });
      expect(slug.statusCode, slug.body).toBe(200);
      clubA = slug.json<ClubBody>();
      expect(clubA.slug).toBe('club-a2');

      const withoutReason = await t.app.inject({
        url: '/v1/club',
        headers: { ...superadmin.headers, 'x-support-club-id': clubA.id },
      });
      expect(withoutReason.statusCode).toBe(403);
      // Only a superadmin supports clubs, and never with a membership at the same time.
      for (const headers of [
        { ...adminB.headers, 'x-support-club-id': clubA.id },
        { ...supporting(clubA.id), 'x-membership-id': randomUUID() },
        supporting('not-a-uuid'),
      ]) {
        const response = await t.app.inject({ url: '/v1/club', headers });
        expect(response.statusCode).toBe(403);
      }
      // A club that does not exist is not supported.
      const unknown = await t.app.inject({ url: '/v1/club', headers: supporting(randomUUID()) });
      expect(unknown.statusCode).toBe(403);
    });
  });

  describe('public theme', () => {
    it('serves the brand by slug with the readable inks, before login', async () => {
      const response = await t.app.inject({ url: `/v1/clubs/${clubA.slug}/theme` });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=300');
      expect(response.json()).toEqual({
        clubId: clubA.id,
        slug: 'club-a2',
        name: 'Club A',
        shortName: 'CA',
        logoUrl: null,
        colors: {
          primary: '#00a3e0',
          onPrimary: '#050505',
          secondary: '#050505',
          onSecondary: '#ffffff',
        },
        updatedAt: expect.any(String) as string,
      });
      const missing = await t.app.inject({ url: '/v1/clubs/no-existe/theme' });
      expect(missing.statusCode).toBe(404);
    });

    it('runs anonymous whoever calls: no support access for a signed-in superadmin', async () => {
      for (const headers of [
        { ...superadmin.headers, 'x-request-id': 'req-theme-superadmin' },
        supporting(clubB.id, { 'x-request-id': 'req-theme-supporting' }),
        adminB.headers,
      ]) {
        const response = await t.app.inject({ url: `/v1/clubs/${clubA.slug}/theme`, headers });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json<{ clubId: string }>().clubId).toBe(clubA.id);
      }
      const log = await database.admin.query(
        `select 1 from support.access_log
          where request_id in ('req-theme-superadmin', 'req-theme-supporting')`,
      );
      expect(log.rows).toHaveLength(0);
    });
  });

  describe('branches', () => {
    it('lists them for every member and lets only the administration enable one', async () => {
      const list = await t.app.inject({ url: '/v1/club/branches', headers: coachA.headers });
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json<Page<BranchBody>>().items.map((b) => `${b.sport}:${b.sex}`)).toEqual([
        'hockey:female',
        'rugby:male',
      ]);
      const denied = await t.app.inject({
        method: 'POST',
        url: '/v1/club/branches',
        headers: coachA.headers,
        payload: { sport: 'rugby', sex: 'female' },
      });
      expect(denied.statusCode).toBe(403);
    });

    it('enables a branch and seeds its categories, idempotently', async () => {
      const clientUuid = randomUUID();
      const enable = () =>
        t.app.inject({
          method: 'POST',
          url: '/v1/club/branches',
          headers: adminA.headers,
          payload: { clientUuid, sport: 'rugby', sex: 'female' },
        });
      const response = await enable();
      expect(response.statusCode, response.body).toBe(201);
      const branch = response.json<BranchBody>();
      expect(branch).toMatchObject({ sport: 'rugby', sex: 'female', archivedAt: null });
      expect(await categoriesOf(adminA, '?sport=rugby&sex=female')).toHaveLength(6);

      const again = await enable();
      expect(again.statusCode).toBe(201);
      expect(again.headers['x-idempotent-replay']).toBe('true');
      expect(again.json<BranchBody>().id).toBe(branch.id);

      // Another create of the active branch (another clientUuid, or none) is a conflict.
      for (const payload of [
        { clientUuid: randomUUID(), sport: 'rugby', sex: 'female' },
        { sport: 'rugby', sex: 'female' },
        { sport: 'rugby', sex: 'male' },
      ]) {
        const other = await t.app.inject({
          method: 'POST',
          url: '/v1/club/branches',
          headers: adminA.headers,
          payload,
        });
        expect(other.statusCode, JSON.stringify(payload)).toBe(409);
        expect(errorOf(other).code).toBe('conflict');
        expect(other.headers['x-idempotent-replay']).toBeUndefined();
      }
      expect(await categoriesOf(adminA, '?sport=rugby&sex=female')).toHaveLength(6);
    });

    it('records one support access with the reason of a superadmin enabling a branch', async () => {
      const created = await t.app.inject({
        method: 'POST',
        url: '/v1/clubs',
        headers: registry(),
        payload: { ...createClubPayload('club-c'), branches: [{ sport: 'rugby', sex: 'male' }] },
      });
      expect(created.statusCode, created.body).toBe(201);
      const clubC = created.json<{ club: ClubBody }>().club;
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/club/branches',
        headers: supporting(clubC.id, { 'x-request-id': 'req-enable-branch-c' }),
        payload: { sport: 'hockey', sex: 'female' },
      });
      expect(response.statusCode, response.body).toBe(201);
      const log = await database.admin.query<{ club_id: string; reason: string }>(
        `select club_id, reason from support.access_log where request_id = 'req-enable-branch-c'`,
      );
      expect(log.rows).toEqual([
        { club_id: clubC.id, reason: 'Alta del club pedida por la comisión directiva' },
      ]);
      const seeded = await database.admin.query<{ n: string }>(
        `select count(*) as n from category where club_id = $1 and sport = 'hockey'`,
        [clubC.id],
      );
      expect(seeded.rows[0]?.n).toBe('6');
    });

    it('archives a branch with its categories, and restores it', async () => {
      const branches = (
        await t.app.inject({ url: '/v1/club/branches', headers: adminA.headers })
      ).json<Page<BranchBody>>().items;
      const rugbyFemale = branches.find((b) => b.sport === 'rugby' && b.sex === 'female');
      const archived = await t.app.inject({
        method: 'POST',
        url: `/v1/club/branches/${rugbyFemale?.id ?? ''}/archive`,
        headers: adminA.headers,
      });
      expect(archived.statusCode, archived.body).toBe(200);
      expect(archived.json<BranchBody>().archivedAt).not.toBeNull();
      expect(await categoriesOf(adminA, '?sport=rugby&sex=female')).toHaveLength(0);
      expect(await categoriesOf(adminA, '?sport=rugby&sex=female&status=archived')).toHaveLength(6);

      const enableArchived = await t.app.inject({
        method: 'POST',
        url: '/v1/club/branches',
        headers: adminA.headers,
        payload: { sport: 'rugby', sex: 'female' },
      });
      expect(enableArchived.statusCode).toBe(409);
      const create = await t.app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: adminA.headers,
        payload: { sport: 'rugby', sex: 'female', ageBandCode: 'm15', name: 'M15 B' },
      });
      expect(create.statusCode).toBe(400);
      expect(errorOf(create).details?.[0]?.path).toEqual(['body', 'sport']);
      // Its categories are archived with it, and read-only until restored.
      const [archivedCategory] = await categoriesOf(
        adminA,
        '?sport=rugby&sex=female&status=archived',
      );
      const edit = await t.app.inject({
        method: 'PATCH',
        url: `/v1/categories/${archivedCategory?.id ?? ''}`,
        headers: adminA.headers,
        payload: { version: archivedCategory?.version, name: 'Editada archivada' },
      });
      expect(edit.statusCode, edit.body).toBe(409);
      expect(errorOf(edit).message).toBe('The category is archived: restore it first');

      const restored = await t.app.inject({
        method: 'POST',
        url: `/v1/club/branches/${rugbyFemale?.id ?? ''}/restore`,
        headers: adminA.headers,
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.json<BranchBody>().archivedAt).toBeNull();
      // Archiving twice and restoring twice are no-ops.
      const twice = await t.app.inject({
        method: 'POST',
        url: `/v1/club/branches/${rugbyFemale?.id ?? ''}/restore`,
        headers: adminA.headers,
      });
      expect(twice.statusCode).toBe(200);
      // A branch of another club is not found.
      const foreign = await t.app.inject({
        method: 'POST',
        url: `/v1/club/branches/${rugbyFemale?.id ?? ''}/archive`,
        headers: adminB.headers,
      });
      expect(foreign.statusCode).toBe(404);
    });
  });

  describe('categories', () => {
    it('shows the admin every category and the coach only the assigned ones', async () => {
      const all = await categoriesOf(adminA, '?sport=rugby&sex=male');
      expect(all.map((c) => c.name)).toEqual(['M13', 'M14', 'M15', 'M16', 'M17', 'M19']);
      expect(all.find((c) => c.ageBandCode === 'm15')).toMatchObject({
        defaultStage: 'development',
      });
      const coach = await categoriesOf(coachA);
      expect(coach.map((c) => c.id)).toEqual([coachM15]);

      const other = all.find((c) => c.ageBandCode === 'm17');
      const read = await t.app.inject({
        url: `/v1/categories/${other?.id ?? ''}`,
        headers: coachA.headers,
      });
      expect(read.statusCode).toBe(403);
      const own = await t.app.inject({
        url: `/v1/categories/${coachM15}`,
        headers: coachA.headers,
      });
      expect(own.statusCode).toBe(200);
    });

    it('denies categories to players and parents', async () => {
      for (const caller of [playerA, parentA]) {
        const list = await t.app.inject({ url: '/v1/categories', headers: caller.headers });
        expect(list.statusCode).toBe(403);
        const one = await t.app.inject({
          url: `/v1/categories/${coachM15}`,
          headers: caller.headers,
        });
        expect(one.statusCode).toBe(403);
      }
    });

    it('pages through the categories with a stable order', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query = `?limit=5&sort=-name&status=all${cursor === null ? '' : `&cursor=${cursor}`}`;
        const response: LightMyRequestResponse = await t.app.inject({
          url: `/v1/categories${query}`,
          headers: adminA.headers,
        });
        expect(response.statusCode, response.body).toBe(200);
        const page: Page<CategoryBody> = response.json();
        seen.push(...page.items.map((c) => c.id));
        cursor = page.nextCursor;
      } while (cursor !== null);
      const all = await categoriesOf(adminA, '?limit=100&sort=-name&status=all');
      expect(seen).toEqual(all.map((c) => c.id));
      expect(new Set(seen).size).toBe(18);
    });

    it('creates a category idempotently and rejects a repeated name', async () => {
      const clientUuid = randomUUID();
      const create = (name: string, uuid?: string) =>
        t.app.inject({
          method: 'POST',
          url: '/v1/categories',
          headers: adminA.headers,
          payload: {
            ...(uuid !== undefined && { clientUuid: uuid }),
            sport: 'hockey',
            sex: 'female',
            ageBandCode: 'm16',
            name,
          },
        });
      const first = await create('M16 Desarrollo', clientUuid);
      expect(first.statusCode, first.body).toBe(201);
      const category = first.json<CategoryBody>();
      expect(category).toMatchObject({
        sport: 'hockey',
        sex: 'female',
        ageBandCode: 'm16',
        name: 'M16 Desarrollo',
        defaultStage: 'development',
        sortOrder: 3,
        archivedAt: null,
      });
      const replay = await create('M16 Desarrollo', clientUuid);
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<CategoryBody>().id).toBe(category.id);

      const duplicate = await create('M16 Desarrollo');
      expect(duplicate.statusCode).toBe(409);
      const coach = await t.app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: coachA.headers,
        payload: { sport: 'hockey', sex: 'female', ageBandCode: 'm16', name: 'Otra' },
      });
      expect(coach.statusCode).toBe(403);
    });

    it('updates with the version, archives and restores', async () => {
      const [category] = await categoriesOf(adminA, '?sport=hockey&ageBandCode=m13');
      if (category === undefined) throw new Error('no hockey M13');
      const update = await t.app.inject({
        method: 'PATCH',
        url: `/v1/categories/${category.id}`,
        headers: adminA.headers,
        payload: { version: category.version, name: 'Sub 13', sortOrder: 10 },
      });
      expect(update.statusCode, update.body).toBe(200);
      expect(update.json<CategoryBody>()).toMatchObject({ name: 'Sub 13', sortOrder: 10 });
      const stale = await t.app.inject({
        method: 'PATCH',
        url: `/v1/categories/${category.id}`,
        headers: adminA.headers,
        payload: { version: category.version, name: 'Sub-13' },
      });
      expect(stale.statusCode).toBe(409);
      // The band is fixed: the history of the category stays comparable.
      const band = await t.app.inject({
        method: 'PATCH',
        url: `/v1/categories/${category.id}`,
        headers: adminA.headers,
        payload: { version: update.json<CategoryBody>().version, ageBandCode: 'm14' },
      });
      expect(band.statusCode).toBe(400);

      const archive = await t.app.inject({
        method: 'POST',
        url: `/v1/categories/${category.id}/archive`,
        headers: adminA.headers,
      });
      const archivedCategory = archive.json<CategoryBody>();
      expect(archivedCategory.archivedAt).not.toBeNull();
      const editArchived = await t.app.inject({
        method: 'PATCH',
        url: `/v1/categories/${category.id}`,
        headers: adminA.headers,
        payload: { version: archivedCategory.version, name: 'Sub 13 archivada' },
      });
      expect(editArchived.statusCode).toBe(409);
      expect(errorOf(editArchived).code).toBe('conflict');
      const restore = await t.app.inject({
        method: 'POST',
        url: `/v1/categories/${category.id}/restore`,
        headers: adminA.headers,
      });
      const restored = restore.json<CategoryBody>();
      expect(restored).toMatchObject({ archivedAt: null, name: 'Sub 13' });
      const editRestored = await t.app.inject({
        method: 'PATCH',
        url: `/v1/categories/${category.id}`,
        headers: adminA.headers,
        payload: { version: restored.version, name: 'Sub-13' },
      });
      expect(editRestored.statusCode, editRestored.body).toBe(200);
    });

    it('hides the categories of another club', async () => {
      const read = await t.app.inject({
        url: `/v1/categories/${coachM15}`,
        headers: adminB.headers,
      });
      expect(read.statusCode).toBe(404);
      const update = await t.app.inject({
        method: 'PATCH',
        url: `/v1/categories/${coachM15}`,
        headers: adminB.headers,
        payload: { version: '1', name: 'Robada' },
      });
      expect(update.statusCode).toBe(404);
      const archive = await t.app.inject({
        method: 'POST',
        url: `/v1/categories/${coachM15}/archive`,
        headers: adminB.headers,
      });
      expect(archive.statusCode).toBe(404);
      const list = await categoriesOf(adminB, '?status=all');
      expect(list.map((c) => c.id)).not.toContain(coachM15);
      expect(list).toHaveLength(6);
    });

    it('lets a supporting superadmin manage categories', async () => {
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: supporting(clubB.id),
        payload: { sport: 'rugby', sex: 'male', ageBandCode: 'm19', name: 'M19 B' },
      });
      expect(response.statusCode, response.body).toBe(201);
    });
  });

  describe('positions', () => {
    it('are readable by every member, by sport', async () => {
      const response = await t.app.inject({
        url: '/v1/positions?sport=hockey',
        headers: playerA.headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      const items = response.json<Page<{ sport: string; code: string; lineCode: string }>>().items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((p) => p.sport === 'hockey')).toBe(true);
      const all = await t.app.inject({ url: '/v1/positions?limit=100', headers: playerA.headers });
      expect(all.json<Page<unknown>>().items).toHaveLength(14);
      // Club B only runs rugby: its catalog has no hockey positions.
      const otherClub = await t.app.inject({
        url: '/v1/positions?sport=hockey',
        headers: adminB.headers,
      });
      expect(otherClub.json<Page<unknown>>().items).toHaveLength(0);
    });
  });
});
