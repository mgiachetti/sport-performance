/**
 * The superadmin console's API (B-414, ADR 0066) against Postgres 16: the
 * support access log read by the registry and by the club's administration
 * (through `app.support_access_entries`), and invitations sent by a
 * superadmin supporting a club (the first admin of a new club).
 */
import type { ClubId } from '@sport-performance/domain';
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

interface Entry {
  id: string;
  startedAt: string;
  operator: { userId: string; name: string | null; email: string | null };
  club: { id: string; name: string; slug: string; timeZone: string } | null;
  reason: string;
  requestId: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const reason = (text: string) => encodeURIComponent(text);

function errorCode(response: LightMyRequestResponse): string {
  return response.json<{ error: { code: string } }>().error.code;
}

describeWithPostgres('support access log and support invitations (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let coachA: SignedIn;
  let adminB: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;

  const supporting = (clubId: string, text: string, extra: Record<string, string> = {}) => ({
    ...superadmin.headers,
    'x-support-club-id': clubId,
    'x-support-reason': reason(text),
    ...extra,
  });
  const registry = (text: string) => ({ ...superadmin.headers, 'x-support-reason': reason(text) });

  async function list(url: string, headers: Record<string, string>): Promise<Page<Entry>> {
    const response = await t.app.inject({ url, headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page<Entry>>();
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
    await database.admin.query(
      `update "user" set is_superadmin = true, name = 'Soporte' where id = $1`,
      [superadmin.userId],
    );
    adminA = await signIn(t, 'admin@club-a.example.com');
    coachA = await signIn(t, 'coach@club-a.example.com');
    adminB = await signIn(t, 'admin@club-b.example.com');
    clubA = await createClub(database.admin, 'club-a', 'Club A');
    clubB = await createClub(database.admin, 'club-b', 'Club B');
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, coachA.userId, clubA, 'coach');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');

    // Support accesses: two to club A, one to club B.
    for (const [clubId, text] of [
      [clubA, 'Ticket 1: no ve la M15'],
      [clubA, 'Ticket 2: cambio de escudo'],
      [clubB, 'Ticket 3: alta de categorías'],
    ] as const) {
      const response = await t.app.inject({ url: '/v1/club', headers: supporting(clubId, text) });
      expect(response.statusCode, response.body).toBe(200);
    }
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('GET /v1/support-access (registry)', () => {
    it('lists every access newest first, with the operator, the club and the reason', async () => {
      const page = await list('/v1/support-access', {
        ...registry('Auditoría mensual'),
        'x-request-id': 'req-audit-read',
      });
      expect(page.items[0]).toMatchObject({
        club: null,
        reason: 'Auditoría mensual',
        requestId: 'req-audit-read',
        operator: {
          userId: superadmin.userId,
          name: 'Soporte',
          email: 'soporte@plataforma.example.com',
        },
      });
      const ofClubs = page.items.filter((entry) => entry.club !== null);
      expect(ofClubs.map((entry) => entry.reason)).toEqual([
        'Ticket 3: alta de categorías',
        'Ticket 2: cambio de escudo',
        'Ticket 1: no ve la M15',
      ]);
      expect(ofClubs[0]?.club).toEqual({
        id: clubB,
        name: 'Club B',
        slug: 'club-b',
        timeZone: 'America/Argentina/Buenos_Aires',
      });
    });

    it('filters by club and period, and pages by cursor', async () => {
      const ofA = await list(`/v1/support-access?clubId=${clubA}`, registry('Auditoría'));
      expect(ofA.items.map((entry) => entry.reason)).toEqual([
        'Ticket 2: cambio de escudo',
        'Ticket 1: no ve la M15',
      ]);
      const first = await list(`/v1/support-access?clubId=${clubA}&limit=1`, registry('Pág. 1'));
      expect(first.items.map((entry) => entry.reason)).toEqual(['Ticket 2: cambio de escudo']);
      expect(first.nextCursor).not.toBeNull();
      const second = await list(
        `/v1/support-access?clubId=${clubA}&limit=1&cursor=${first.nextCursor ?? ''}`,
        registry('Pág. 2'),
      );
      expect(second.items.map((entry) => entry.reason)).toEqual(['Ticket 1: no ve la M15']);
      expect(second.nextCursor).toBeNull();
      // A cursor of other filters is refused, never a wrong page.
      const mixed = await t.app.inject({
        url: `/v1/support-access?clubId=${clubB}&limit=1&cursor=${first.nextCursor ?? ''}`,
        headers: registry('Cursor ajeno'),
      });
      expect(mixed.statusCode).toBe(400);
      const future = await list(
        `/v1/support-access?from=${encodeURIComponent('2999-01-01T00:00:00Z')}`,
        registry('Futuro'),
      );
      expect(future.items).toEqual([]);
      const byNobody = await list(
        `/v1/support-access?operatorId=${adminA.userId}`,
        registry('Operador'),
      );
      expect(byNobody.items).toEqual([]);
    });

    it('is only for a superadmin with a reason', async () => {
      for (const headers of [
        superadmin.headers,
        { ...adminA.headers, 'x-support-reason': reason('Curiosidad') },
      ]) {
        const response = await t.app.inject({ url: '/v1/support-access', headers });
        expect(response.statusCode).toBe(403);
        expect(errorCode(response)).toBe('forbidden');
      }
    });
  });

  describe('GET /v1/club/support-access (administration of the club)', () => {
    it('the admin sees who supported the club, and only that club', async () => {
      const page = await list('/v1/club/support-access', adminA.headers);
      expect(page.items.map((entry) => entry.reason)).toEqual([
        'Ticket 2: cambio de escudo',
        'Ticket 1: no ve la M15',
      ]);
      expect(page.items.every((entry) => entry.club?.id === clubA)).toBe(true);
      const ofB = await list('/v1/club/support-access', adminB.headers);
      expect(ofB.items.map((entry) => entry.reason)).toEqual(['Ticket 3: alta de categorías']);
    });

    it('a superadmin supporting the club reads it too (and that read is an access)', async () => {
      const page = await list('/v1/club/support-access', supporting(clubA, 'Revisión'));
      expect(page.items[0]?.reason).toBe('Revisión');
      expect(page.items.every((entry) => entry.club?.id === clubA)).toBe(true);
    });

    it('is refused to the rest of the staff', async () => {
      const response = await t.app.inject({
        url: '/v1/club/support-access',
        headers: coachA.headers,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('invitations by a superadmin supporting the club', () => {
    it('invites the first admin, lists and revokes the invitation', async () => {
      const created = await t.app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: supporting(clubB, 'Alta: primer admin'),
        payload: { email: 'nueva-admin@club-b.example.com', role: 'admin' },
      });
      expect(created.statusCode, created.body).toBe(201);
      const invitationId = created.json<{ invitation: { id: string } }>().invitation.id;

      const listed = await t.app.inject({
        url: '/v1/invitations?status=pending',
        headers: supporting(clubB, 'Alta: primer admin'),
      });
      expect(listed.statusCode, listed.body).toBe(200);
      expect(listed.json<Page<{ id: string; role: string }>>().items).toEqual([
        expect.objectContaining({ id: invitationId, role: 'admin' }),
      ]);
      // The admin of the club sees the invitation the support sent.
      const ofAdmin = await t.app.inject({ url: '/v1/invitations', headers: adminB.headers });
      expect(ofAdmin.json<Page<{ id: string }>>().items.map((i) => i.id)).toContain(invitationId);

      const revoked = await t.app.inject({
        method: 'DELETE',
        url: `/v1/invitations/${invitationId}`,
        headers: supporting(clubB, 'Alta: primer admin'),
      });
      expect(revoked.statusCode, revoked.body).toBe(204);
    });

    it('the rest of the staff still cannot invite', async () => {
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: coachA.headers,
        payload: { email: 'otro@club-a.example.com', role: 'coach' },
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
