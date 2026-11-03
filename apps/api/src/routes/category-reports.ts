import {
  getCategoryReport,
  listCategoryReports,
  requestCategoryReport,
  type CategoryReport,
} from '@sport-performance/contracts';
import { category, categoryReport, file, season, testWindow } from '@sport-performance/db/schema';
import {
  compareLocalDates,
  type CategoryId,
  type ClubId,
  type LocalDate,
  type PlayerReportFailureCode,
  type PlayerReportStatus,
  type Sport,
} from '@sport-performance/domain';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { loadCategoryFacts } from '../files/player-facts.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import { insertIdempotent, markReplay } from '../http/writes.js';
import {
  buildCategoryReportContent,
  type CategoryReportWindow,
  type ReportCategory,
} from '../reports/category-report-content.js';
import { byBatteryOrder } from './test-session-sheet.js';
import { clubToday } from './training-shared.js';

/**
 * The PDF report of a category for a test window (B-603, ADR 0073). The test
 * staff asks for it (`category_report.generate`): the handler freezes what it
 * shows, aggregates of the group only, and leaves it `pending`; the worker
 * renders it into a `category_report` file. The staff of the category and
 * the administration read it (`category_report.read`) and download the file
 * through the files endpoints.
 */

interface ReportRow {
  id: string;
  clientUuid: string;
  categoryId: CategoryId;
  testWindowId: string;
  seasonName: string;
  number: number;
  startsOn: LocalDate;
  endsOn: LocalDate;
  status: PlayerReportStatus;
  fileId: string | null;
  fileStatus: string | null;
  failureCode: PlayerReportFailureCode | null;
  createdBy: string | null;
  createdAt: Date;
  generatedAt: Date | null;
}

