import {
  cancelTestSession,
  createTestSession,
  getTestSession,
  listTestSessions,
  restoreTestSession,
  updateTestSession,
  type TestSession,
} from '@sport-performance/contracts';
import { testSession } from '@sport-performance/db/schema';
import {
  spanContainsDate,
  testWindowLabel,
  type ClubId,
  type LocalDate,
  type Sport,
} from '@sport-performance/domain';
import { and, eq, gte, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../../db/database.js';
import { registerEndpoint } from '../../http/endpoint.js';
import { HttpError } from '../../http/errors.js';
import { keysetPage, type KeysetSpec } from '../../http/pagination.js';
import type { RequestPermissions } from '../../http/permissions.js';
import { insertIdempotent, updateAtVersion, versionMatches } from '../../http/writes.js';
import { isClubStaff, toConditions } from '../tests/model.js';
import {
  dayKey,
  invalid,
  lockSeasonPlan,
  previousCreate,
  readCategoryFacts,
  readSeasonRow,
  readTestWindowRow,
  testSessionColumns,
  testSessionDto,
  windowNumber,
  type TestSessionRow,
} from './shared.js';

/**
 * Scheduled test days (B-317): a category's day of tests, optionally in a
 * window of its season. `test_session.manage` (the S&C staff of the
 * category and the administration) schedules, reschedules, cancels and
 * restores them, and runs them (B-320: status, conditions and the evaluator
 * in charge); the results of the day are `routes/test-sessions.ts`.
 */

type RunStatus = Exclude<TestSession['status'], 'cancelled'>;

/** Status changes of `PATCH` that run the day (B-320); cancel and restore have their endpoints. */
const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  scheduled: ['in_progress'],
  in_progress: ['completed', 'scheduled'],
  completed: ['in_progress'],
};

/** `validation_failed` on `evaluatorId` unless it is a current staff member of the club. */
async function checkEvaluator(
  db: TenantDatabase,
  clubId: ClubId,
  evaluatorId: string | null | undefined,
): Promise<void> {
  if (evaluatorId === undefined || evaluatorId === null) return;
  if (!(await isClubStaff(db, clubId, evaluatorId))) {
    invalid(['body', 'evaluatorId'], 'The evaluator is not on the staff of the club');
  }
}

