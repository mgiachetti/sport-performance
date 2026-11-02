import {
  archiveFixture,
  createFixture,
  getFixture,
  listFixtures,
  restoreFixture,
  updateFixture,
} from '@sport-performance/contracts';
import { category, fixture } from '@sport-performance/db/schema';
import type { ClubId } from '@sport-performance/domain';
import { and, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../../db/database.js';
import { registerEndpoint } from '../../http/endpoint.js';
import { HttpError } from '../../http/errors.js';
import { keysetPage, type KeysetSpec } from '../../http/pagination.js';
import type { RequestPermissions } from '../../http/permissions.js';
import {
  archiveStatusFilter,
  insertIdempotent,
  updateAtVersion,
  versionMatches,
} from '../../http/writes.js';
import {
  dayKey,
  fixtureDto,
  invalid,
  previousCreate,
  readCategoryFacts,
  readFixtureRow,
  selectFixtures,
  type FixtureRow,
} from './shared.js';

/**
 * The fixture (B-317): the matches of a category, with the day and kick-off
 * on the club's wall clock. It is planned like training (`training_session`
 * of the matrix: the coach of the category and the administration manage it;
 * the staff of the category reads it). A played match becomes a
 * `training_session` of kind `match` (B-318).
 */

const FIXTURE_KEYS: KeysetSpec<FixtureRow, 'date' | 'createdAt'> = {
  fields: {
    date: { column: dayKey(fixture.matchDate), type: 'text', value: (row) => row.date },
    createdAt: { column: fixture.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: fixture.id, value: (row) => row.id },
};

async function authorizedFixture(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  fixtureId: string,
  action: 'read' | 'manage',
): Promise<FixtureRow> {
  const row = await readFixtureRow(db, clubId, fixtureId);
  await permissions.authorize('training_session', action, {
    category: { id: row.categoryId, sport: row.sport },
  });
  return row;
}

export function registerFixtureRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listFixtures, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const scope = await permissions.listScope('training_session', 'read');
      const plan = keysetPage(FIXTURE_KEYS, query, {
        categoryId: query.categoryId,
        sport: query.sport,
        venue: query.venue,
        fixtureStatus: query.fixtureStatus,
        from: query.from,
        to: query.to,
        status: query.status,
      });
      if (scope.kind === 'none') return { items: [], nextCursor: null };
      let inScope: SQL | undefined;
      if (scope.kind === 'assigned') {
        inScope = or(
          scope.categoryIds.length > 0
            ? inArray(fixture.categoryId, [...scope.categoryIds])
            : undefined,
          scope.sports.length > 0 ? inArray(category.sport, [...scope.sports]) : undefined,
        );
      } else if (scope.kind !== 'club') {
        return { items: [], nextCursor: null };
      }
      const rows = await selectFixtures(
        db,
        and(
          eq(fixture.clubId, caller.membership.clubId),
          inScope,
          query.categoryId === undefined ? undefined : eq(fixture.categoryId, query.categoryId),
          query.sport === undefined ? undefined : eq(category.sport, query.sport),
          query.venue === undefined ? undefined : eq(fixture.venue, query.venue),
          query.fixtureStatus === undefined ? undefined : eq(fixture.status, query.fixtureStatus),
          query.from === undefined ? undefined : gte(fixture.matchDate, query.from),
          query.to === undefined ? undefined : lte(fixture.matchDate, query.to),
          archiveStatusFilter(fixture.archivedAt, query.status),
          plan.where,
        ),
        { orderBy: plan.orderBy, limit: plan.limit },
      );
      return plan.page(rows, fixtureDto);
    },
  });

  registerEndpoint(app, getFixture, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) =>
      fixtureDto(
        await authorizedFixture(
          db,
          permissions,
          caller.membership.clubId,
          params.fixtureId,
          'read',
        ),
      ),
  });

  registerEndpoint(app, createFixture, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const target = await readCategoryFacts(db, clubId, body.categoryId);
      await permissions.authorize('training_session', 'manage', {
        category: { id: target.id, sport: target.sport },
      });
      const findByClientUuid = async (clientUuid: string) =>
        (
          await db
            .select({ id: fixture.id })
            .from(fixture)
            .where(and(eq(fixture.clubId, clubId), eq(fixture.clientUuid, clientUuid)))
        )[0];
      const previous = await previousCreate(body.clientUuid, reply, findByClientUuid);
      if (previous !== undefined) return fixtureDto(await readFixtureRow(db, clubId, previous.id));

      if (target.archivedAt !== null) invalid(['body', 'categoryId'], 'The category is archived');
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(fixture)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                categoryId: target.id,
                opponent: body.opponent,
                venue: body.venue,
                competition: body.competition ?? null,
                matchDate: body.date,
                kickoffTime: body.kickoffTime ?? null,
                location: body.location ?? null,
                status: body.status,
                notes: body.notes ?? null,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [fixture.clubId, fixture.clientUuid] })
              .returning({ id: fixture.id })
          )[0],
        findByClientUuid,
      });
      return fixtureDto(await readFixtureRow(db, clubId, row.id));
    },
  });

  registerEndpoint(app, updateFixture, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      await authorizedFixture(db, permissions, clubId, params.fixtureId, 'manage');
      const where = and(eq(fixture.clubId, clubId), eq(fixture.id, params.fixtureId));
      await updateAtVersion({
        resource: 'Match',
        update: async () =>
          (
            await db
              .update(fixture)
              .set({
                ...(body.opponent !== undefined && { opponent: body.opponent }),
                ...(body.venue !== undefined && { venue: body.venue }),
                ...(body.competition !== undefined && { competition: body.competition }),
                ...(body.date !== undefined && { matchDate: body.date }),
                ...(body.kickoffTime !== undefined && { kickoffTime: body.kickoffTime }),
                ...(body.location !== undefined && { location: body.location }),
                ...(body.status !== undefined && { status: body.status }),
                ...(body.notes !== undefined && { notes: body.notes }),
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(fixture.updatedAt, body.version)))
              .returning({ id: fixture.id })
          )[0],
        exists: async () =>
          (await db.select({ id: fixture.id }).from(fixture).where(where)).length > 0,
      });
      return fixtureDto(await readFixtureRow(db, clubId, params.fixtureId));
    },
  });

  registerEndpoint(app, archiveFixture, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await authorizedFixture(db, permissions, clubId, params.fixtureId, 'manage');
      if (row.archivedAt !== null) return fixtureDto(row);
      await db
        .update(fixture)
        .set({ archivedAt: sql`now()`, updatedBy: caller.userId })
        .where(and(eq(fixture.clubId, clubId), eq(fixture.id, row.id)));
      return fixtureDto(await readFixtureRow(db, clubId, row.id));
    },
  });

  registerEndpoint(app, restoreFixture, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await authorizedFixture(db, permissions, clubId, params.fixtureId, 'manage');
      if (row.archivedAt === null) return fixtureDto(row);
      const target = await readCategoryFacts(db, clubId, row.categoryId);
      if (target.archivedAt !== null) {
        throw new HttpError('conflict', 'The category of the match is archived: restore it first');
      }
      await db
        .update(fixture)
        .set({ archivedAt: null, updatedBy: caller.userId })
        .where(and(eq(fixture.clubId, clubId), eq(fixture.id, row.id)));
      return fixtureDto(await readFixtureRow(db, clubId, row.id));
    },
  });
}
