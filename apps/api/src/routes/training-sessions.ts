import {
  archiveTrainingSession,
  createDrill,
  createTrainingSession,
  deleteDrill,
  getTrainingSession,
  listTrainingSessions,
  restoreTrainingSession,
  updateDrill,
  updateTrainingSession,
  type Drill,
  type TrainingSessionDetail,
} from '@sport-performance/contracts';
import { category, drill, trainingSession } from '@sport-performance/db/schema';
import {
  localDateInTimeZone,
  type CategoryId,
  type ClubId,
  type ContactLevel,
  type Sport,
} from '@sport-performance/domain';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import type { ClubAuthContext } from '../http/endpoint.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError, databaseErrorOf } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import {
  archiveStatusFilter,
  insertIdempotent,
  markReplay,
  rowVersion,
  updateAtVersion,
  versionMatches,
} from '../http/writes.js';
import {
  assertSessionActive,
  authorizeSession,
  clubTimeZone,
  readSession,
  sessionColumns,
  sessionDto,
  type SessionRow,
} from './training-shared.js';

/**
 * Training sessions and matches with their drills (B-318). Sessions belong
 * to a category (the matrix scopes them by assignment); "the day" of a
 * session is computed in the club's time zone. Sessions are archived, never
 * deleted; drills, the plan of a session, are the one table the database
 * lets the application delete from (ADR 0026, ADR 0032).
 */