const TEST_SESSION_KEYS: KeysetSpec<TestSessionRow, 'scheduledOn' | 'createdAt'> = {
  fields: {
    scheduledOn: {
      column: dayKey(testSession.scheduledOn),
      type: 'text',
      value: (row) => row.scheduledOn,
    },
    createdAt: {
      column: testSession.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
  },
  id: { column: testSession.id, value: (row) => row.id },
};

async function readTestSessionRow(
  db: TenantDatabase,
  clubId: ClubId,
  testSessionId: string,
): Promise<TestSessionRow> {
  const [row] = await db
    .select(testSessionColumns)
    .from(testSession)
    .where(and(eq(testSession.clubId, clubId), eq(testSession.id, testSessionId)));
  if (row === undefined) throw new HttpError('not_found', 'Test day not found');
  return row;
}

/** Reads a test day and checks the caller may `action` it, on its category. */
async function authorizedTestSession(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  testSessionId: string,
  action: 'read' | 'manage',
): Promise<TestSessionRow> {
  const row = await readTestSessionRow(db, clubId, testSessionId);
  // A day without category (historical imports) is only in the scope of the whole club.
  await permissions.authorize(
    'test_session',
    action,
    row.categoryId === null ? {} : { category: { id: row.categoryId, sport: row.sport } },
  );
  return row;
}

/**
 * How a failed window check is answered: `400` on the body field that names
 * the window or the day (a create or a reschedule), or `409` when the request
 * has no body and the day is checked as it stands (a restore).
 */
type WindowProblem = { kind: 'field'; dayField: string } | { kind: 'conflict' };

/**
 * A window for a test day of `sport` on `day`: active, in an active season
 * of the same sport, containing the day. Takes the season's plan lock and
 * checks the window and its season as they are under it, so neither can move
 * away or be archived before the transaction commits.
 */
async function checkWindowFor(
  db: TenantDatabase,
  clubId: ClubId,
  testWindowId: string,
  sport: Sport,
  day: LocalDate,
  problem: WindowProblem,
): Promise<void> {
  const fail = (field: 'testWindowId' | 'day', message: string): never => {
    if (problem.kind === 'conflict') throw new HttpError('conflict', message);
    return invalid(['body', field === 'day' ? problem.dayField : 'testWindowId'], message);
  };
  const readWindow = () =>
    readTestWindowRow(db, clubId, testWindowId).catch((error: unknown) => {
      if (error instanceof HttpError && error.code === 'not_found') {
        return fail('testWindowId', 'The testing window does not exist in this club');
      }
      throw error;
    });
  await lockSeasonPlan(db, (await readWindow()).seasonId);
  // Read under the lock: a concurrent edit or archive of the plan may have committed meanwhile.
  const window = await readWindow();
  const parent = await readSeasonRow(db, clubId, window.seasonId);
  const label = testWindowLabel(windowNumber(window));
  if (window.archivedAt !== null || parent.archivedAt !== null) {
    fail('testWindowId', `${label} of ${parent.name} is archived`);
  }
  if (parent.sport !== sport) {
    fail('testWindowId', `${label} belongs to a season of another sport`);
  }
  if (!spanContainsDate(window, day)) {
    fail('day', `The day must fall within ${label} (${window.startsOn} to ${window.endsOn})`);
  }
}

export function registerTestSessionRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listTestSessions, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const scope = await permissions.listScope('test_session', 'read');
      const plan = keysetPage(TEST_SESSION_KEYS, query, {
        categoryId: query.categoryId,
        sport: query.sport,
        testWindowId: query.testWindowId,
        status: query.status,
        from: query.from,
        to: query.to,
      });
      if (scope.kind === 'none') return { items: [], nextCursor: null };
      let inScope: SQL | undefined;
      if (scope.kind === 'assigned') {
        // Days without category (imports) are only in the scope of the whole club.
        inScope = and(
          isNotNull(testSession.categoryId),
          or(
            scope.categoryIds.length > 0
              ? inArray(testSession.categoryId, [...scope.categoryIds])
              : undefined,
            scope.sports.length > 0 ? inArray(testSession.sport, [...scope.sports]) : undefined,
          ),
        );
      } else if (scope.kind !== 'club') {
        return { items: [], nextCursor: null };
      }
      const rows = await db
        .select(testSessionColumns)
        .from(testSession)
        .where(
          and(
            eq(testSession.clubId, caller.membership.clubId),
            inScope,
            query.categoryId === undefined
              ? undefined
              : eq(testSession.categoryId, query.categoryId),
            query.sport === undefined ? undefined : eq(testSession.sport, query.sport),
            query.testWindowId === undefined
              ? undefined
              : eq(testSession.testWindowId, query.testWindowId),
            query.status === undefined ? undefined : eq(testSession.status, query.status),
            query.from === undefined ? undefined : gte(testSession.scheduledOn, query.from),
            query.to === undefined ? undefined : lte(testSession.scheduledOn, query.to),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, testSessionDto);
    },
  });

  registerEndpoint(app, getTestSession, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) =>
      testSessionDto(
        await authorizedTestSession(
          db,
          permissions,
          caller.membership.clubId,
          params.testSessionId,
          'read',
        ),
      ),
  });

  registerEndpoint(app, createTestSession, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const target = await readCategoryFacts(db, clubId, body.categoryId);
      await permissions.authorize('test_session', 'manage', {
        category: { id: target.id, sport: target.sport },
      });
      const findByClientUuid = async (clientUuid: string) =>
        (
          await db
            .select(testSessionColumns)
            .from(testSession)
            .where(and(eq(testSession.clubId, clubId), eq(testSession.clientUuid, clientUuid)))
        )[0];
      const previous = await previousCreate(body.clientUuid, reply, findByClientUuid);
      if (previous !== undefined) return testSessionDto(previous);

      if (target.archivedAt !== null) invalid(['body', 'categoryId'], 'The category is archived');
      await checkEvaluator(db, clubId, body.evaluatorId);
      if (body.testWindowId !== undefined) {
        await checkWindowFor(db, clubId, body.testWindowId, target.sport, body.scheduledOn, {
          kind: 'field',
          dayField: 'scheduledOn',
        });
      }
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(testSession)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                sport: target.sport,
                categoryId: target.id,
                testWindowId: body.testWindowId ?? null,
                scheduledOn: body.scheduledOn,
                location: body.location ?? null,
                conditions: body.conditions === undefined ? {} : toConditions(body.conditions),
                notes: body.notes ?? null,
                evaluatorId: body.evaluatorId ?? null,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [testSession.clubId, testSession.clientUuid] })
              .returning(testSessionColumns)
          )[0],
        findByClientUuid,
      });
      return testSessionDto(row);
    },
  });

  registerEndpoint(app, updateTestSession, {
    transaction: true,
    // Rescheduling changes values already set: the history trigger asks for a reason (ADR 0030).
    changeReason: ({ body }) => body.changeReason,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const current = await authorizedTestSession(
        db,
        permissions,
        clubId,
        params.testSessionId,
        'manage',
      );
      if (current.status === 'cancelled') {
        throw new HttpError('conflict', 'A cancelled test day is not edited: restore it first');
      }
      const scheduledOn = body.scheduledOn ?? current.scheduledOn;
      const testWindowId =
        body.testWindowId === undefined ? current.testWindowId : body.testWindowId;
      const reschedules =
        scheduledOn !== current.scheduledOn || testWindowId !== current.testWindowId;
      if (reschedules && current.status !== 'scheduled') {
        throw new HttpError('conflict', `A test day that is ${current.status} is not rescheduled`);
      }
      await checkEvaluator(db, clubId, body.evaluatorId);
      let lifecycle: PgUpdateSetSource<typeof testSession> = {};
      if (body.status !== undefined && body.status !== current.status) {
        if (!RUN_TRANSITIONS[current.status].includes(body.status)) {
          throw new HttpError(
            'conflict',
            `A test day cannot go from ${current.status} to ${body.status}`,
          );
        }
        if (body.status === 'in_progress') {
          lifecycle = {
            status: body.status,
            startedAt: current.startedAt ?? sql`now()`,
            completedAt: null,
          };
        } else if (body.status === 'completed') {
          lifecycle = { status: body.status, completedAt: sql`now()` };
        } else {
          lifecycle = { status: body.status, startedAt: null, completedAt: null };
        }
      }
      if (
        testWindowId !== null &&
        (testWindowId !== current.testWindowId || scheduledOn !== current.scheduledOn)
      ) {
        await checkWindowFor(db, clubId, testWindowId, current.sport, scheduledOn, {
          kind: 'field',
          dayField: body.scheduledOn === undefined ? 'testWindowId' : 'scheduledOn',
        });
      }
      const where = and(eq(testSession.clubId, clubId), eq(testSession.id, current.id));
      const row = await updateAtVersion({
        resource: 'Test day',
        update: async () =>
          (
            await db
              .update(testSession)
              .set({
                ...(body.scheduledOn !== undefined && { scheduledOn: body.scheduledOn }),
                ...(body.testWindowId !== undefined && { testWindowId: body.testWindowId }),
                ...(body.location !== undefined && { location: body.location }),
                ...(body.conditions !== undefined && { conditions: toConditions(body.conditions) }),
                ...(body.notes !== undefined && { notes: body.notes }),
                ...(body.evaluatorId !== undefined && { evaluatorId: body.evaluatorId }),
                ...lifecycle,
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(testSession.updatedAt, body.version)))
              .returning(testSessionColumns)
          )[0],
        exists: async () =>
          (await db.select({ id: testSession.id }).from(testSession).where(where)).length > 0,
      });
      return testSessionDto(row);
    },
  });

  registerEndpoint(app, cancelTestSession, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const current = await authorizedTestSession(
        db,
        permissions,
        clubId,
        params.testSessionId,
        'manage',
      );
      if (current.status === 'cancelled') return testSessionDto(current);
      if (current.status !== 'scheduled') {
        throw new HttpError('conflict', `A test day that is ${current.status} is not cancelled`);
      }
      return testSessionDto(await setStatus(db, clubId, current.id, 'cancelled', caller.userId));
    },
  });

  registerEndpoint(app, restoreTestSession, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const current = await authorizedTestSession(
        db,
        permissions,
        clubId,
        params.testSessionId,
        'manage',
      );
      if (current.status === 'scheduled') return testSessionDto(current);
      if (current.status !== 'cancelled') {
        throw new HttpError('conflict', `A test day that is ${current.status} is not restored`);
      }
      // Back in its window only if the window still holds it: while the day was
      // cancelled the window may have moved, shrunk or been archived.
      if (current.testWindowId !== null) {
        await checkWindowFor(db, clubId, current.testWindowId, current.sport, current.scheduledOn, {
          kind: 'conflict',
        });
      }
      return testSessionDto(await setStatus(db, clubId, current.id, 'scheduled', caller.userId));
    },
  });
}

async function setStatus(
  db: TenantDatabase,
  clubId: ClubId,
  testSessionId: string,
  status: 'scheduled' | 'cancelled',
  userId: string,
): Promise<TestSessionRow> {
  const [row] = await db
    .update(testSession)
    .set({ status, updatedBy: userId })
    .where(and(eq(testSession.clubId, clubId), eq(testSession.id, testSessionId)))
    .returning(testSessionColumns);
  if (row === undefined) throw new HttpError('not_found', 'Test day not found');
  return row;
}
