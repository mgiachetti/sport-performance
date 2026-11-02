import {
  createStaffAssignment,
  endStaffAssignment,
  getStaffAssignment,
  listMyStaffAssignments,
  listStaffAssignments,
  updateStaffAssignment,
  type StaffAssignment,
  type StaffAssignmentStatusFilter,
  type ValidationIssue,
} from '@sport-performance/contracts';
import {
  category,
  clubBranch,
  membership,
  staffAssignment,
  user,
} from '@sport-performance/db/schema';
import {
  compareLocalDates,
  endedValidTo,
  isStaffAssignmentRole,
  parseLocalDate,
  staffAssignmentStatus,
  validitiesOverlap,
  type AssignmentValidity,
  type CategoryId,
  type ClubId,
  type LocalDate,
  type MembershipRole,
  type Sport,
  type Uuid,
} from '@sport-performance/domain';
import { and, eq, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import {
  insertIdempotent,
  markReplay,
  rowVersion,
  updateAtVersion,
  versionMatches,
} from '../http/writes.js';

/**
 * Staff assignments (B-314, ADR 0034): which categories, or which whole
 * sport, each `coach`, `sc` and `medical` member sees. The permission
 * subject of every request (`loadPermissionSubject`) and the database's
 * `app.visible_player_ids()` read these rows with the same validity
 * (`valid_from <= today < valid_to`, the club's day), so what is written
 * here is what each staff member sees from their next request on.
 */

const assignmentColumns = {
  id: staffAssignment.id,
  membershipId: staffAssignment.membershipId,
  userId: membership.userId,
  name: user.name,
  role: membership.role,
  categoryId: staffAssignment.categoryId,
  sport: staffAssignment.sport,
  validFrom: staffAssignment.validFrom,
  validTo: staffAssignment.validTo,
  createdAt: staffAssignment.createdAt,
  updatedAt: staffAssignment.updatedAt,
  version: rowVersion(staffAssignment.updatedAt),
};

interface AssignmentRow {
  id: string;
  membershipId: string;
  userId: string;
  name: string;
  role: MembershipRole;
  categoryId: CategoryId | null;
  sport: Sport | null;
  validFrom: LocalDate;
  validTo: LocalDate | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

function assignmentDto(row: AssignmentRow, today: LocalDate): StaffAssignment {
  let target: StaffAssignment['target'];
  if (row.categoryId !== null) target = { kind: 'category', categoryId: row.categoryId };
  else if (row.sport !== null) target = { kind: 'sport', sport: row.sport };
  else throw new Error('staff_assignment without a target (staff_assignment_one_target)');
  return {
    id: row.id as StaffAssignment['id'],
    membershipId: row.membershipId as StaffAssignment['membershipId'],
    member: {
      userId: row.userId as StaffAssignment['member']['userId'],
      name: row.name,
      role: row.role,
    },
    target,
    validFrom: row.validFrom,
    validTo: row.validTo,
    status: staffAssignmentStatus(row, today),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const ASSIGNMENT_KEYS: KeysetSpec<AssignmentRow, 'validFrom' | 'createdAt'> = {
  fields: {
    // ISO dates sort as text exactly as dates do.
    validFrom: {
      column: sql`${staffAssignment.validFrom}::text`,
      type: 'text',
      value: (row) => row.validFrom,
    },
    createdAt: {
      column: staffAssignment.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
  },
  id: { column: staffAssignment.id, value: (row) => row.id },
};

/** The rows with their member: every query of this file selects through here. */
function selectAssignments(db: TenantDatabase) {
  return db
    .select(assignmentColumns)
    .from(staffAssignment)
    .innerJoin(
      membership,
      and(
        eq(membership.clubId, staffAssignment.clubId),
        eq(membership.id, staffAssignment.membershipId),
      ),
    )
    .innerJoin(user, eq(user.id, membership.userId));
}

/** "Today" in the club's time zone, from the database's clock (CLAUDE.md). */
export async function clubToday(db: TenantDatabase): Promise<LocalDate> {
  const { rows } = await db.execute<{ today: string | null }>(
    sql`select app.club_today()::text as today`,
  );
  const today = rows[0]?.today ?? null;
  if (today === null) throw new HttpError('forbidden', 'The club of the request is not visible');
  return parseLocalDate(today);
}

/** SQL of the `status` filter, on the club's day (same rules as `staffAssignmentStatus`). */
function statusFilter(status: StaffAssignmentStatusFilter, today: LocalDate): SQL | undefined {
  const day = sql`${today}::date`;
  const from = staffAssignment.validFrom;
  const to = staffAssignment.validTo;
  const notEmpty = or(isNull(to), sql`${to} > ${from}`);
  switch (status) {
    case 'all':
      return undefined;
    case 'active':
      return and(notEmpty, or(isNull(to), sql`${to} > ${day}`));
    case 'current':
      return and(sql`${from} <= ${day}`, or(isNull(to), sql`${to} > ${day}`));
    case 'upcoming':
      return and(sql`${from} > ${day}`, notEmpty);
    case 'ended':
      return and(isNotNull(to), or(sql`${to} <= ${day}`, sql`${to} <= ${from}`));
  }
}

/**
 * Ends every assignment of a membership that is not over yet, on the club's
 * day (ADR 0034): current ones stop today, upcoming ones are cancelled with
 * an empty range. Used when a membership ends or changes role.
 */
export async function endAssignmentsOfMembership(
  db: TenantDatabase,
  clubId: ClubId,
  membershipId: string,
  updatedBy: string,
): Promise<void> {
  const today = await clubToday(db);
  const end = sql`greatest(${staffAssignment.validFrom}, ${today}::date)`;
  await db
    .update(staffAssignment)
    .set({ validTo: sql`${end}`, updatedBy })
    .where(
      and(
        eq(staffAssignment.clubId, clubId),
        eq(staffAssignment.membershipId, membershipId),
        or(isNull(staffAssignment.validTo), sql`${staffAssignment.validTo} > ${end}`),
      ),
    );
}

async function readAssignment(
  db: TenantDatabase,
  clubId: ClubId,
  assignmentId: string,
): Promise<AssignmentRow> {
  const [row] = await selectAssignments(db).where(
    and(eq(staffAssignment.clubId, clubId), eq(staffAssignment.id, assignmentId)),
  );
  if (row === undefined) throw new HttpError('not_found', 'Staff assignment not found');
  return row;
}

async function authorizedAssignment(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  assignmentId: string,
  action: 'read' | 'manage',
): Promise<AssignmentRow> {
  await permissions.authorize('staff_assignment', action);
  return readAssignment(db, clubId, assignmentId);
}

function invalid(path: (string | number)[], message: string): HttpError {
  const details: ValidationIssue[] = [{ path, code: 'custom', message }];
  return new HttpError('validation_failed', message, { details });
}

/**
 * Locks the membership of an assignment (`FOR UPDATE`): creates, edits and
 * the end of the membership are serialized per member, so the overlap check
 * below cannot race. `undefined` when it is not in the club.
 */
async function lockMembership(db: TenantDatabase, clubId: ClubId, membershipId: string) {
  const [row] = await db
    .select({
      id: membership.id,
      role: membership.role,
      ended: sql<boolean>`(${membership.endedAt} is not null and ${membership.endedAt} <= now())`,
    })
    .from(membership)
    .where(and(eq(membership.clubId, clubId), eq(membership.id, membershipId)))
    .for('update');
  return row;
}

/** Throws `409` when another assignment of the membership to the same target overlaps. */
async function assertNoOverlap(
  db: TenantDatabase,
  clubId: ClubId,
  membershipId: string,
  target: { categoryId: CategoryId | null; sport: Sport | null },
  window: AssignmentValidity,
  exceptId?: string,
): Promise<void> {
  const sameTarget =
    target.categoryId !== null
      ? eq(staffAssignment.categoryId, target.categoryId)
      : target.sport !== null
        ? eq(staffAssignment.sport, target.sport)
        : sql`false`;
  const others = await db
    .select({ validFrom: staffAssignment.validFrom, validTo: staffAssignment.validTo })
    .from(staffAssignment)
    .where(
      and(
        eq(staffAssignment.clubId, clubId),
        eq(staffAssignment.membershipId, membershipId),
        sameTarget,
        exceptId === undefined ? undefined : ne(staffAssignment.id, exceptId),
      ),
    );
  if (others.some((other) => validitiesOverlap(other, window))) {
    throw new HttpError(
      'conflict',
      'The member already has an assignment to this target that overlaps these dates',
    );
  }
}

/** Checks the target of a new assignment is assignable: an active category, or an enabled sport. */
async function assertAssignableTarget(
  db: TenantDatabase,
  clubId: ClubId,
  target: { kind: 'category'; categoryId: CategoryId } | { kind: 'sport'; sport: Sport },
): Promise<void> {
  if (target.kind === 'category') {
    const [row] = await db
      .select({ archivedAt: category.archivedAt })
      .from(category)
      .where(and(eq(category.clubId, clubId), eq(category.id, target.categoryId)));
    if (row === undefined) {
      throw invalid(['body', 'target', 'categoryId'], 'The category does not exist in this club');
    }
    if (row.archivedAt !== null) {
      throw invalid(['body', 'target', 'categoryId'], 'The category is archived');
    }
    return;
  }
  const [branch] = await db
    .select({ id: clubBranch.id })
    .from(clubBranch)
    .where(
      and(
        eq(clubBranch.clubId, clubId),
        eq(clubBranch.sport, target.sport),
        isNull(clubBranch.archivedAt),
      ),
    )
    .limit(1);
  if (branch === undefined) {
    throw invalid(['body', 'target', 'sport'], 'The club has no enabled branch of this sport');
  }
}

function assertRange(window: AssignmentValidity, path: (string | number)[]): void {
  if (window.validTo !== null && compareLocalDates(window.validTo, window.validFrom) <= 0) {
    throw invalid(path, 'validTo must be after validFrom (it is exclusive)');
  }
}

export function registerStaffAssignmentRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listStaffAssignments, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const scope = await permissions.listScope('staff_assignment', 'read');
      const plan = keysetPage(ASSIGNMENT_KEYS, query, {
        membershipId: query.membershipId,
        categoryId: query.categoryId,
        sport: query.sport,
        status: query.status,
      });
      // Only the administration lists them (the whole club); no rule scopes them otherwise.
      if (scope.kind !== 'club') return { items: [], nextCursor: null };
      const today = await clubToday(db);
      const rows = await selectAssignments(db)
        .where(
          and(
            eq(staffAssignment.clubId, caller.membership.clubId),
            query.membershipId === undefined
              ? undefined
              : eq(staffAssignment.membershipId, query.membershipId),
            query.categoryId === undefined
              ? undefined
              : eq(staffAssignment.categoryId, query.categoryId),
            query.sport === undefined ? undefined : eq(staffAssignment.sport, query.sport),
            statusFilter(query.status, today),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, (row) => assignmentDto(row, today));
    },
  });

  registerEndpoint(app, listMyStaffAssignments, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      // The caller's own assignments are part of their permission subject (what they see),
      // not a resource of the matrix: any role of the club may read its own (none for most).
      await permissions.subject();
      const plan = keysetPage(ASSIGNMENT_KEYS, query, { status: query.status });
      const own: Uuid | null = caller.membership.membershipId;
      // A supporting superadmin is not a member: no assignments.
      if (own === null) return { items: [], nextCursor: null };
      const today = await clubToday(db);
      const rows = await selectAssignments(db)
        .where(
          and(
            eq(staffAssignment.clubId, caller.membership.clubId),
            eq(staffAssignment.membershipId, own),
            statusFilter(query.status, today),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, (row) => assignmentDto(row, today));
    },
  });

  registerEndpoint(app, getStaffAssignment, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const row = await authorizedAssignment(
        db,
        permissions,
        caller.membership.clubId,
        params.assignmentId,
        'read',
      );
      return assignmentDto(row, await clubToday(db));
    },
  });

  registerEndpoint(app, createStaffAssignment, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('staff_assignment', 'manage');
      const { clubId } = caller.membership;
      const findByClientUuid = async (clientUuid: string) =>
        (
          await selectAssignments(db).where(
            and(eq(staffAssignment.clubId, clubId), eq(staffAssignment.clientUuid, clientUuid)),
          )
        )[0];
      const today = await clubToday(db);

      const member = await lockMembership(db, clubId, body.membershipId);
      if (member === undefined) {
        throw invalid(['body', 'membershipId'], 'The membership does not exist in this club');
      }
      // A retry of a create that went through: the same row, before checking anything that
      // the create itself changed (it would overlap with itself).
      if (body.clientUuid !== undefined) {
        const previous = await findByClientUuid(body.clientUuid);
        if (previous !== undefined) {
          markReplay(reply);
          return assignmentDto(previous, today);
        }
      }
      if (!isStaffAssignmentRole(member.role)) {
        throw invalid(
          ['body', 'membershipId'],
          'Only coach, sc and medical memberships have staff assignments',
        );
      }
      if (member.ended) throw new HttpError('conflict', 'The membership has ended');

      const window: AssignmentValidity = {
        validFrom: body.validFrom ?? today,
        validTo: body.validTo ?? null,
      };
      assertRange(window, ['body', 'validTo']);
      await assertAssignableTarget(db, clubId, body.target);
      const target = {
        categoryId: body.target.kind === 'category' ? body.target.categoryId : null,
        sport: body.target.kind === 'sport' ? body.target.sport : null,
      };
      await assertNoOverlap(db, clubId, body.membershipId, target, window);

      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () => {
          const [inserted] = await db
            .insert(staffAssignment)
            .values({
              clubId,
              ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
              membershipId: body.membershipId,
              categoryId: target.categoryId,
              sport: target.sport,
              validFrom: window.validFrom,
              validTo: window.validTo,
              createdBy: caller.userId,
              updatedBy: caller.userId,
            })
            .onConflictDoNothing({ target: [staffAssignment.clubId, staffAssignment.clientUuid] })
            .returning({ id: staffAssignment.id });
          return inserted === undefined ? undefined : readAssignment(db, clubId, inserted.id);
        },
        findByClientUuid,
      });
      return assignmentDto(row, today);
    },
  });

  registerEndpoint(app, updateStaffAssignment, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const current = await authorizedAssignment(
        db,
        permissions,
        clubId,
        params.assignmentId,
        'manage',
      );
      const member = await lockMembership(db, clubId, current.membershipId);
      if (member?.ended !== false) throw new HttpError('conflict', 'The membership has ended');
      const window: AssignmentValidity = {
        validFrom: body.validFrom ?? current.validFrom,
        validTo: body.validTo === undefined ? current.validTo : body.validTo,
      };
      assertRange(window, ['body', body.validTo === undefined ? 'validFrom' : 'validTo']);
      await assertNoOverlap(db, clubId, current.membershipId, current, window, current.id);

      const where = and(
        eq(staffAssignment.clubId, clubId),
        eq(staffAssignment.id, params.assignmentId),
      );
      await updateAtVersion({
        resource: 'Staff assignment',
        update: async () =>
          (
            await db
              .update(staffAssignment)
              .set({
                validFrom: window.validFrom,
                validTo: window.validTo,
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(staffAssignment.updatedAt, body.version)))
              .returning({ id: staffAssignment.id })
          )[0],
        exists: async () =>
          (await db.select({ id: staffAssignment.id }).from(staffAssignment).where(where)).length >
          0,
      });
      return assignmentDto(
        await readAssignment(db, clubId, params.assignmentId),
        await clubToday(db),
      );
    },
  });

  registerEndpoint(app, endStaffAssignment, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const current = await authorizedAssignment(
        db,
        permissions,
        clubId,
        params.assignmentId,
        'manage',
      );
      const today = await clubToday(db);
      const validTo = endedValidTo(current, today);
      if (validTo === null) return assignmentDto(current, today);
      await db
        .update(staffAssignment)
        .set({ validTo, updatedBy: caller.userId })
        .where(and(eq(staffAssignment.clubId, clubId), eq(staffAssignment.id, current.id)));
      return assignmentDto(await readAssignment(db, clubId, current.id), today);
    },
  });
}
