import {
  changeMemberRole,
  endMember,
  getMember,
  listMembers,
  type Member,
} from '@sport-performance/contracts';
import { membership, user } from '@sport-performance/db/schema';
import {
  parseUserId,
  type ClubId,
  type MembershipRole,
  type UserId,
} from '@sport-performance/domain';
import { and, asc, eq, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint, type ClubAuthContext } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, likePattern, type KeysetSpec } from '../http/pagination.js';
import { rowVersion } from '../http/writes.js';
import { endAssignmentsOfMembership } from './staff-assignments.js';

/**
 * Members of the club (B-314, ADR 0007, ADR 0034): the administration lists
 * them, changes their role and ends their membership. A membership is never
 * deleted or edited in place: it ends (`ended_at`), and a role change ends it
 * and opens another, so the period of each role stays on record. Ending one
 * also ends its staff assignments in the same transaction.
 */

const memberColumns = {
  id: membership.id,
  userId: membership.userId,
  name: user.name,
  email: user.email,
  role: membership.role,
  startedAt: membership.startedAt,
  endedAt: membership.endedAt,
  invitedBy: membership.invitedBy,
  createdAt: membership.createdAt,
  updatedAt: membership.updatedAt,
  version: rowVersion(membership.updatedAt),
  /** Active at the database's clock, exactly as `app.current_role()` validates it. */
  active: sql<boolean>`(${membership.endedAt} is null or ${membership.endedAt} > now())`,
};

interface MemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
  startedAt: Date;
  endedAt: Date | null;
  invitedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
  active: boolean;
}

