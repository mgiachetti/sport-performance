import { can } from '@sport-performance/domain';
import type { ClubAuthContext } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import type { AuthModule } from './module.js';

export type EndedMembershipSessions =
  /** The person has no other active membership: every session of theirs was closed. */
  | { readonly outcome: 'revoked'; readonly revoked: number }
  /**
   * They still belong to another club: their sessions
   * stay open there. The ended membership stops working on their next request
   * anyway, because every request reads the active memberships again.
   */
  | { readonly outcome: 'kept_other_memberships'; readonly revoked: 0 }
  /** A superadmin's access does not come from memberships (ADR 0007): nothing is closed. */
  | { readonly outcome: 'kept_superadmin'; readonly revoked: 0 };

/**
 * Closes the sessions of a member whose membership an admin is ending (B-333,
 * ADR 0033). The endpoint that ends memberships calls it with the ended
 * membership's id, inside or after its own transaction:
 *
 * - only whoever may `revoke` memberships of the club (the permissions
 *   matrix: the club's `admin`, ADR 0025) and only for a membership of that
 *   club (`not_found` otherwise, as the club policies see it);
 * - if the person keeps no other active membership in any club and is not a
 *   superadmin, every session of theirs (web and mobile) is deleted: they are
 *   out on their next request. Otherwise nothing is closed: an admin of one
 *   club does not sign people out of another.
 */
export async function revokeSessionsOfEndedMembership(
  auth: AuthModule,
  caller: ClubAuthContext,
  membershipId: string,
): Promise<EndedMembershipSessions> {
  const { clubId, role } = caller.membership;
  if (!can({ userId: caller.userId, role, clubId }, 'revoke', { kind: 'membership', clubId })) {
    throw new HttpError('forbidden', 'Only an admin of the club ends memberships');
  }
  const memberId = await auth.identity.membershipUser(
    { clubId, userId: caller.userId, role },
    membershipId,
  );
  if (memberId === undefined) throw new HttpError('not_found', 'Membership not found');

  const others = (await auth.identity.activeMemberships(memberId)).filter(
    (m) => m.id !== membershipId,
  );
  if (others.length > 0) return { outcome: 'kept_other_memberships', revoked: 0 };
  const { revoked, superadmin } = await auth.sessions.revokeAllOfMember(memberId);
  return superadmin ? { outcome: 'kept_superadmin', revoked: 0 } : { outcome: 'revoked', revoked };
}