const REPORT_KEYS: KeysetSpec<ReportRow, 'createdAt'> = {
  fields: {
    createdAt: {
      column: categoryReport.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
  },
  id: { column: categoryReport.id, value: (row) => row.id },
};

/** Reports of the club under RLS, with their window and whether their file can be downloaded. */
function selectReports(db: TenantDatabase, clubId: ClubId, where: SQL | undefined) {
  return db
    .select({
      id: categoryReport.id,
      clientUuid: categoryReport.clientUuid,
      categoryId: categoryReport.categoryId,
      testWindowId: categoryReport.testWindowId,
      seasonName: season.name,
      number: testWindow.number,
      startsOn: testWindow.startsOn,
      endsOn: testWindow.endsOn,
      status: categoryReport.status,
      fileId: categoryReport.fileId,
      fileStatus: file.status,
      failureCode: categoryReport.failureCode,
      createdBy: categoryReport.createdBy,
      createdAt: categoryReport.createdAt,
      generatedAt: categoryReport.generatedAt,
    })
    .from(categoryReport)
    .innerJoin(
      testWindow,
      and(
        eq(testWindow.clubId, categoryReport.clubId),
        eq(testWindow.id, categoryReport.testWindowId),
      ),
    )
    .innerJoin(
      season,
      and(eq(season.clubId, testWindow.clubId), eq(season.id, testWindow.seasonId)),
    )
    .leftJoin(file, and(eq(file.clubId, categoryReport.clubId), eq(file.id, categoryReport.fileId)))
    .where(and(eq(categoryReport.clubId, clubId), where));
}

function reportDto(row: ReportRow): CategoryReport {
  return {
    id: row.id as CategoryReport['id'],
    categoryId: row.categoryId,
    testWindowId: row.testWindowId as CategoryReport['testWindowId'],
    window: {
      seasonName: row.seasonName,
      number: row.number,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
    },
    status: row.status,
    // Past its retention (or deleted) the PDF is gone: the report says so without a file.
    fileId: row.fileStatus === 'ready' ? (row.fileId as CategoryReport['fileId']) : null,
    failureCode: row.failureCode,
    requestedBy: row.createdBy as CategoryReport['requestedBy'],
    createdAt: row.createdAt.toISOString(),
    generatedAt: row.generatedAt?.toISOString() ?? null,
  };
}

async function requireReport(
  db: TenantDatabase,
  clubId: ClubId,
  reportId: string,
): Promise<ReportRow> {
  const [row] = await selectReports(db, clubId, eq(categoryReport.id, reportId));
  if (row === undefined) throw new HttpError('not_found', 'Report not found');
  return row;
}

/** The category with what the report prints, or `404`. */
async function requireCategory(
  db: TenantDatabase,
  clubId: ClubId,
  categoryId: CategoryId,
): Promise<ReportCategory & { archived: boolean }> {
  const [row] = await db
    .select({
      id: category.id,
      name: category.name,
      sport: category.sport,
      sex: category.sex,
      ageBandCode: category.ageBandCode,
      archivedAt: category.archivedAt,
    })
    .from(category)
    .where(and(eq(category.clubId, clubId), eq(category.id, categoryId)));
  if (row === undefined) throw new HttpError('not_found', 'Category not found');
  return {
    id: row.id,
    name: row.name,
    sport: row.sport,
    sex: row.sex,
    ageBandCode: row.ageBandCode,
    archived: row.archivedAt !== null,
  };
}

/** A window of a season of the sport, neither archived. */
async function requireWindow(
  db: TenantDatabase,
  clubId: ClubId,
  windowId: string,
  sport: Sport,
): Promise<CategoryReportWindow> {
  const [row] = await db
    .select({
      id: testWindow.id,
      seasonId: season.id,
      seasonName: season.name,
      seasonStartsOn: season.startsOn,
      sport: season.sport,
      number: testWindow.number,
      startsOn: testWindow.startsOn,
      endsOn: testWindow.endsOn,
    })
    .from(testWindow)
    .innerJoin(
      season,
      and(eq(season.clubId, testWindow.clubId), eq(season.id, testWindow.seasonId)),
    )
    .where(
      and(
        eq(testWindow.clubId, clubId),
        eq(testWindow.id, windowId),
        isNull(testWindow.archivedAt),
        isNull(season.archivedAt),
      ),
    );
  if (row === undefined) throw new HttpError('not_found', 'Test window not found');
  if (row.sport !== sport) {
    throw new HttpError('bad_request', 'The window is of a season of another sport', {
      details: [
        {
          path: ['body', 'testWindowId'],
          code: 'custom',
          message: "Not a window of the category's sport",
        },
      ],
    });
  }
  return row;
}

export function registerCategoryReportRoutes(app: FastifyInstance): void {
  registerEndpoint(app, requestCategoryReport, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const facts = await loadCategoryFacts(db, clubId, params.categoryId);
      await permissions.authorize('category_report', 'generate', { category: facts });
      const byClientUuid = async (clientUuid: string) => {
        const [row] = await selectReports(db, clubId, eq(categoryReport.clientUuid, clientUuid));
        return row;
      };
      // A retry answers the report it created; the same clientUuid for something else is not.
      if (body.clientUuid !== undefined) {
        const previous = await byClientUuid(body.clientUuid);
        if (previous !== undefined) {
          if (
            previous.categoryId !== params.categoryId ||
            previous.testWindowId !== body.testWindowId
          ) {
            throw new HttpError('conflict', 'This clientUuid was already used');
          }
          markReplay(reply);
          return reportDto(previous);
        }
      }
      const target = await requireCategory(db, clubId, params.categoryId);
      if (target.archived) throw new HttpError('conflict', 'The category is archived');
      const window = await requireWindow(db, clubId, body.testWindowId, target.sport);
      const today = await clubToday(db);
      if (compareLocalDates(window.startsOn, today) > 0) {
        throw new HttpError('conflict', 'The window has not started yet');
      }
      const content = await buildCategoryReportContent(db, {
        clubId,
        category: target,
        window,
        today,
        testOrder: byBatteryOrder,
      });
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () => {
          const [inserted] = await db
            .insert(categoryReport)
            .values({
              clubId,
              ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
              categoryId: target.id,
              testWindowId: window.id,
              formatVersion: content.formatVersion,
              content,
              createdBy: caller.userId,
              updatedBy: caller.userId,
            })
            .onConflictDoNothing({ target: [categoryReport.clubId, categoryReport.clientUuid] })
            .returning({ id: categoryReport.id });
          return inserted === undefined ? undefined : requireReport(db, clubId, inserted.id);
        },
        findByClientUuid: byClientUuid,
      });
      return reportDto(row);
    },
  });

  registerEndpoint(app, listCategoryReports, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const facts = await loadCategoryFacts(db, clubId, params.categoryId);
      await permissions.authorize('category_report', 'read', { category: facts });
      const plan = keysetPage(REPORT_KEYS, query, {
        categoryId: params.categoryId,
        testWindowId: query.testWindowId,
      });
      const rows = await selectReports(
        db,
        clubId,
        and(
          eq(categoryReport.categoryId, params.categoryId),
          query.testWindowId === undefined
            ? undefined
            : eq(categoryReport.testWindowId, query.testWindowId),
          plan.where,
        ),
      )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, reportDto);
    },
  });

  registerEndpoint(app, getCategoryReport, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await requireReport(db, clubId, params.reportId);
      const facts = await loadCategoryFacts(db, clubId, row.categoryId);
      await permissions.authorize('category_report', 'read', { category: facts });
      return reportDto(row);
    },
  });
}
