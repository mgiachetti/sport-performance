import {
  archiveExternalLoad,
  correctExternalLoad,
  getExternalLoad,
  listExternalLoads,
  reportExternalLoad,
  type ExternalLoad,
} from '@sport-performance/contracts';
import { category, externalLoad, playerCategory } from '@sport-performance/db/schema';
import {
  isWithinExternalLoadWindow,
  localDateInTimeZone,
  type CategoryId,
  type ClubId,
  type ExternalLoadActivity,
  type LocalDate,
  type PlayerFacts,
  type PlayerId,
  type Sport,
} from '@sport-performance/domain';
import { and, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
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
import { categoryCurrentOn, clubTimeZone, clubToday, loadPlayerFacts } from './training-shared.js';

/**
 * External load (B-511, ADR 0084): what a player trains outside the club,
 * reported by the player (type, minutes, CR-10 RPE) and added by the worker
 * to their daily load as reported by the player. Only the player reports,
 * corrects and archives their own, within the window of the domain; the
 * staff reads it by the scope of the matrix.
 */

export const externalLoadColumns = {
  id: externalLoad.id,
  playerId: externalLoad.playerId,
  localDate: externalLoad.localDate,
  activity: externalLoad.activity,
  detail: externalLoad.detail,
  minutes: externalLoad.minutes,
  rpe: externalLoad.rpe,
  srpeAu: externalLoad.srpeAu,
  archivedAt: externalLoad.archivedAt,
  createdAt: externalLoad.createdAt,
  updatedAt: externalLoad.updatedAt,
  version: rowVersion(externalLoad.updatedAt),
};

export interface ExternalLoadRow {
  id: string;
  playerId: PlayerId;
  localDate: LocalDate;
  activity: ExternalLoadActivity;
  detail: string | null;
  minutes: number;
  rpe: number;
  srpeAu: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

export function externalLoadDto(row: ExternalLoadRow): ExternalLoad {
  return {
    id: row.id as ExternalLoad['id'],
    playerId: row.playerId,
    localDate: row.localDate,
    activity: row.activity,
    detail: row.detail,
    minutes: row.minutes,
    rpe: row.rpe,
    srpeAu: row.srpeAu,
    reportedBy: 'player',
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const EXTERNAL_LOAD_KEYS: KeysetSpec<ExternalLoadRow, 'localDate' | 'createdAt'> = {
  fields: {
    // `YYYY-MM-DD` sorts as text in calendar order.
    localDate: {
      column: sql`${externalLoad.localDate}::text`,
      type: 'text',
      value: (row) => row.localDate,
    },
    createdAt: {
      column: externalLoad.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
  },
  id: { column: externalLoad.id, value: (row) => row.id },
};

/**
 * The club day the window is measured from: today, or the club day the
 * offline queue recorded the write (ADR 0050: windows are checked when the
 * mutation was recorded, never ahead of the server).
 */
async function referenceDay(
  db: TenantDatabase,
  clubId: ClubId,
  recordedAt: Date | undefined,
): Promise<LocalDate> {
  if (recordedAt === undefined) return clubToday(db);
  return localDateInTimeZone(recordedAt, await clubTimeZone(db, clubId));
}

/** The caller's own player, authorized to report (self + data consent). */
async function reportingPlayer(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
): Promise<PlayerFacts> {
  const subject = await permissions.subject();
  const playerId = subject.playerId ?? null;
  if (subject.role !== 'player' || playerId === null) {
    // Not a player (or a player without a profile): the matrix answers 403.
    await permissions.authorize('external_load', 'report');
    throw new HttpError('forbidden', 'Only a player reports their external load');
  }
  const facts = (await loadPlayerFacts(db, clubId, [playerId])).get(playerId);
  if (facts === undefined) throw new HttpError('forbidden', 'The player is not visible');
  await permissions.authorize('external_load', 'report', { player: facts });
  return facts;
}

/** Facts of the player of an entry, for the matrix; `404` when not visible. */
async function factsOf(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
): Promise<PlayerFacts> {
  const facts = (await loadPlayerFacts(db, clubId, [playerId])).get(playerId);
  if (facts === undefined) throw new HttpError('not_found', 'External load not found');
  return facts;
}

async function readExternalLoad(
  db: TenantDatabase,
  clubId: ClubId,
  externalLoadId: string,
): Promise<ExternalLoadRow> {
  const [row] = await db
    .select(externalLoadColumns)
    .from(externalLoad)
    .where(and(eq(externalLoad.clubId, clubId), eq(externalLoad.id, externalLoadId)));
  if (row === undefined) throw new HttpError('not_found', 'External load not found');
  return row;
}

function windowIssue(today: LocalDate) {
  return {
    path: ['body', 'localDate'],
    code: 'custom',
    message: `A club day of the last week, through today (${today})`,
  };
}

/** Players whose current category is in the assignments (as `app.visible_player_ids`). */
function assignedPlayers(
  today: LocalDate,
  categoryIds: readonly CategoryId[],
  sports: readonly Sport[],
): SQL {
  const target = or(
    categoryIds.length > 0 ? inArray(category.id, [...categoryIds]) : undefined,
    sports.length > 0 ? inArray(category.sport, [...sports]) : undefined,
  );
  return sql`exists (
    select 1 from ${playerCategory}
      join ${category} on ${category.clubId} = ${playerCategory.clubId}
                      and ${category.id} = ${playerCategory.categoryId}
     where ${playerCategory.clubId} = ${externalLoad.clubId}
       and ${playerCategory.playerId} = ${externalLoad.playerId}
       and ${categoryCurrentOn(today)}
       and ${target})`;
}

/** Entries whose player was in `categoryId` on the day of the activity. */
function inCategoryOnTheDay(categoryId: CategoryId): SQL {
  return sql`exists (
    select 1 from ${playerCategory}
     where ${playerCategory.clubId} = ${externalLoad.clubId}
       and ${playerCategory.playerId} = ${externalLoad.playerId}
       and ${playerCategory.categoryId} = ${categoryId}
       and ${playerCategory.validFrom} <= ${externalLoad.localDate}
       and (${playerCategory.validTo} is null or ${playerCategory.validTo} > ${externalLoad.localDate}))`;
}

export function registerExternalLoadRoutes(app: FastifyInstance): void {
  registerEndpoint(app, reportExternalLoad, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply, recordedAt }) => {
      const { clubId } = caller.membership;
      const facts = await reportingPlayer(db, permissions, clubId);
      if (body.clientUuid !== undefined) {
        // A replay of the offline queue answers what it created, even after the window closed.
        const [replay] = await db
          .select(externalLoadColumns)
          .from(externalLoad)
          .where(
            and(
              eq(externalLoad.clubId, clubId),
              eq(externalLoad.playerId, facts.id),
              eq(externalLoad.clientUuid, body.clientUuid),
            ),
          );
        if (replay !== undefined) {
          markReplay(reply);
          return externalLoadDto(replay);
        }
      }
      const today = await referenceDay(db, clubId, recordedAt);
      const day = body.localDate ?? today;
      if (!isWithinExternalLoadWindow(day, today)) {
        throw new HttpError('validation_failed', 'External load is reported for the last week', {
          details: [windowIssue(today)],
        });
      }
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(externalLoad)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                playerId: facts.id,
                localDate: day,
                activity: body.activity,
                detail: body.detail ?? null,
                minutes: body.minutes,
                rpe: body.rpe,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [externalLoad.clubId, externalLoad.clientUuid] })
              .returning(externalLoadColumns)
          )[0],
        findByClientUuid: async (clientUuid) =>
          (
            await db
              .select(externalLoadColumns)
              .from(externalLoad)
              .where(and(eq(externalLoad.clubId, clubId), eq(externalLoad.clientUuid, clientUuid)))
          )[0],
      });
      return externalLoadDto(row);
    },
  });

  registerEndpoint(app, correctExternalLoad, {
    transaction: true,
    changeReason: ({ body }) => body.changeReason,
    handler: async ({ params, body }, { db, permissions, auth: caller, recordedAt }) => {
      const { clubId } = caller.membership;
      const entry = await readExternalLoad(db, clubId, params.externalLoadId);
      const facts = await factsOf(db, clubId, entry.playerId);
      await permissions.authorize('external_load', 'report', { player: facts });
      if (entry.archivedAt !== null) {
        throw new HttpError('conflict', 'The external load is archived: report it again');
      }
      const today = await referenceDay(db, clubId, recordedAt);
      if (!isWithinExternalLoadWindow(entry.localDate, today)) {
        throw new HttpError(
          'conflict',
          'Only the external load of the last week is corrected by the player',
        );
      }
      if (body.localDate !== undefined && !isWithinExternalLoadWindow(body.localDate, today)) {
        throw new HttpError('validation_failed', 'External load is reported for the last week', {
          details: [windowIssue(today)],
        });
      }
      const row = await updateAtVersion({
        resource: 'External load',
        update: async () =>
          (
            await db
              .update(externalLoad)
              .set({
                ...(body.localDate !== undefined && { localDate: body.localDate }),
                ...(body.activity !== undefined && { activity: body.activity }),
                ...(body.detail !== undefined && { detail: body.detail }),
                ...(body.minutes !== undefined && { minutes: body.minutes }),
                ...(body.rpe !== undefined && { rpe: body.rpe }),
                updatedBy: caller.userId,
              })
              .where(
                and(
                  eq(externalLoad.clubId, clubId),
                  eq(externalLoad.id, entry.id),
                  isNull(externalLoad.archivedAt),
                  versionMatches(externalLoad.updatedAt, body.version),
                ),
              )
              .returning(externalLoadColumns)
          )[0],
        exists: async () =>
          (
            await db
              .select({ id: externalLoad.id })
              .from(externalLoad)
              .where(and(eq(externalLoad.clubId, clubId), eq(externalLoad.id, entry.id)))
          ).length > 0,
      });
      return externalLoadDto(row);
    },
  });

  registerEndpoint(app, archiveExternalLoad, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller, recordedAt }) => {
      const { clubId } = caller.membership;
      const entry = await readExternalLoad(db, clubId, params.externalLoadId);
      const facts = await factsOf(db, clubId, entry.playerId);
      await permissions.authorize('external_load', 'report', { player: facts });
      // Idempotent: archiving again answers the archived entry, also after the window.
      if (entry.archivedAt !== null) return externalLoadDto(entry);
      const today = await referenceDay(db, clubId, recordedAt);
      if (!isWithinExternalLoadWindow(entry.localDate, today)) {
        throw new HttpError(
          'conflict',
          'Only the external load of the last week is archived by the player',
        );
      }
      const [row] = await db
        .update(externalLoad)
        .set({ archivedAt: sql`now()`, updatedBy: caller.userId })
        .where(
          and(
            eq(externalLoad.clubId, clubId),
            eq(externalLoad.id, entry.id),
            isNull(externalLoad.archivedAt),
          ),
        )
        .returning(externalLoadColumns);
      // A concurrent archive won: answer the archived row.
      return externalLoadDto(row ?? (await readExternalLoad(db, clubId, entry.id)));
    },
  });

  registerEndpoint(app, listExternalLoads, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const scope = await permissions.listScope('external_load', 'read');
      const plan = keysetPage(EXTERNAL_LOAD_KEYS, query, {
        playerId: query.playerId,
        categoryId: query.categoryId,
        from: query.from,
        to: query.to,
        status: query.status,
      });
      if (scope.kind === 'none') return { items: [], nextCursor: null };
      if (scope.rowCheck) {
        // `external_load.read` has no consent or condition today; a new one needs a row check here.
        throw new Error('listExternalLoads: the matrix asks for a row check the list does not do');
      }
      let inScope: SQL | undefined;
      switch (scope.kind) {
        case 'club':
          inScope = undefined;
          break;
        case 'assigned':
          inScope = assignedPlayers(await clubToday(db), scope.categoryIds, scope.sports);
          break;
        case 'players':
          inScope = inArray(externalLoad.playerId, [...scope.playerIds]);
          break;
        case 'platform':
          // No rule of `external_load.read` is platform-wide: deny instead of guessing.
          return { items: [], nextCursor: null };
      }
      const rows = await db
        .select(externalLoadColumns)
        .from(externalLoad)
        .where(
          and(
            eq(externalLoad.clubId, caller.membership.clubId),
            inScope,
            archiveStatusFilter(externalLoad.archivedAt, query.status),
            query.playerId === undefined ? undefined : eq(externalLoad.playerId, query.playerId),
            query.categoryId === undefined ? undefined : inCategoryOnTheDay(query.categoryId),
            query.from === undefined ? undefined : gte(externalLoad.localDate, query.from),
            query.to === undefined ? undefined : lte(externalLoad.localDate, query.to),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, externalLoadDto);
    },
  });

  registerEndpoint(app, getExternalLoad, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const entry = await readExternalLoad(db, clubId, params.externalLoadId);
      const facts = await factsOf(db, clubId, entry.playerId);
      await permissions.authorize('external_load', 'read', { player: facts });
      return externalLoadDto(entry);
    },
  });
}
