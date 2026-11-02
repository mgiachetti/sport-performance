import {
  archiveCategory,
  createCategory,
  getCategory,
  listCategories,
  listPositions,
  restoreCategory,
  updateCategory,
  type Category,
  type Position,
} from '@sport-performance/contracts';
import { category, clubBranch, position } from '@sport-performance/db/schema';
import {
  DEFAULT_AGE_BANDS,
  type CategoryId,
  type ClubId,
  type Sex,
  type Sport,
  type Stage,
} from '@sport-performance/domain';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import {
  archiveStatusFilter,
  insertIdempotent,
  rowVersion,
  updateAtVersion,
  versionMatches,
} from '../http/writes.js';

/**
 * Categories (B-313): branch (sport + sex) and age band of the domain, named
 * by the club, independent of the season. Positions: the seeded catalog of
 * each sport (B-306).
 */

const categoryColumns = {
  id: category.id,
  sport: category.sport,
  sex: category.sex,
  ageBandCode: category.ageBandCode,
  name: category.name,
  defaultStage: category.defaultStage,
  sortOrder: category.sortOrder,
  archivedAt: category.archivedAt,
  createdAt: category.createdAt,
  updatedAt: category.updatedAt,
  version: rowVersion(category.updatedAt),
};

interface CategoryRow {
  id: CategoryId;
  sport: Sport;
  sex: Sex;
  ageBandCode: string;
  name: string;
  defaultStage: Stage;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

function categoryDto(row: CategoryRow): Category {
  return {
    id: row.id,
    sport: row.sport,
    sex: row.sex,
    ageBandCode: row.ageBandCode as Category['ageBandCode'],
    name: row.name,
    defaultStage: row.defaultStage,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const CATEGORY_KEYS: KeysetSpec<CategoryRow, 'sortOrder' | 'name' | 'createdAt'> = {
  fields: {
    sortOrder: { column: category.sortOrder, type: 'integer', value: (row) => row.sortOrder },
    name: { column: category.name, type: 'text', value: (row) => row.name },
    createdAt: { column: category.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: category.id, value: (row) => row.id },
};

const positionColumns = {
  id: position.id,
  sport: position.sport,
  code: position.code,
  label: position.label,
  lineCode: position.lineCode,
  sortOrder: position.sortOrder,
};

interface PositionRow {
  id: string;
  sport: Sport;
  code: string;
  label: string | null;
  lineCode: string | null;
  sortOrder: number;
}

const POSITION_KEYS: KeysetSpec<PositionRow, 'sortOrder' | 'code'> = {
  fields: {
    sortOrder: { column: position.sortOrder, type: 'integer', value: (row) => row.sortOrder },
    code: { column: position.code, type: 'text', value: (row) => row.code },
  },
  id: { column: position.id, value: (row) => row.id },
};

function positionDto(row: PositionRow): Position {
  return { ...row, id: row.id as Position['id'] };
}

async function readCategory(
  db: TenantDatabase,
  clubId: ClubId,
  categoryId: CategoryId,
): Promise<CategoryRow> {
  const [row] = await db
    .select(categoryColumns)
    .from(category)
    .where(and(eq(category.clubId, clubId), eq(category.id, categoryId)));
  if (row === undefined) throw new HttpError('not_found', 'Category not found');
  return row;
}

/** Reads one category and checks the caller may `action` it (the matrix scopes by assignment). */
async function authorizedCategory(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  categoryId: CategoryId,
  action: 'read' | 'manage',
): Promise<CategoryRow> {
  const row = await readCategory(db, clubId, categoryId);
  await permissions.authorize('category', action, {
    category: { id: row.id, sport: row.sport },
  });
  return row;
}

async function branchIsActive(
  db: TenantDatabase,
  clubId: ClubId,
  sport: Sport,
  sex: Sex,
): Promise<boolean> {
  const [row] = await db
    .select({ id: clubBranch.id })
    .from(clubBranch)
    .where(
      and(
        eq(clubBranch.clubId, clubId),
        eq(clubBranch.sport, sport),
        eq(clubBranch.sex, sex),
        isNull(clubBranch.archivedAt),
      ),
    );
  return row !== undefined;
}

export function registerCategoryRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listCategories, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const scope = await permissions.listScope('category', 'read');
      const plan = keysetPage(CATEGORY_KEYS, query, {
        sport: query.sport,
        sex: query.sex,
        ageBandCode: query.ageBandCode,
        status: query.status,
      });
      if (scope.kind === 'none') return { items: [], nextCursor: null };
      let inScope: SQL | undefined;
      if (scope.kind === 'assigned') {
        inScope = or(
          scope.categoryIds.length > 0 ? inArray(category.id, [...scope.categoryIds]) : undefined,
          scope.sports.length > 0 ? inArray(category.sport, [...scope.sports]) : undefined,
        );
      } else if (scope.kind !== 'club') {
        // No rule of `category.read` grants a `players` (or `platform`) scope: such a scope
        // would see no category until a rule says how it maps to them, so an empty page,
        // as for `none` (fail closed without a `403`: the role itself was allowed).
        return { items: [], nextCursor: null };
      }
      const rows = await db
        .select(categoryColumns)
        .from(category)
        .where(
          and(
            eq(category.clubId, caller.membership.clubId),
            inScope,
            query.sport === undefined ? undefined : eq(category.sport, query.sport),
            query.sex === undefined ? undefined : eq(category.sex, query.sex),
            query.ageBandCode === undefined
              ? undefined
              : eq(category.ageBandCode, query.ageBandCode),
            archiveStatusFilter(category.archivedAt, query.status),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, categoryDto);
    },
  });

  registerEndpoint(app, getCategory, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) =>
      categoryDto(
        await authorizedCategory(
          db,
          permissions,
          caller.membership.clubId,
          params.categoryId,
          'read',
        ),
      ),
  });

  registerEndpoint(app, createCategory, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('category', 'manage');
      const { clubId } = caller.membership;
      const bandIndex = DEFAULT_AGE_BANDS.findIndex((b) => b.code === body.ageBandCode);
      const band = DEFAULT_AGE_BANDS[bandIndex];
      if (band === undefined)
        throw new Error('createCategory: the contract let an unknown band in');
      if (!(await branchIsActive(db, clubId, body.sport, body.sex))) {
        throw new HttpError('validation_failed', 'The branch of the category is not enabled', {
          details: [
            {
              path: ['body', 'sport'],
              code: 'custom',
              message: 'Enable the branch (POST /v1/club/branches) or restore it first',
            },
          ],
        });
      }
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(category)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                sport: body.sport,
                sex: body.sex,
                ageBandCode: band.code,
                name: body.name ?? band.label,
                defaultStage: band.defaultStage,
                sortOrder: body.sortOrder ?? bandIndex,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [category.clubId, category.clientUuid] })
              .returning(categoryColumns)
          )[0],
        findByClientUuid: async (clientUuid) =>
          (
            await db
              .select(categoryColumns)
              .from(category)
              .where(and(eq(category.clubId, clubId), eq(category.clientUuid, clientUuid)))
          )[0],
      });
      return categoryDto(row);
    },
  });

  registerEndpoint(app, updateCategory, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const current = await authorizedCategory(
        db,
        permissions,
        clubId,
        params.categoryId,
        'manage',
      );
      // Archived (alone or with its branch) is read-only until restored: a change there
      // would not be seen in any active list, nor offered to the branch when it comes back.
      if (current.archivedAt !== null) {
        throw new HttpError('conflict', 'The category is archived: restore it first');
      }
      const where = and(eq(category.clubId, clubId), eq(category.id, params.categoryId));
      const row = await updateAtVersion({
        resource: 'Category',
        update: async () =>
          (
            await db
              .update(category)
              .set({
                ...(body.name !== undefined && { name: body.name }),
                ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
                updatedBy: caller.userId,
              })
              // Archived after the read above: `exists` finds it, so it is a `409` too.
              .where(
                and(
                  where,
                  isNull(category.archivedAt),
                  versionMatches(category.updatedAt, body.version),
                ),
              )
              .returning(categoryColumns)
          )[0],
        exists: async () =>
          (await db.select({ id: category.id }).from(category).where(where)).length > 0,
      });
      return categoryDto(row);
    },
  });

  registerEndpoint(app, archiveCategory, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await authorizedCategory(db, permissions, clubId, params.categoryId, 'manage');
      if (row.archivedAt !== null) return categoryDto(row);
      await db
        .update(category)
        .set({ archivedAt: sql`now()`, updatedBy: caller.userId })
        .where(and(eq(category.clubId, clubId), eq(category.id, params.categoryId)));
      return categoryDto(await readCategory(db, clubId, params.categoryId));
    },
  });

  registerEndpoint(app, restoreCategory, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await authorizedCategory(db, permissions, clubId, params.categoryId, 'manage');
      if (row.archivedAt === null) return categoryDto(row);
      if (!(await branchIsActive(db, clubId, row.sport, row.sex))) {
        throw new HttpError('conflict', 'The branch of the category is archived: restore it first');
      }
      await db
        .update(category)
        .set({ archivedAt: null, updatedBy: caller.userId })
        .where(and(eq(category.clubId, clubId), eq(category.id, params.categoryId)));
      return categoryDto(await readCategory(db, clubId, params.categoryId));
    },
  });

  registerEndpoint(app, listPositions, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      // Positions are part of the club's seeded catalog, readable by every member.
      await permissions.authorize('metric_catalog', 'read');
      const plan = keysetPage(POSITION_KEYS, query, { sport: query.sport });
      const rows = await db
        .select(positionColumns)
        .from(position)
        .where(
          and(
            eq(position.clubId, caller.membership.clubId),
            query.sport === undefined ? undefined : eq(position.sport, query.sport),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, positionDto);
    },
  });
}