const SESSION_KEYS: KeysetSpec<SessionRow, 'startsAt' | 'createdAt'> = {
  fields: {
    startsAt: {
      column: trainingSession.startsAt,
      type: 'timestamp',
      value: (row) => row.startsAt,
    },
    createdAt: {
      column: trainingSession.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
  },
  id: { column: trainingSession.id, value: (row) => row.id },
};

const drillColumns = {
  id: drill.id,
  trainingSessionId: drill.trainingSessionId,
  name: drill.name,
  sortOrder: drill.sortOrder,
  durationMin: drill.durationMin,
  contactLevel: drill.contactLevel,
  notes: drill.notes,
  createdAt: drill.createdAt,
  updatedAt: drill.updatedAt,
  version: rowVersion(drill.updatedAt),
};

interface DrillRow {
  id: string;
  trainingSessionId: string;
  name: string;
  sortOrder: number;
  durationMin: number | null;
  contactLevel: ContactLevel;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

function drillDto(row: DrillRow): Drill {
  return {
    id: row.id as Drill['id'],
    trainingSessionId: row.trainingSessionId as Drill['trainingSessionId'],
    name: row.name,
    sortOrder: row.sortOrder,
    durationMin: row.durationMin,
    contactLevel: row.contactLevel,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

async function drillsOf(
  db: TenantDatabase,
  clubId: ClubId,
  sessionId: string,
): Promise<DrillRow[]> {
  return db
    .select(drillColumns)
    .from(drill)
    .where(and(eq(drill.clubId, clubId), eq(drill.trainingSessionId, sessionId)))
    .orderBy(asc(drill.sortOrder), asc(drill.createdAt), asc(drill.id));
}

async function detailOf(
  db: TenantDatabase,
  clubId: ClubId,
  row: SessionRow,
): Promise<TrainingSessionDetail> {
  return { ...sessionDto(row), drills: (await drillsOf(db, clubId, row.id)).map(drillDto) };
}

/**
 * The category of a new or moved session: it must exist in the club and be
 * active. A missing one is the body's fault (`400`), like a broken foreign key.
 */
async function activeCategory(
  db: TenantDatabase,
  clubId: ClubId,
  categoryId: CategoryId,
): Promise<{ id: CategoryId; sport: Sport }> {
  const [row] = await db
    .select({ id: category.id, sport: category.sport })
    .from(category)
    .where(
      and(eq(category.clubId, clubId), eq(category.id, categoryId), isNull(category.archivedAt)),
    );
  if (row === undefined) {
    throw new HttpError('validation_failed', 'The category does not exist or is archived', {
      details: [
        { path: ['body', 'categoryId'], code: 'custom', message: 'Unknown or archived category' },
      ],
    });
  }
  return row;
}

/** A session and the permission to manage it; `404` for another club's. */
async function manageableSession(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  sessionId: string,
): Promise<SessionRow> {
  const row = await readSession(db, clubId, sessionId);
  await authorizeSession(permissions, row, 'manage');
  return row;
}

/** A drill, its session and the permission to manage it. */
async function manageableDrill(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  drillId: string,
): Promise<{ drill: DrillRow; session: SessionRow }> {
  const [row] = await db
    .select(drillColumns)
    .from(drill)
    .where(and(eq(drill.clubId, clubId), eq(drill.id, drillId)));
  if (row === undefined) throw new HttpError('not_found', 'Drill not found');
  const session = await manageableSession(db, permissions, clubId, row.trainingSessionId);
  return { drill: row, session };
}

async function nextDrillOrder(
  db: TenantDatabase,
  clubId: ClubId,
  sessionId: string,
): Promise<number> {
  const [row] = await db
    .select({ next: sql<number>`coalesce(max(${drill.sortOrder}) + 1, 0)::int` })
    .from(drill)
    .where(and(eq(drill.clubId, clubId), eq(drill.trainingSessionId, sessionId)));
  return Math.min(row?.next ?? 0, 32_767);
}

function setArchived(
  db: TenantDatabase,
  caller: ClubAuthContext,
  sessionId: string,
  archived: boolean,
) {
  return db
    .update(trainingSession)
    .set({ archivedAt: archived ? sql`now()` : null, updatedBy: caller.userId })
    .where(
      and(eq(trainingSession.clubId, caller.membership.clubId), eq(trainingSession.id, sessionId)),
    );
}

export function registerTrainingSessionRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listTrainingSessions, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const scope = await permissions.listScope('training_session', 'read');
      const plan = keysetPage(SESSION_KEYS, query, {
        categoryId: query.categoryId,
        sport: query.sport,
        kind: query.kind,
        from: query.from,
        to: query.to,
        status: query.status,
      });
      if (scope.kind === 'none') return { items: [], nextCursor: null };
      let inScope: SQL | undefined;
      if (scope.kind === 'assigned') {
        inScope = or(
          scope.categoryIds.length > 0
            ? inArray(trainingSession.categoryId, [...scope.categoryIds])
            : undefined,
          scope.sports.length > 0 ? inArray(trainingSession.sport, [...scope.sports]) : undefined,
        );
      } else if (scope.kind !== 'club') {
        // No rule of `training_session.read` scopes by player.
        return { items: [], nextCursor: null };
      }
      const rows = await db
        .select(sessionColumns)
        .from(trainingSession)
        .where(
          and(
            eq(trainingSession.clubId, caller.membership.clubId),
            inScope,
            query.categoryId === undefined
              ? undefined
              : eq(trainingSession.categoryId, query.categoryId),
            query.sport === undefined ? undefined : eq(trainingSession.sport, query.sport),
            query.kind === undefined ? undefined : eq(trainingSession.kind, query.kind),
            query.from === undefined ? undefined : gte(trainingSession.localDate, query.from),
            query.to === undefined ? undefined : lte(trainingSession.localDate, query.to),
            archiveStatusFilter(trainingSession.archivedAt, query.status),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, sessionDto);
    },
  });

  registerEndpoint(app, getTrainingSession, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await readSession(db, clubId, params.trainingSessionId);
      await authorizeSession(permissions, row, 'read');
      return detailOf(db, clubId, row);
    },
  });

  registerEndpoint(app, createTrainingSession, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const target = await activeCategory(db, clubId, body.categoryId);
      await permissions.authorize('training_session', 'manage', { category: target });
      const timeZone = await clubTimeZone(db, clubId);
      const startsAt = new Date(body.startsAt);
      const { row, replayed } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(trainingSession)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                sport: target.sport,
                kind: body.kind,
                categoryId: target.id,
                title: body.title ?? null,
                startsAt,
                localDate: localDateInTimeZone(startsAt, timeZone),
                plannedDurationMin: body.plannedDurationMin ?? null,
                location: body.location ?? null,
                opponent: body.opponent ?? null,
                notes: body.notes ?? null,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [trainingSession.clubId, trainingSession.clientUuid] })
              .returning(sessionColumns)
          )[0],
        findByClientUuid: async (clientUuid) =>
          (
            await db
              .select(sessionColumns)
              .from(trainingSession)
              .where(
                and(eq(trainingSession.clubId, clubId), eq(trainingSession.clientUuid, clientUuid)),
              )
          )[0],
      });
      if (!replayed && body.drills !== undefined && body.drills.length > 0) {
        await db.insert(drill).values(
          body.drills.map((d, index) => ({
            clubId,
            ...(d.clientUuid !== undefined && { clientUuid: d.clientUuid }),
            trainingSessionId: row.id,
            name: d.name,
            sortOrder: d.sortOrder ?? index,
            durationMin: d.durationMin ?? null,
            contactLevel: d.contactLevel ?? 'none',
            notes: d.notes ?? null,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          })),
        );
      }
      return detailOf(db, clubId, row);
    },
  });

  registerEndpoint(app, updateTrainingSession, {
    transaction: true,
    changeReason: ({ body }) => body.changeReason,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const current = await manageableSession(db, permissions, clubId, params.trainingSessionId);
      assertSessionActive(current);
      let target: { id: CategoryId; sport: Sport } | undefined;
      if (body.categoryId !== undefined && body.categoryId !== current.categoryId) {
        target = await activeCategory(db, clubId, body.categoryId);
        await permissions.authorize('training_session', 'manage', { category: target });
      }
      const kind = body.kind ?? current.kind;
      const opponent = body.opponent === undefined ? current.opponent : body.opponent;
      if (kind === 'training' && opponent !== null) {
        throw new HttpError('validation_failed', 'Only matches have an opponent', {
          details: [
            {
              path: ['body', 'opponent'],
              code: 'custom',
              message: 'Clear the opponent (null) to turn a match into a training session',
            },
          ],
        });
      }
      let startsAt: Date | undefined;
      let localDate: SessionRow['localDate'] | undefined;
      if (body.startsAt !== undefined) {
        startsAt = new Date(body.startsAt);
        localDate = localDateInTimeZone(startsAt, await clubTimeZone(db, clubId));
      }
      const where = and(
        eq(trainingSession.clubId, clubId),
        eq(trainingSession.id, params.trainingSessionId),
      );
      const row = await updateAtVersion({
        resource: 'Training session',
        update: async () =>
          (
            await db
              .update(trainingSession)
              .set({
                ...(body.kind !== undefined && { kind: body.kind }),
                ...(target !== undefined && { categoryId: target.id, sport: target.sport }),
                ...(startsAt !== undefined && { startsAt }),
                ...(localDate !== undefined && { localDate }),
                ...(body.plannedDurationMin !== undefined && {
                  plannedDurationMin: body.plannedDurationMin,
                }),
                ...(body.title !== undefined && { title: body.title }),
                ...(body.location !== undefined && { location: body.location }),
                ...(body.opponent !== undefined && { opponent: body.opponent }),
                ...(body.notes !== undefined && { notes: body.notes }),
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(trainingSession.updatedAt, body.version)))
              .returning(sessionColumns)
          )[0],
        exists: async () =>
          (await db.select({ id: trainingSession.id }).from(trainingSession).where(where)).length >
          0,
      });
      return sessionDto(row);
    },
  });

  registerEndpoint(app, archiveTrainingSession, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await manageableSession(db, permissions, clubId, params.trainingSessionId);
      if (row.archivedAt !== null) return sessionDto(row);
      await setArchived(db, caller, row.id, true);
      return sessionDto(await readSession(db, clubId, row.id));
    },
  });

  registerEndpoint(app, restoreTrainingSession, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await manageableSession(db, permissions, clubId, params.trainingSessionId);
      if (row.archivedAt === null) return sessionDto(row);
      await setArchived(db, caller, row.id, false);
      return sessionDto(await readSession(db, clubId, row.id));
    },
  });

  registerEndpoint(app, createDrill, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const session = await manageableSession(db, permissions, clubId, params.trainingSessionId);
      const findByClientUuid = async (clientUuid: string) =>
        (
          await db
            .select(drillColumns)
            .from(drill)
            .where(and(eq(drill.clubId, clubId), eq(drill.clientUuid, clientUuid)))
        )[0];
      // A replay answers what the first request created, also once the session is archived.
      if (body.clientUuid !== undefined) {
        const previous = await findByClientUuid(body.clientUuid);
        if (previous !== undefined) {
          if (previous.trainingSessionId !== session.id) {
            throw new HttpError('conflict', 'This clientUuid was already used');
          }
          markReplay(reply);
          return drillDto(previous);
        }
      }
      assertSessionActive(session);
      const sortOrder = body.sortOrder ?? (await nextDrillOrder(db, clubId, session.id));
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(drill)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                trainingSessionId: session.id,
                name: body.name,
                sortOrder,
                durationMin: body.durationMin ?? null,
                contactLevel: body.contactLevel ?? 'none',
                notes: body.notes ?? null,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [drill.clubId, drill.clientUuid] })
              .returning(drillColumns)
          )[0],
        findByClientUuid: async (clientUuid) => {
          const found = await findByClientUuid(clientUuid);
          // The same clientUuid on a drill of another session is another create.
          return found?.trainingSessionId === session.id ? found : undefined;
        },
      });
      return drillDto(row);
    },
  });

  registerEndpoint(app, updateDrill, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { session } = await manageableDrill(db, permissions, clubId, params.drillId);
      assertSessionActive(session);
      const where = and(eq(drill.clubId, clubId), eq(drill.id, params.drillId));
      const row = await updateAtVersion({
        resource: 'Drill',
        update: async () =>
          (
            await db
              .update(drill)
              .set({
                ...(body.name !== undefined && { name: body.name }),
                ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
                ...(body.durationMin !== undefined && { durationMin: body.durationMin }),
                ...(body.contactLevel !== undefined && { contactLevel: body.contactLevel }),
                ...(body.notes !== undefined && { notes: body.notes }),
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(drill.updatedAt, body.version)))
              .returning(drillColumns)
          )[0],
        exists: async () => (await db.select({ id: drill.id }).from(drill).where(where)).length > 0,
      });
      return drillDto(row);
    },
  });

  registerEndpoint(app, deleteDrill, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { session } = await manageableDrill(db, permissions, clubId, params.drillId);
      assertSessionActive(session);
      try {
        await db.delete(drill).where(and(eq(drill.clubId, clubId), eq(drill.id, params.drillId)));
      } catch (error) {
        // Field metrics (B-601) point at the drill: it is part of the history now.
        if (databaseErrorOf(error)?.code === '23503') {
          throw new HttpError('conflict', 'The drill has recorded metrics: it cannot be removed', {
            cause: error,
          });
        }
        throw error;
      }
      return undefined;
    },
  });
}
