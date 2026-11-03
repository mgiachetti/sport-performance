import {
  getPlayerReport,
  listPlayerReports,
  requestPlayerReport,
  type PlayerReport,
} from '@sport-performance/contracts';
import { file, playerReport, season, testWindow } from '@sport-performance/db/schema';
import {
  compareLocalDates,
  type ClubId,
  type LocalDate,
  type PlayerId,
  type PlayerReportFailureCode,
  type PlayerReportStatus,
  type Sport,
} from '@sport-performance/domain';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import { insertIdempotent, markReplay } from '../http/writes.js';
import { buildPlayerReportContent, type ReportWindow } from '../reports/player-report-content.js';
import { requirePlayer } from './player-profile.js';
import { clubToday } from './training-shared.js';

/**
 * The PDF report of a player for a test window (B-602, ADR 0069). The staff
 * asks for it (`player_report.generate`): the handler freezes what it shows
 * with the rules of the player profile and leaves it `pending`; the worker
 * renders it into a `pdf_report` file. The player, the guardian, the
 * assigned staff and the administration read it (`player_report.read`) and
 * download the file through the files endpoints.
 */

interface ReportRow {
  id: string;
  clientUuid: string;
  playerId: PlayerId;
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
    createdAt: { column: playerReport.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: playerReport.id, value: (row) => row.id },
};

/** Reports of the club under RLS, with their window and whether their file can be downloaded. */
function selectReports(db: TenantDatabase, clubId: ClubId, where: SQL | undefined) {
  return db
    .select({
      id: playerReport.id,
      clientUuid: playerReport.clientUuid,
      playerId: playerReport.playerId,
      testWindowId: playerReport.testWindowId,
      seasonName: season.name,
      number: testWindow.number,
      startsOn: testWindow.startsOn,
      endsOn: testWindow.endsOn,
      status: playerReport.status,
      fileId: playerReport.fileId,
      fileStatus: file.status,
      failureCode: playerReport.failureCode,
      createdBy: playerReport.createdBy,
      createdAt: playerReport.createdAt,
      generatedAt: playerReport.generatedAt,
    })
    .from(playerReport)
    .innerJoin(
      testWindow,
      and(eq(testWindow.clubId, playerReport.clubId), eq(testWindow.id, playerReport.testWindowId)),
    )
    .innerJoin(
      season,
      and(eq(season.clubId, testWindow.clubId), eq(season.id, testWindow.seasonId)),
    )
    .leftJoin(file, and(eq(file.clubId, playerReport.clubId), eq(file.id, playerReport.fileId)))
    .where(and(eq(playerReport.clubId, clubId), where));
}

function reportDto(row: ReportRow): PlayerReport {
  return {
    id: row.id as PlayerReport['id'],
    playerId: row.playerId,
    testWindowId: row.testWindowId as PlayerReport['testWindowId'],
    window: {
      seasonName: row.seasonName,
      number: row.number,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
    },
    status: row.status,
    // Past its retention (or deleted) the PDF is gone: the report says so without a file.
    fileId: row.fileStatus === 'ready' ? (row.fileId as PlayerReport['fileId']) : null,
    failureCode: row.failureCode,
    requestedBy: row.createdBy as PlayerReport['requestedBy'],
    createdAt: row.createdAt.toISOString(),
    generatedAt: row.generatedAt?.toISOString() ?? null,
  };
}

async function requireReport(
  db: TenantDatabase,
  clubId: ClubId,
  reportId: string,
): Promise<ReportRow> {
  const [row] = await selectReports(db, clubId, eq(playerReport.id, reportId));
  if (row === undefined) throw new HttpError('not_found', 'Report not found');
  return row;
}

/** A window of a season of the sport, neither archived. */
async function requireWindow(
  db: TenantDatabase,
  clubId: ClubId,
  windowId: string,
  sport: Sport,
): Promise<ReportWindow> {
  const [row] = await db
    .select({
      id: testWindow.id,
      seasonName: season.name,
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
          message: "Not a window of the player's sport",
        },
      ],
    });
  }
  return row;
}

export function registerPlayerReportRoutes(app: FastifyInstance): void {
  registerEndpoint(app, requestPlayerReport, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const target = await requirePlayer(db, clubId, params.playerId);
      await permissions.authorize('player_report', 'generate', { player: target.facts });
      const byClientUuid = async (clientUuid: string) => {
        const [row] = await selectReports(db, clubId, eq(playerReport.clientUuid, clientUuid));
        return row;
      };
      // A retry answers the report it created; the same clientUuid for something else is not.
      if (body.clientUuid !== undefined) {
        const previous = await byClientUuid(body.clientUuid);
        if (previous !== undefined) {
          if (previous.playerId !== target.id || previous.testWindowId !== body.testWindowId) {
            throw new HttpError('conflict', 'This clientUuid was already used');
          }
          markReplay(reply);
          return reportDto(previous);
        }
      }
      const window = await requireWindow(db, clubId, body.testWindowId, target.facts.sport);
      const today = await clubToday(db);
      if (compareLocalDates(window.startsOn, today) > 0) {
        throw new HttpError('conflict', 'The window has not started yet');
      }
      const content = await buildPlayerReportContent(db, { clubId, target, window, today });
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () => {
          const [inserted] = await db
            .insert(playerReport)
            .values({
              clubId,
              ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
              playerId: target.id,
              testWindowId: window.id,
              formatVersion: content.formatVersion,
              content,
              createdBy: caller.userId,
              updatedBy: caller.userId,
            })
            .onConflictDoNothing({ target: [playerReport.clubId, playerReport.clientUuid] })
            .returning({ id: playerReport.id });
          return inserted === undefined ? undefined : requireReport(db, clubId, inserted.id);
        },
        findByClientUuid: byClientUuid,
      });
      return reportDto(row);
    },
  });

  registerEndpoint(app, listPlayerReports, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const target = await requirePlayer(db, clubId, params.playerId);
      await permissions.authorize('player_report', 'read', { player: target.facts });
      const plan = keysetPage(REPORT_KEYS, query, {
        playerId: target.id,
        testWindowId: query.testWindowId,
      });
      const rows = await selectReports(
        db,
        clubId,
        and(
          eq(playerReport.playerId, target.id),
          query.testWindowId === undefined
            ? undefined
            : eq(playerReport.testWindowId, query.testWindowId),
          plan.where,
        ),
      )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, reportDto);
    },
  });

  registerEndpoint(app, getPlayerReport, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await requireReport(db, clubId, params.reportId);
      const target = await requirePlayer(db, clubId, row.playerId);
      await permissions.authorize('player_report', 'read', { player: target.facts });
      return reportDto(row);
    },
  });
}
