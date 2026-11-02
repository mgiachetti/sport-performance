import type { ClubId, Role, Uuid, UserId } from '@sport-performance/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ANONYMOUS_CONTEXT, type TenantContext } from '../db/tenant-context.js';

/** The membership (club + role) a request acts as (ADR 0007). */
export interface Membership {
  readonly membershipId: Uuid;
  readonly clubId: ClubId;
  readonly role: Role;
}

/**
 * Who is calling. Set once per request, before validation and handlers, by
 * the {@link Authenticate} hook.
 *
 * `email` and `name` are personal data: they are for handlers (comparing an
 * invitation's email, the inviter's name in an email), never for logs or
 * error reports (ids only, ADR 0016).
 */
export interface AuthContext {
  readonly userId: UserId;
  readonly email: string;
  readonly name: string;
  /** Global support role (ADR 0007): not a membership, and it does not bypass RLS (ADR 0006). */
  readonly isSuperadmin: boolean;
  readonly session: { readonly id: string; readonly expiresAt: Date };
  /**
   * The selected membership: the one named by `X-Membership-Id`, or the only
   * active one when the header is absent. `null` when the user has none, has
   * several and did not choose, or named one that is not theirs.
   */
  readonly membership: Membership | null;
  /** `X-Membership-Id` named a membership that is not an active one of this user. */
  readonly membershipRejected: boolean;
}

/**
 * Resolves the caller of a request: `null` for anonymous. The Better Auth
 * implementation (`createSessionAuthenticate`) reads the session (cookie on
 * web, bearer token on mobile) and the selected membership; it may set
 * headers on `reply` (a refreshed session cookie). It must not throw for a
 * missing or expired session (return `null`); a thrown error is a server error.
 */
export type Authenticate = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AuthContext | null>;

/** Every request is anonymous (the app built without the auth module, in unit tests). */
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
