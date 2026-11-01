import type { ClubId, Role, UserId } from '@sport-performance/domain';
import type { FastifyRequest } from 'fastify';
import { ANONYMOUS_CONTEXT, type TenantContext } from '../db/tenant-context.js';

/** The club a request acts in and the role the user holds there (ADR 0007). */
export interface Membership {
  readonly clubId: ClubId;
  readonly role: Role;
}

/**
 * Who is calling. Set once per request, before validation and handlers, by
 * the {@link Authenticate} hook. `membership` is `null` when the user is
 * signed in but has not picked a club yet (club selector) or has none.
 */
export interface AuthContext {
  readonly userId: UserId;
  readonly membership: Membership | null;
}

/**
 * Resolves the caller of a request: `null` for anonymous. Better Auth plugs
 * in here (#40, B-309): it reads the session (cookie on web, bearer token on
 * mobile), loads the membership of the selected club and returns it. It must
 * not throw for a missing or expired session (return `null`); a thrown
 * error is a server error.
 */
export type Authenticate = (request: FastifyRequest) => Promise<AuthContext | null>;

/** Default until #40: every request is anonymous. */
export const anonymous: Authenticate = () => Promise.resolve(null);

declare module 'fastify' {
  interface FastifyRequest {
    /** Caller of the request; `null` when anonymous. Set in `onRequest`. */
    auth: AuthContext | null;
  }
}

/** Tenant context a transaction of this caller runs with. */
export function tenantContextOf(auth: AuthContext | null): TenantContext {
  if (auth === null) return ANONYMOUS_CONTEXT;
  if (auth.membership === null) return { clubId: null, userId: auth.userId, role: null };
  return { clubId: auth.membership.clubId, userId: auth.userId, role: auth.membership.role };
}
