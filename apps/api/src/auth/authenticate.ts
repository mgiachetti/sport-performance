import { MEMBERSHIP_HEADER } from '@sport-performance/contracts';
import { isUuid, parseUserId } from '@sport-performance/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SportAuth } from './better-auth.js';
import type { Authenticate, AuthContext } from './context.js';
import type { ActiveMembership, IdentityStore } from './identity.js';

/** Request headers Better Auth needs to find the session: nothing else is handed to it. */
export function sessionHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const name of ['cookie', 'authorization'] as const) {
    const value = request.headers[name];
    if (typeof value === 'string' && value !== '') headers.set(name, value);
  }
  return headers;
}

/** Copies the `Set-Cookie` headers of a Better Auth response to the reply. */
export function forwardSetCookie(reply: FastifyReply, headers: Headers | null | undefined): void {
  const cookies = headers?.getSetCookie() ?? [];
  if (cookies.length === 0) return;
  const current = reply.getHeader('set-cookie');
  const previous =
    current === undefined ? [] : Array.isArray(current) ? current : [String(current)];
  void reply.header('set-cookie', [...previous, ...cookies]);
}

/**
 * The membership a request acts as: the one named by `X-Membership-Id`, or
 * the only active one when the header is absent (ADR 0007). A header that
 * does not name an active membership of the user selects nothing and is
 * reported, so `club` endpoints answer `403` while `session` ones (the club
 * selector itself) keep working.
 */
export function selectMembership(
  memberships: readonly ActiveMembership[],
  header: string | string[] | undefined,
): { membership: ActiveMembership | null; rejected: boolean } {
  if (header === undefined || header === '') {
    return {
      membership: memberships.length === 1 ? (memberships[0] ?? null) : null,
      rejected: false,
    };
  }
  const wanted = typeof header === 'string' ? header.toLowerCase() : undefined;
  const found =
    wanted !== undefined && isUuid(wanted) ? memberships.find((m) => m.id === wanted) : undefined;
  return found === undefined
    ? { membership: null, rejected: true }
    : { membership: found, rejected: false };
}

/**
 * {@link Authenticate} over Better Auth: the session comes from the cookie
 * (web) or `Authorization: Bearer` (mobile, through Better Auth's bearer
 * plugin), the memberships from the identity store. A refreshed session
 * re-sets the cookie of web callers.
 */
export function createSessionAuthenticate(auth: SportAuth, identity: IdentityStore): Authenticate {
  return async (request, reply): Promise<AuthContext | null> => {
    const headers = sessionHeaders(request);
    if (!headers.has('cookie') && !headers.has('authorization')) return null;

    const result = await auth.api.getSession({ headers, returnHeaders: true });
    const found = result.response;
    if (found === null) return null;
    // Mobile callers never get cookies: their token stays the same when the session is extended.
    if (!headers.has('authorization')) forwardSetCookie(reply, result.headers);

    const userId = parseUserId(found.user.id);
    const memberships = await identity.activeMemberships(userId);
    const { membership, rejected } = selectMembership(
      memberships,
      request.headers[MEMBERSHIP_HEADER],
    );
    return {
      userId,
      email: found.user.email,
      name: found.user.name,
      isSuperadmin: found.user.isSuperadmin === true,
      session: { id: found.session.id, expiresAt: new Date(found.session.expiresAt) },
      membership:
        membership === null
          ? null
          : { membershipId: membership.id, clubId: membership.clubId, role: membership.role },
      membershipRejected: rejected,
    };
  };
}