function memberDto(row: MemberRow): Member {
  return {
    id: row.id as Member['id'],
    user: { id: row.userId as Member['user']['id'], name: row.name, email: row.email },
    role: row.role,
    status: row.active ? 'active' : 'ended',
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    invitedBy: row.invitedBy as Member['invitedBy'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const MEMBER_KEYS: KeysetSpec<MemberRow, 'name' | 'email' | 'startedAt'> = {
  fields: {
    name: { column: user.name, type: 'text', value: (row) => row.name },
    email: { column: user.email, type: 'text', value: (row) => row.email },
    startedAt: { column: membership.startedAt, type: 'timestamp', value: (row) => row.startedAt },
  },
  id: { column: membership.id, value: (row) => row.id },
};

const isActive = or(isNull(membership.endedAt), sql`${membership.endedAt} > now()`);
const isEnded = sql`${membership.endedAt} <= now()`;

function selectMembers(db: TenantDatabase) {
  return db.select(memberColumns).from(membership).innerJoin(user, eq(user.id, membership.userId));
}

async function readMember(
  db: TenantDatabase,
  clubId: ClubId,
  membershipId: string,
  lock = false,
): Promise<MemberRow> {
  const query = selectMembers(db).where(
    and(eq(membership.clubId, clubId), eq(membership.id, membershipId)),
  );
  const [row] = lock ? await query.for('update', { of: membership }) : await query;
  if (row === undefined) throw new HttpError('not_found', 'Member not found');
  return row;
}

interface LockedTarget {
  target: MemberRow;
  /** The club's active admins, locked; `null` when the target is not an active admin. */
  admins: { id: string }[] | null;
}

/**
 * Reads the target of an end or a role change with its row locked. When it
 * is an active admin, every active admin membership of the club (the target
 * among them) is locked first, in one statement in id order: two admins
 * ending each other then take the same locks in the same order, so one waits
 * for the other instead of deadlocking, and sees its end (they cannot both
 * succeed). A membership's role never changes in place (a role change ends
 * it and opens another), so the first, unlocked read decides correctly
 * whether the admins need locking; the locked read is the one that counts.
 */
async function lockTarget(
  db: TenantDatabase,
  clubId: ClubId,
  membershipId: string,
): Promise<LockedTarget> {
  const peek = await readMember(db, clubId, membershipId);
  let admins: { id: string }[] | null = null;
  if (peek.role === 'admin' && peek.active) {
    admins = await db
      .select({ id: membership.id })
      .from(membership)
      .where(
        and(
          eq(membership.clubId, clubId),
          eq(membership.role, 'admin'),
          lte(membership.startedAt, sql`now()`),
          isActive,
        ),
      )
      .orderBy(asc(membership.id))
      .for('update');
  }
  return { target: await readMember(db, clubId, membershipId, true), admins };
}

/**
 * Checks an end or a role change of a target locked by `lockTarget` keeps
 * the club governable: an admin does not end or demote the membership they
 * act with, and the club never stays without an active admin (not even by a
 * superadmin).
 */
function assertGovernable(caller: ClubAuthContext, { target, admins }: LockedTarget): void {
  if (target.id === caller.membership.membershipId) {
    throw new HttpError('conflict', 'An admin cannot end or change their own membership');
  }
  if (target.role !== 'admin') return;
  if (admins === null) throw new Error('assertGovernable: the active admins were not locked');
  if (!admins.some((admin) => admin.id !== target.id)) {
    throw new HttpError('conflict', 'The club would be left without an active admin');
  }
}

/** Ends a locked, active membership now, with its staff assignments. */
async function endMembership(
  db: TenantDatabase,
  caller: ClubAuthContext,
  target: MemberRow,
): Promise<void> {
  const { clubId } = caller.membership;
  await db
    .update(membership)
    .set({ endedAt: sql`now()`, updatedBy: caller.userId })
    .where(and(eq(membership.clubId, clubId), eq(membership.id, target.id)));
  await endAssignmentsOfMembership(db, clubId, target.id, caller.userId);
}

/**
 * Runs after a membership ended, inside its request (B-333): `db` is the
 * request transaction, with the caller's tenant context (and, for a
 * superadmin, their support access already recorded). The API wires it to
 * close the sessions of a member left without any membership.
 */
export type MembershipEndedHook = (
  caller: ClubAuthContext,
  ended: { readonly id: string; readonly userId: UserId },
  db: TenantDatabase,
) => Promise<void>;

export interface MemberRoutesOptions {
  onMembershipEnded?: MembershipEndedHook | undefined;
}

export function registerMemberRoutes(
  app: FastifyInstance,
  options: MemberRoutesOptions = {},
): void {
  registerEndpoint(app, listMembers, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const scope = await permissions.listScope('membership', 'read');
      const plan = keysetPage(MEMBER_KEYS, query, {
        role: query.role,
        status: query.status,
        q: query.q,
      });
      // Only the administration lists members (the whole club).
      if (scope.kind !== 'club') return { items: [], nextCursor: null };
      let status: SQL | undefined;
      if (query.status === 'active') status = isActive;
      else if (query.status === 'ended') status = isEnded;
      const rows = await selectMembers(db)
        .where(
          and(
            eq(membership.clubId, caller.membership.clubId),
            query.role === undefined ? undefined : eq(membership.role, query.role),
            status,
            query.q === undefined
              ? undefined
              : or(ilike(user.name, likePattern(query.q)), ilike(user.email, likePattern(query.q))),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, memberDto);
    },
  });

  registerEndpoint(app, getMember, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('membership', 'read');
      return memberDto(await readMember(db, caller.membership.clubId, params.membershipId));
    },
  });

  registerEndpoint(app, changeMemberRole, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('membership', 'update');
      const { clubId } = caller.membership;
      const locked = await lockTarget(db, clubId, params.membershipId);
      const { target } = locked;
      if (target.version !== body.version) {
        throw new HttpError('conflict', 'The member changed since it was read: read it again');
      }
      if (!target.active) throw new HttpError('conflict', 'The membership has ended');
      if (target.role === body.role) {
        throw new HttpError('conflict', 'The membership already has that role');
      }
      assertGovernable(caller, locked);
      const [taken] = await db
        .select({ id: membership.id })
        .from(membership)
        .where(
          and(
            eq(membership.clubId, clubId),
            eq(membership.userId, target.userId),
            eq(membership.role, body.role),
            isActive,
          ),
        );
      if (taken !== undefined) {
        throw new HttpError(
          'conflict',
          'The person already has an active membership with that role',
        );
      }

      await endMembership(db, caller, target);
      const [created] = await db
        .insert(membership)
        .values({
          clubId,
          userId: target.userId,
          role: body.role,
          invitedBy: target.invitedBy,
          createdBy: caller.userId,
          updatedBy: caller.userId,
        })
        .returning({ id: membership.id });
      if (created === undefined) throw new Error('changeMemberRole: the insert returned no row');
      return memberDto(await readMember(db, clubId, created.id));
    },
  });

  registerEndpoint(app, endMember, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('membership', 'revoke');
      const { clubId } = caller.membership;
      const locked = await lockTarget(db, clubId, params.membershipId);
      const { target } = locked;
      if (!target.active) return memberDto(target);
      assertGovernable(caller, locked);
      await endMembership(db, caller, target);
      await options.onMembershipEnded?.(
        caller,
        { id: target.id, userId: parseUserId(target.userId) },
        db,
      );
      return memberDto(await readMember(db, clubId, target.id));
    },
  });
}
