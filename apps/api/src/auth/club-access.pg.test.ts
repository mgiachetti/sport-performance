/**
 * Memberships, the club selector and invitations by link end to end against
 * Postgres 16: the selected membership feeds the tenant context of the
 * request, a club without membership is rejected, and invitations go
 * through their whole lifecycle (expired, reused, wrong email, revoked).
 */
import { defineEndpoint } from '@sport-performance/contracts';
import type { ClubId } from '@sport-performance/domain';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerEndpoint } from '../http/endpoint.js';
import { hashInvitationToken } from '../invitations/tokens.js';
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

interface MembershipBody {
  id: string;
  club: { id: string; slug: string; name: string };
  role: string;
}

/** A `club` endpoint that reports the tenant context its transaction sees. */
const tenantProbe = defineEndpoint({
  method: 'GET',
  path: '/v1/test/tenant',
  summary: 'Tenant context of the request transaction',
  tags: ['system'],
  auth: 'club',
  response: {
    status: 200,
    description: 'Settings',
    schema: z.object({ clubId: z.string(), userId: z.string(), role: z.string() }),
  },
  errors: [],
});

function registerProbe(app: FastifyInstance): void {
  registerEndpoint(app, tenantProbe, {
    transaction: true,
    handler: async (_input, { tx }) => {
      const result = await tx.query<{ club_id: string; user_id: string; role: string }>(
        "select current_setting('app.club_id', true) as club_id, current_setting('app.user_id', true) as user_id, current_setting('app.role', true) as role",
      );
      const row = result.rows[0];
      return { clubId: row?.club_id ?? '', userId: row?.user_id ?? '', role: row?.role ?? '' };
    },
  });
}

