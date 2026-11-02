import type { MembershipSummary } from '@sport-performance/contracts';
import type { InvitationStatus } from '@sport-performance/contracts';
import { club, membership } from '@sport-performance/db/schema';
import {
  parseClubId,
  parseUserId,
  parseUuid,
  type ClubId,
  type MembershipRole,
  type TimeZone,
  type UserId,
  type Uuid,
} from '@sport-performance/domain';
import { and, asc, eq, gt, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { tenantDatabase, type Database, type TenantDatabase } from '../db/database.js';
import type { TenantContext } from '../db/tenant-context.js';
import { invitationStatus } from '../invitations/tokens.js';

/** An active membership with its club, as the club selector shows it. */
export interface ActiveMembership {
  readonly id: Uuid;
  readonly clubId: ClubId;
  readonly clubSlug: string;
  readonly clubName: string;
  /** "The day" and the times of the club's emails are shown in it. */
  readonly clubTimeZone: TimeZone;
  readonly role: MembershipRole;
  readonly startedAt: Date;
}

export interface InvitationPreviewRow {
  readonly club: { readonly id: ClubId; readonly slug: string; readonly name: string };
  readonly email: string;
  readonly role: MembershipRole;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
}

export type AcceptInvitationResult =
  | { readonly kind: 'accepted'; readonly membership: ActiveMembership; readonly created: boolean }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unavailable'; readonly status: Exclude<InvitationStatus, 'pending'> }
  | { readonly kind: 'wrong_email' };

/**
 * Identity flows that run before (or across) a club context (ADR 0028), on
 * the API's own connection (`sport_performance_app`, ADR 0026): never as the
 * owner, never on Better Auth's connection. Each call is one transaction with
 * the caller's user id and no club as tenant context:
 *
 * - the memberships of a user in every club: the club selector policies
 *   (no club in the context) show a user their own memberships and clubs;
 * - invitations by token: whoever opens the link is not a member yet, so the
 *   club policies hide the invitation. `app.invitation_by_token()` and
 *   `app.accept_invitation()` (`SECURITY DEFINER`, migration 0006) find
 *   exactly the invitation of the token hash; accepting checks the state at
 *   the database's clock and the email of the context's user itself.
 */
export interface IdentityStore {
  activeMemberships(userId: UserId): Promise<ActiveMembership[]>;
  previewInvitation(tokenHash: string, now: Date): Promise<InvitationPreviewRow | undefined>;
  acceptInvitation(
    tokenHash: string,
    caller: { readonly userId: UserId },
  ): Promise<AcceptInvitationResult>;
  /**
   * The user of a membership of the context's club, in any state (ended
   * too), as the club policies show it to the context's role; `undefined`
   * when the membership is not of that club or not visible.
   */
  membershipUser(context: TenantContext, membershipId: string): Promise<UserId | undefined>;
}

function userContext(userId: UserId | null): TenantContext {
  return { clubId: null, userId, role: null };
}

const membershipColumns = {
  id: membership.id,
  clubId: membership.clubId,
  clubSlug: club.slug,
  clubName: club.name,
  clubTimeZone: club.timeZone,
  role: membership.role,
  startedAt: membership.startedAt,
};

function toActiveMembership(row: {
  id: string;
  clubId: string;
  clubSlug: string;
  clubName: string;
  clubTimeZone: TimeZone;
  role: MembershipRole;
  startedAt: Date;
}): ActiveMembership {
  return { ...row, id: parseUuid(row.id), clubId: parseClubId(row.clubId) };
}

/** Active at the database's clock, exactly like `app.current_role()` validates it. */
const isActive: SQL | undefined = and(
  lte(membership.startedAt, sql`now()`),
  or(isNull(membership.endedAt), gt(membership.endedAt, sql`now()`)),
);

async function membershipsOf(
  db: TenantDatabase,
  userId: UserId,
  only?: SQL,
): Promise<ActiveMembership[]> {
  const rows = await db
    .select(membershipColumns)
    .from(membership)
    .innerJoin(club, eq(club.id, membership.clubId))
    .where(and(eq(membership.userId, userId), only ?? isActive))
    .orderBy(asc(club.name), asc(membership.role), asc(membership.id));
  return rows.map(toActiveMembership);
}

interface InvitationByTokenRow extends Record<string, unknown> {
  club_id: string;
  club_slug: string;
  club_name: string;
  email: string;
  role: MembershipRole;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

interface AcceptInvitationRow extends Record<string, unknown> {
  outcome: 'joined' | 'not_found' | 'wrong_email' | Exclude<InvitationStatus, 'pending'>;
  joined_membership_id: string | null;
  membership_created: boolean;
}

export function createIdentityStore(appDb: Database): IdentityStore {
  const run = <T>(userId: UserId | null, work: (db: TenantDatabase) => Promise<T>) =>
    appDb.transaction(userContext(userId), (tx) => work(tenantDatabase(tx)));

  return {
    activeMemberships: (userId) => run(userId, (db) => membershipsOf(db, userId)),

    membershipUser: (context, membershipId) =>
      appDb.transaction(context, async (tx) => {
        if (context.clubId === null) return undefined;
        const [row] = await tenantDatabase(tx)
          .select({ userId: membership.userId })
          .from(membership)
          .where(and(eq(membership.clubId, context.clubId), eq(membership.id, membershipId)));
        return row === undefined ? undefined : parseUserId(row.userId);
      }),

    previewInvitation: (tokenHash, now) =>
      run(null, async (db) => {
        const { rows } = await db.execute<InvitationByTokenRow>(
          sql`select * from app.invitation_by_token(${tokenHash})`,
        );
        const row = rows[0];
        if (row === undefined) return undefined;
        const state = {
          expiresAt: new Date(row.expires_at),
          acceptedAt: row.accepted_at === null ? null : new Date(row.accepted_at),
          revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
        };
        return {
          club: { id: parseClubId(row.club_id), slug: row.club_slug, name: row.club_name },
          email: row.email,
          role: row.role,
          status: invitationStatus(state, now),
          expiresAt: state.expiresAt,
        };
      }),

    acceptInvitation: (tokenHash, caller) =>
      run(caller.userId, async (db) => {
        const { rows } = await db.execute<AcceptInvitationRow>(
          sql`select * from app.accept_invitation(${tokenHash})`,
        );
        const row = rows[0];
        if (row === undefined) throw new Error('accept_invitation returned no row');
        switch (row.outcome) {
          case 'not_found':
          case 'wrong_email':
            return { kind: row.outcome } as const;
          case 'accepted':
          case 'revoked':
          case 'expired':
            return { kind: 'unavailable', status: row.outcome } as const;
          case 'joined': {
            const id = row.joined_membership_id;
            if (id === null) throw new Error('accept_invitation joined without a membership');
            // Read back in the same transaction, through the selector policies.
            const [joined] = await membershipsOf(db, caller.userId, eq(membership.id, id));
            if (joined === undefined) throw new Error('accepted membership is not visible');
            return {
              kind: 'accepted',
              membership: joined,
              created: row.membership_created,
            } as const;
          }
        }
      }),
  };
}

/** Contract shape of a membership. */
export function membershipSummary(active: ActiveMembership): MembershipSummary {
  return {
    id: active.id,
    club: { id: active.clubId, slug: active.clubSlug, name: active.clubName },
    role: active.role,
    startedAt: active.startedAt.toISOString(),
  };
}