describeWithPostgres(
  'club access: memberships, selector and invitations (Postgres)',
  (serverUrl) => {
    let database: TestDatabase;
    let t: IdentityTestApp;
    let orc: ClubId;
    let other: ClubId;
    let admin: SignedIn;
    let adminMembershipId: string;
    let m15: string;
    let m17: string;
    let otherCategory: string;
    let now = new Date();

    beforeAll(async () => {
      database = await createTestDatabase(serverUrl);
      t = await startIdentityApp(database, {
        register: registerProbe,
        now: () => now,
        // Every request of this file comes from the same IP.
        limits: { invitationByIp: { name: 'invitation_ip', max: 1000, windowS: 900 } },
      });
      orc = await createClub(database.admin, 'orc', 'Olivos Rugby Club');
      other = await createClub(database.admin, 'otro', 'Otro Club');
      m15 = await createCategory(database.admin, orc, 'M15');
      m17 = await createCategory(database.admin, orc, 'M17');
      otherCategory = await createCategory(database.admin, other, 'M15');
      admin = await signIn(t, 'admin@orc.example.com');
      await database.admin.query(`update "user" set name = 'Laura Gómez' where id = $1`, [
        admin.userId,
      ]);
      adminMembershipId = await createMembership(database.admin, admin.userId, orc, 'admin');
    });

    afterAll(async () => {
      await t.close();
      await database.drop();
    });

    const asAdmin = (headers: Record<string, string> = {}) => ({ ...admin.headers, ...headers });

    async function invite(
      payload: Record<string, unknown>,
      headers: Record<string, string> = asAdmin(),
    ) {
      return t.app.inject({ method: 'POST', url: '/v1/invitations', headers, payload });
    }

    function tokenOf(response: { json: () => unknown }): string {
      const web = (response.json() as { links: { web: string } }).links.web;
      const token = /\/invite\/([A-Za-z0-9_-]{43})$/.exec(web)?.[1];
      if (token === undefined) throw new Error('no token in the link');
      return token;
    }

    const preview = (token: string) =>
      t.app.inject({ method: 'POST', url: '/v1/invitations/preview', payload: { token } });
    const accept = (token: string, caller: SignedIn) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: caller.headers,
        payload: { token },
      });

    describe('club selector', () => {
      it('lists no memberships and rejects club endpoints for a user without clubs', async () => {
        const lonely = await signIn(t, 'sin-club@example.com');
        const list = await t.app.inject({ url: '/v1/me/memberships', headers: lonely.headers });
        expect(list.json()).toEqual({ items: [] });
        const probe = await t.app.inject({ url: '/v1/test/tenant', headers: lonely.headers });
        expect(probe.statusCode).toBe(403);
        expect(probe.json<Envelope>().error.code).toBe('forbidden');
      });

      it('implies the only membership and feeds it to the tenant context', async () => {
        const probe = await t.app.inject({ url: '/v1/test/tenant', headers: asAdmin() });
        expect(probe.statusCode).toBe(200);
        expect(probe.json()).toEqual({ clubId: orc, userId: admin.userId, role: 'admin' });
        const me = await t.app.inject({ url: '/v1/me', headers: asAdmin() });
        expect(me.json<{ activeMembership: MembershipBody }>().activeMembership).toMatchObject({
          id: adminMembershipId,
          club: { id: orc, slug: 'orc', name: 'Olivos Rugby Club' },
          role: 'admin',
        });
      });

      it('requires a choice with several memberships and honors X-Membership-Id', async () => {
        const multi = await signIn(t, 'multi@example.com');
        const coachOrc = await createMembership(database.admin, multi.userId, orc, 'coach');
        const parentOrc = await createMembership(database.admin, multi.userId, orc, 'parent');
        const scOther = await createMembership(database.admin, multi.userId, other, 'sc');

        const list = await t.app.inject({ url: '/v1/me/memberships', headers: multi.headers });
        const items = list.json<{ items: MembershipBody[] }>().items;
        // By club name, then role in the order of the enum.
        expect(items.map((m) => [m.club.slug, m.role])).toEqual([
          ['orc', 'parent'],
          ['orc', 'coach'],
          ['otro', 'sc'],
        ]);
        expect(new Set(items.map((m) => m.id))).toEqual(new Set([coachOrc, parentOrc, scOther]));

        const unselected = await t.app.inject({ url: '/v1/test/tenant', headers: multi.headers });
        expect(unselected.statusCode).toBe(403);
        expect(unselected.json<Envelope>().error.message).toContain('Select a club');

        for (const [id, clubId, role] of [
          [coachOrc, orc, 'coach'],
          [parentOrc, orc, 'parent'],
          [scOther, other, 'sc'],
        ] as const) {
          const probe = await t.app.inject({
            url: '/v1/test/tenant',
            headers: { ...multi.headers, 'x-membership-id': id.toUpperCase() },
          });
          expect(probe.statusCode).toBe(200);
          expect(probe.json()).toEqual({ clubId, userId: multi.userId, role });
        }
      });

      it('rejects a membership of another user, an ended one and garbage', async () => {
        const intruder = await signIn(t, 'intruso@example.com');
        await createMembership(database.admin, intruder.userId, other, 'player');
        const ended = await createMembership(database.admin, intruder.userId, orc, 'coach');
        await database.admin.query(
          "update membership set started_at = now() - interval '2 days', ended_at = now() - interval '1 day' where id = $1",
          [ended],
        );

        for (const header of [adminMembershipId, ended, 'not-a-uuid']) {
          const probe = await t.app.inject({
            url: '/v1/test/tenant',
            headers: { ...intruder.headers, 'x-membership-id': header },
          });
          expect(probe.statusCode, header).toBe(403);
          expect(probe.json<Envelope>().error.message).toContain('not an active membership');
        }
        // The selector itself keeps working, without an active membership.
        const me = await t.app.inject({
          url: '/v1/me',
          headers: { ...intruder.headers, 'x-membership-id': adminMembershipId },
        });
        expect(me.statusCode).toBe(200);
        expect(me.json<{ activeMembership: unknown }>().activeMembership).toBeNull();
        const list = await t.app.inject({ url: '/v1/me/memberships', headers: intruder.headers });
        expect(list.json<{ items: MembershipBody[] }>().items.map((m) => m.club.slug)).toEqual([
          'otro',
        ]);
      });
    });

    describe('invitations', () => {
      it('creates an invitation, emails the universal link and stores only the token hash', async () => {
        const response = await invite({
          email: 'Coach@Example.com',
          role: 'coach',
          categoryIds: [m17, m15],
        });
        expect(response.statusCode).toBe(201);
        const body = response.json<{
          invitation: {
            id: string;
            email: string;
            role: string;
            status: string;
            categoryIds: string[];
            expiresAt: string;
          };
          links: { app: string; web: string };
        }>();
        expect(body.invitation).toMatchObject({
          email: 'coach@example.com',
          role: 'coach',
          status: 'pending',
        });
        expect(body.invitation.categoryIds).toEqual([m15, m17].sort());
        expect(new Date(body.invitation.expiresAt).getTime() - now.getTime()).toBe(
          7 * 24 * 3600 * 1000,
        );
        const token = tokenOf(response);
        expect(body.links.app).toBe(`sportperformance://invite/${token}`);
        expect(body.links.web).toBe(`https://app.example.com/invite/${token}`);

        const email = t.emails.lastTo('coach@example.com');
        expect(email?.kind).toBe('invitation');
        expect(email?.subject).toBe('Te invitaron a Olivos Rugby Club');
        expect(email?.text).toContain(
          'Laura Gómez te invitó a sumarte a Olivos Rugby Club como Entrenador/a.',
        );
        expect(email?.html).toContain(body.links.web);

        const stored = await database.admin.query<{ token_hash: string }>(
          'select token_hash from invitation where id = $1',
          [body.invitation.id],
        );
        expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(stored.rows[0]?.token_hash).not.toContain(token);
      });

      it('lets only admins manage invitations', async () => {
        const coach = await signIn(t, 'coach-solo@example.com');
        await createMembership(database.admin, coach.userId, orc, 'coach');
        const response = await invite({ email: 'x@example.com', role: 'player' }, coach.headers);
        expect(response.statusCode).toBe(403);
        const list = await t.app.inject({ url: '/v1/invitations', headers: coach.headers });
        expect(list.statusCode).toBe(403);
      });

      it('validates the category scope', async () => {
        const foreign = await invite({
          email: 'x@example.com',
          role: 'coach',
          categoryIds: [m15, otherCategory],
        });
        expect(foreign.statusCode).toBe(400);
        expect(foreign.json<Envelope>().error.details?.map((d) => d.path)).toEqual([
          ['body', 'categoryIds', 1],
        ]);
        const notStaff = await invite({
          email: 'x@example.com',
          role: 'player',
          categoryIds: [m15],
        });
        expect(notStaff.statusCode).toBe(400);
        expect(notStaff.json<Envelope>().error.details?.map((d) => d.path)).toEqual([
          ['body', 'categoryIds'],
        ]);
      });

      it('does not create the invitation when the email cannot be sent', async () => {
        t.emails.failing = true;
        try {
          const response = await invite({ email: 'nunca@example.com', role: 'player' });
          expect(response.statusCode).toBe(503);
        } finally {
          t.emails.failing = false;
        }
        const rows = await database.admin.query(
          "select 1 from invitation where email = 'nunca@example.com'",
        );
        expect(rows.rowCount).toBe(0);
      });

      it('previews publicly, accepts once with the invited email and creates the staff assignments', async () => {
        const response = await invite({
          email: 'nueva@example.com',
          role: 'coach',
          categoryIds: [m15],
        });
        const token = tokenOf(response);

        const seen = await preview(token);
        expect(seen.statusCode).toBe(200);
        expect(seen.json()).toMatchObject({
          club: { id: orc, slug: 'orc', name: 'Olivos Rugby Club' },
          role: 'coach',
          status: 'pending',
          emailHint: 'n***@example.com',
        });

        const stranger = await signIn(t, 'otra-persona@example.com');
        const wrong = await accept(token, stranger);
        expect(wrong.statusCode).toBe(403);
        expect(wrong.json<Envelope>().error.code).toBe('forbidden');

        const anonymous = await t.app.inject({
          method: 'POST',
          url: '/v1/invitations/accept',
          payload: { token },
        });
        expect(anonymous.statusCode).toBe(401);

        const invitee = await signIn(t, 'nueva@example.com');
        const accepted = await accept(token, invitee);
        expect(accepted.statusCode).toBe(200);
        const membership = accepted.json<{ membership: MembershipBody }>().membership;
        expect(membership).toMatchObject({ club: { id: orc }, role: 'coach' });

        const rows = await database.admin.query<{
          invited_by: string;
          category_id: string;
          valid_from: string;
        }>(
          `select m.invited_by, s.category_id, s.valid_from::text
           from membership m join staff_assignment s on s.membership_id = m.id
          where m.id = $1`,
          [membership.id],
        );
        expect(rows.rows).toEqual([
          {
            invited_by: admin.userId,
            category_id: m15,
            valid_from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
          },
        ]);

        // The new membership is the only one: it is implied in the tenant context.
        const probe = await t.app.inject({ url: '/v1/test/tenant', headers: invitee.headers });
        expect(probe.json()).toEqual({ clubId: orc, userId: invitee.userId, role: 'coach' });

        // A retry by the same user (lost response) answers the same membership, unchanged.
        const retried = await accept(token, invitee);
        expect(retried.statusCode).toBe(200);
        expect(retried.json<{ membership: MembershipBody }>().membership.id).toBe(membership.id);
        const assignments = await database.admin.query(
          'select 1 from staff_assignment where membership_id = $1',
          [membership.id],
        );
        expect(assignments.rowCount).toBe(1);

        // Anyone else reusing the link.
        const reused = await accept(token, stranger);
        expect(reused.statusCode).toBe(409);
        expect(reused.json<Envelope>().error.code).toBe('conflict');
        expect((await preview(token)).json()).toMatchObject({ status: 'accepted' });
      });

      it('keeps one open link per email and role, even with concurrent invitations', async () => {
        const responses = await Promise.all(
          [1, 2, 3].map(() => invite({ email: 'Concurrente@Example.com', role: 'sc' })),
        );
        expect(responses.map((r) => r.statusCode)).toEqual([201, 201, 201]);
        const open = await database.admin.query(
          `select 1 from invitation
            where club_id = $1 and email = 'concurrente@example.com' and role = 'sc'
              and accepted_at is null and revoked_at is null`,
          [orc],
        );
        expect(open.rowCount).toBe(1);
      });

      it('does not duplicate an existing membership', async () => {
        const member = await signIn(t, 'ya-miembro@example.com');
        const existing = await createMembership(database.admin, member.userId, orc, 'player');
        const token = tokenOf(await invite({ email: 'ya-miembro@example.com', role: 'player' }));
        const accepted = await accept(token, member);
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json<{ membership: MembershipBody }>().membership.id).toBe(existing);
      });

      it('rejects an expired invitation', async () => {
        const token = tokenOf(
          await invite({ email: 'tarde@example.com', role: 'player', expiresInDays: 1 }),
        );
        const late = await signIn(t, 'tarde@example.com');
        // The API reports the state with its clock; accepting checks it with the database's.
        const previous = now;
        now = new Date(previous.getTime() + 2 * 24 * 3600 * 1000);
        try {
          expect((await preview(token)).json()).toMatchObject({ status: 'expired' });
        } finally {
          now = previous;
        }
        await database.admin.query(
          `update invitation set created_at = now() - interval '2 days', expires_at = now() - interval '1 second'
            where token_hash = $1`,
          [hashInvitationToken(token)],
        );
        const response = await accept(token, late);
        expect(response.statusCode).toBe(409);
        expect(response.json<Envelope>().error.message).toContain('expired');
      });

      it('revokes: the link stops working, revoking again is a no-op', async () => {
        const response = await invite({ email: 'revocada@example.com', role: 'parent' });
        const { id } = response.json<{ invitation: { id: string } }>().invitation;
        const token = tokenOf(response);
        const revoke = () =>
          t.app.inject({ method: 'DELETE', url: `/v1/invitations/${id}`, headers: asAdmin() });
        expect((await revoke()).statusCode).toBe(204);
        expect((await revoke()).statusCode).toBe(204);
        expect((await preview(token)).json()).toMatchObject({ status: 'revoked' });
        const invitee = await signIn(t, 'revocada@example.com');
        expect((await accept(token, invitee)).statusCode).toBe(409);
      });

      it('cannot revoke an accepted invitation or one of another club', async () => {
        const response = await invite({ email: 'aceptada@example.com', role: 'player' });
        const { id } = response.json<{ invitation: { id: string } }>().invitation;
        const invitee = await signIn(t, 'aceptada@example.com');
        expect((await accept(tokenOf(response), invitee)).statusCode).toBe(200);
        const revokeAccepted = await t.app.inject({
          method: 'DELETE',
          url: `/v1/invitations/${id}`,
          headers: asAdmin(),
        });
        expect(revokeAccepted.statusCode).toBe(409);

        const otherAdmin = await signIn(t, 'admin@otro.example.com');
        await createMembership(database.admin, otherAdmin.userId, other, 'admin');
        const foreign = await t.app.inject({
          method: 'DELETE',
          url: `/v1/invitations/${id}`,
          headers: otherAdmin.headers,
        });
        expect(foreign.statusCode).toBe(404);
      });

      it('replaces the previous link when inviting the same email and role again', async () => {
        const first = tokenOf(await invite({ email: 'dos-veces@example.com', role: 'player' }));
        const second = tokenOf(await invite({ email: 'dos-veces@example.com', role: 'player' }));
        expect((await preview(first)).json()).toMatchObject({ status: 'revoked' });
        expect((await preview(second)).json()).toMatchObject({ status: 'pending' });
      });

      it('answers not_found for an unknown token', async () => {
        const response = await preview('A'.repeat(43));
        expect(response.statusCode).toBe(404);
        const invitee = await signIn(t, 'nadie@example.com');
        expect((await accept('B'.repeat(43), invitee)).statusCode).toBe(404);
      });

      it('lists the club invitations newest first, by status and by page', async () => {
        const all = await t.app.inject({ url: '/v1/invitations?limit=100', headers: asAdmin() });
        expect(all.statusCode).toBe(200);
        const items = all.json<{ items: { createdAt: string; status: string }[] }>().items;
        expect(items.length).toBeGreaterThan(5);
        const times = items.map((item) => item.createdAt);
        expect([...times].sort().reverse()).toEqual(times);

        const pending = await t.app.inject({
          url: '/v1/invitations?status=pending',
          headers: asAdmin(),
        });
        const pendingItems = pending.json<{ items: { status: string }[] }>().items;
        expect(pendingItems.length).toBeGreaterThan(0);
        expect(pendingItems.every((item) => item.status === 'pending')).toBe(true);

        interface PageBody {
          items: { id: string }[];
          nextCursor: string | null;
        }
        const fetchPage = async (cursor: string | null): Promise<PageBody> => {
          const url = `/v1/invitations?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
          const page = await t.app.inject({ url, headers: asAdmin() });
          return page.json<PageBody>();
        };
        const seen: string[] = [];
        let body = await fetchPage(null);
        seen.push(...body.items.map((item) => item.id));
        while (body.nextCursor !== null) {
          body = await fetchPage(body.nextCursor);
          seen.push(...body.items.map((item) => item.id));
        }
        expect(seen).toHaveLength(items.length);
        expect(new Set(seen).size).toBe(items.length);

        const bad = await t.app.inject({
          url: '/v1/invitations?cursor=garbage',
          headers: asAdmin(),
        });
        expect(bad.statusCode).toBe(400);
        expect(bad.json<Envelope>().error.code).toBe('bad_request');
      });
    });
  },
);
