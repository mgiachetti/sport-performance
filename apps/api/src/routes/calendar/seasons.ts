import {
  archiveSeason,
  archiveTestWindow,
  createSeason,
  createTestWindow,
  getSeason,
  listSeasons,
  restoreSeason,
  restoreTestWindow,
  updateSeason,
  updateTestWindow,
} from '@sport-performance/contracts';
import { clubBranch, season, testSession, testWindow } from '@sport-performance/db/schema';
import {
  seasonSpanProblem,
  spanContainsDate,
  spanContainsSpan,
  testWindowLabel,
  testWindowProblems,
  type ClubId,
  type DateSpan,
  type Sport,
  type TestWindowNumber,
  type TestWindowSpan,
} from '@sport-performance/domain';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../../db/database.js';
import { registerEndpoint, type ClubAuthContext } from '../../http/endpoint.js';
import { HttpError } from '../../http/errors.js';
import { keysetPage, type KeysetSpec } from '../../http/pagination.js';
import {
  archiveStatusFilter,
  insertIdempotent,
  updateAtVersion,
  versionMatches,
} from '../../http/writes.js';
import {
  activeWindowsOf,
  dayKey,
  invalid,
  lockSeasonPlan,
  previousCreate,
  readSeason,
  readSeasonRow,
  readTestWindowRow,
  seasonColumns,
  seasonDto,
  testWindowColumns,
  testWindowDto,
  windowNumber,
  windowsOf,
  type SeasonRow,
  type TestWindowRow,
} from './shared.js';

/**
 * Seasons per sport and their testing windows V1–V4 (B-317). Every member of
 * the club reads them (`season.read`); the administration manages seasons
 * (`season.manage`) and, with the S&C staff, plans the windows
 * (`season.plan_windows`). Active seasons of a sport and active windows of a
 * season never overlap (also an exclusion constraint); windows lie inside
 * their season and follow their number, checked under the season's plan lock.
 */

const SEASON_KEYS: KeysetSpec<SeasonRow, 'startsOn' | 'name' | 'createdAt'> = {
  fields: {
    startsOn: { column: dayKey(season.startsOn), type: 'text', value: (row) => row.startsOn },
    name: { column: season.name, type: 'text', value: (row) => row.name },
    createdAt: { column: season.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: season.id, value: (row) => row.id },
};

function spanProblemOf(span: DateSpan): void {
  switch (seasonSpanProblem(span)) {
    case 'ends_before_start':
      return invalid(['body', 'endsOn'], 'The season ends before it starts');
    case 'too_long':
      return invalid(['body', 'endsOn'], 'A season lasts at most a year (366 days)');
    case null:
      return;
  }
}

async function sportIsEnabled(db: TenantDatabase, clubId: ClubId, sport: Sport): Promise<boolean> {
  const [row] = await db
    .select({ id: clubBranch.id })
    .from(clubBranch)
    .where(
      and(
        eq(clubBranch.clubId, clubId),
        eq(clubBranch.sport, sport),
        isNull(clubBranch.archivedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

function windowSpan(row: TestWindowRow): TestWindowSpan {
  return { id: row.id, number: windowNumber(row), startsOn: row.startsOn, endsOn: row.endsOn };
}

/**
 * Checks one window against its season and the other active windows: `409`
 * for a number already taken, `400` on the date that breaks the plan.
 */
function checkWindowPlan(
  seasonSpan: DateSpan,
  others: readonly TestWindowRow[],
  candidate: TestWindowSpan,
): void {
  const problem = testWindowProblems(seasonSpan, [
    ...others.filter((w) => w.id !== candidate.id).map(windowSpan),
    candidate,
  ]).find((p) => p.id === candidate.id || ('otherId' in p && p.otherId === candidate.id));
  if (problem === undefined) return;
  const label = testWindowLabel(candidate.number);
  const otherId =
    'otherId' in problem ? (problem.id === candidate.id ? problem.otherId : problem.id) : null;
  const other = others.find((w) => w.id === otherId);
  const otherLabel = other === undefined ? 'another window' : testWindowLabel(windowNumber(other));
  switch (problem.kind) {
    case 'ends_before_start':
      return invalid(['body', 'endsOn'], `${label} ends before it starts`);
    case 'outside_season':
      return invalid(
        ['body', candidate.startsOn < seasonSpan.startsOn ? 'startsOn' : 'endsOn'],
        `${label} must lie within its season (${seasonSpan.startsOn} to ${seasonSpan.endsOn})`,
      );
    case 'duplicate_number':
      throw new HttpError('conflict', `The season already has ${label}`);
    case 'overlaps':
      return invalid(['body', 'startsOn'], `${label} overlaps ${otherLabel}`);
    case 'out_of_order': {
      const before = other !== undefined && candidate.number < windowNumber(other);
      return invalid(
        ['body', before ? 'endsOn' : 'startsOn'],
        `${label} must come ${before ? 'before' : 'after'} ${otherLabel}`,
      );
    }
  }
}

/** Test days of the window still to be run must stay inside it. */
async function checkScheduledDaysInside(
  db: TenantDatabase,
  clubId: ClubId,
  windowId: string,
  span: DateSpan,
  label: string,
): Promise<void> {
  const days = await db
    .select({ scheduledOn: testSession.scheduledOn })
    .from(testSession)
    .where(
      and(
        eq(testSession.clubId, clubId),
        eq(testSession.testWindowId, windowId),
        inArray(testSession.status, ['scheduled', 'in_progress']),
      ),
    );
  const outside = days.filter((d) => !spanContainsDate(span, d.scheduledOn));
  if (outside.length > 0) {
    throw new HttpError(
      'conflict',
      `${String(outside.length)} test day(s) scheduled in ${label} would fall outside it: reschedule them first`,
    );
  }
}

/**
 * A window (or a season) leaves the plan only without test days still to be
 * run in it: they would point at a window no longer planned.
 */
async function checkNoPendingDays(
  db: TenantDatabase,
  clubId: ClubId,
  windowIds: readonly string[],
  what: string,
): Promise<void> {
  if (windowIds.length === 0) return;
  const days = await db
    .select({ id: testSession.id })
    .from(testSession)
    .where(
      and(
        eq(testSession.clubId, clubId),
        inArray(testSession.testWindowId, [...windowIds]),
        inArray(testSession.status, ['scheduled', 'in_progress']),
      ),
    );
  if (days.length > 0) {
    throw new HttpError(
      'conflict',
      `${String(days.length)} test day(s) are still scheduled in ${what}: reschedule or cancel them first`,
    );
  }
}

/** Archives or restores a season (idempotent) and returns it, under its plan lock. */
async function setSeasonArchived(
  db: TenantDatabase,
  caller: ClubAuthContext,
  seasonId: string,
  archive: boolean,
) {
  const { clubId } = caller.membership;
  await lockSeasonPlan(db, (await readSeasonRow(db, clubId, seasonId)).id);
  const row = await readSeasonRow(db, clubId, seasonId);
  if ((row.archivedAt !== null) !== archive) {
    if (archive) {
      const windows = await windowsOf(db, clubId, [row.id]);
      await checkNoPendingDays(
        db,
        clubId,
        windows.map((w) => w.id),
        row.name,
      );
    }
    await db
      .update(season)
      .set({ archivedAt: archive ? sql`now()` : null, updatedBy: caller.userId })
      .where(and(eq(season.clubId, clubId), eq(season.id, row.id)));
  }
  return readSeason(db, clubId, row.id);
}

export function registerSeasonRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listSeasons, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const scope = await permissions.listScope('season', 'read');
      const plan = keysetPage(SEASON_KEYS, query, { sport: query.sport, status: query.status });
      if (scope.kind !== 'club') return { items: [], nextCursor: null };
      const { clubId } = caller.membership;
      const rows = await db
        .select(seasonColumns)
        .from(season)
        .where(
          and(
            eq(season.clubId, clubId),
            query.sport === undefined ? undefined : eq(season.sport, query.sport),
            archiveStatusFilter(season.archivedAt, query.status),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      const page = plan.page(rows, (row) => row);
      const windows = await windowsOf(
        db,
        clubId,
        page.items.map((row) => row.id),
      );
      return {
        items: page.items.map((row) => seasonDto(row, windows)),
        nextCursor: page.nextCursor,
      };
    },
  });

  registerEndpoint(app, getSeason, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'read');
      return readSeason(db, caller.membership.clubId, params.seasonId);
    },
  });

  registerEndpoint(app, createSeason, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('season', 'manage');
      const { clubId } = caller.membership;
      const findByClientUuid = async (clientUuid: string) =>
        (
          await db
            .select({ id: season.id })
            .from(season)
            .where(and(eq(season.clubId, clubId), eq(season.clientUuid, clientUuid)))
        )[0];
      const previous = await previousCreate(body.clientUuid, reply, findByClientUuid);
      if (previous !== undefined) return readSeason(db, clubId, previous.id);

      spanProblemOf(body);
      if (!(await sportIsEnabled(db, clubId, body.sport))) {
        invalid(['body', 'sport'], 'The club has no active branch of this sport');
      }
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(season)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                sport: body.sport,
                name: body.name,
                startsOn: body.startsOn,
                endsOn: body.endsOn,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [season.clubId, season.clientUuid] })
              .returning({ id: season.id })
          )[0],
        findByClientUuid,
      });
      return readSeason(db, clubId, row.id);
    },
  });

  registerEndpoint(app, updateSeason, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'manage');
      const { clubId } = caller.membership;
      const current = await readSeasonRow(db, clubId, params.seasonId);
      const span = {
        startsOn: body.startsOn ?? current.startsOn,
        endsOn: body.endsOn ?? current.endsOn,
      };
      spanProblemOf(span);
      if (span.startsOn !== current.startsOn || span.endsOn !== current.endsOn) {
        await lockSeasonPlan(db, current.id);
        const outside = (await activeWindowsOf(db, clubId, current.id)).filter(
          (w) => !spanContainsSpan(span, w),
        );
        const first = outside[0];
        if (first !== undefined) {
          invalid(
            ['body', first.startsOn < span.startsOn ? 'startsOn' : 'endsOn'],
            `The season would leave ${outside.map((w) => testWindowLabel(windowNumber(w))).join(', ')} outside: move or archive them first`,
          );
        }
      }
      const where = and(eq(season.clubId, clubId), eq(season.id, params.seasonId));
      await updateAtVersion({
        resource: 'Season',
        update: async () =>
          (
            await db
              .update(season)
              .set({
                ...(body.name !== undefined && { name: body.name }),
                ...(body.startsOn !== undefined && { startsOn: body.startsOn }),
                ...(body.endsOn !== undefined && { endsOn: body.endsOn }),
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(season.updatedAt, body.version)))
              .returning({ id: season.id })
          )[0],
        exists: async () =>
          (await db.select({ id: season.id }).from(season).where(where)).length > 0,
      });
      return readSeason(db, clubId, params.seasonId);
    },
  });

  registerEndpoint(app, archiveSeason, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'manage');
      return setSeasonArchived(db, caller, params.seasonId, true);
    },
  });

  registerEndpoint(app, restoreSeason, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'manage');
      // Overlapping another active season of the sport is `409` (exclusion constraint).
      return setSeasonArchived(db, caller, params.seasonId, false);
    },
  });

  // ─── Windows ─────────────────────────────────────────────────────────────────────

  registerEndpoint(app, createTestWindow, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('season', 'plan_windows');
      const { clubId } = caller.membership;
      const { id: seasonId } = await readSeasonRow(db, clubId, params.seasonId);
      const findByClientUuid = async (clientUuid: string) =>
        (
          await db
            .select(testWindowColumns)
            .from(testWindow)
            .where(and(eq(testWindow.clubId, clubId), eq(testWindow.clientUuid, clientUuid)))
        )[0];
      const previous = await previousCreate(body.clientUuid, reply, findByClientUuid);
      if (previous !== undefined) return testWindowDto(previous);

      await lockSeasonPlan(db, seasonId);
      // Read under the lock: the season may have been archived meanwhile.
      const parent = await readSeasonRow(db, clubId, seasonId);
      if (parent.archivedAt !== null) {
        throw new HttpError('conflict', 'The season is archived: restore it first');
      }
      const number: TestWindowNumber = body.number;
      checkWindowPlan(parent, await activeWindowsOf(db, clubId, parent.id), {
        id: '',
        number,
        startsOn: body.startsOn,
        endsOn: body.endsOn,
      });
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(testWindow)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                seasonId: parent.id,
                number,
                startsOn: body.startsOn,
                endsOn: body.endsOn,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [testWindow.clubId, testWindow.clientUuid] })
              .returning(testWindowColumns)
          )[0],
        findByClientUuid,
      });
      return testWindowDto(row);
    },
  });

  registerEndpoint(app, updateTestWindow, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'plan_windows');
      const { clubId } = caller.membership;
      await lockSeasonPlan(db, (await readTestWindowRow(db, clubId, params.testWindowId)).seasonId);
      // Read under the lock: the plan may have changed meanwhile.
      const current = await readTestWindowRow(db, clubId, params.testWindowId);
      const parent = await readSeasonRow(db, clubId, current.seasonId);
      const span = {
        startsOn: body.startsOn ?? current.startsOn,
        endsOn: body.endsOn ?? current.endsOn,
      };
      const number = windowNumber(current);
      if (current.archivedAt === null) {
        checkWindowPlan(parent, await activeWindowsOf(db, clubId, parent.id), {
          id: current.id,
          number,
          ...span,
        });
      } else if (span.endsOn < span.startsOn) {
        invalid(['body', 'endsOn'], `${testWindowLabel(number)} ends before it starts`);
      }
      await checkScheduledDaysInside(db, clubId, current.id, span, testWindowLabel(number));
      const where = and(eq(testWindow.clubId, clubId), eq(testWindow.id, current.id));
      const row = await updateAtVersion({
        resource: 'Testing window',
        update: async () =>
          (
            await db
              .update(testWindow)
              .set({
                ...(body.startsOn !== undefined && { startsOn: body.startsOn }),
                ...(body.endsOn !== undefined && { endsOn: body.endsOn }),
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(testWindow.updatedAt, body.version)))
              .returning(testWindowColumns)
          )[0],
        exists: async () =>
          (await db.select({ id: testWindow.id }).from(testWindow).where(where)).length > 0,
      });
      return testWindowDto(row);
    },
  });

  registerEndpoint(app, archiveTestWindow, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'plan_windows');
      const { clubId } = caller.membership;
      await lockSeasonPlan(db, (await readTestWindowRow(db, clubId, params.testWindowId)).seasonId);
      const current = await readTestWindowRow(db, clubId, params.testWindowId);
      if (current.archivedAt !== null) return testWindowDto(current);
      await checkNoPendingDays(db, clubId, [current.id], testWindowLabel(windowNumber(current)));
      await db
        .update(testWindow)
        .set({ archivedAt: sql`now()`, updatedBy: caller.userId })
        .where(and(eq(testWindow.clubId, clubId), eq(testWindow.id, current.id)));
      return testWindowDto(await readTestWindowRow(db, clubId, current.id));
    },
  });

  registerEndpoint(app, restoreTestWindow, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'plan_windows');
      const { clubId } = caller.membership;
      await lockSeasonPlan(db, (await readTestWindowRow(db, clubId, params.testWindowId)).seasonId);
      const current = await readTestWindowRow(db, clubId, params.testWindowId);
      if (current.archivedAt === null) return testWindowDto(current);
      const parent = await readSeasonRow(db, clubId, current.seasonId);
      if (parent.archivedAt !== null) {
        throw new HttpError('conflict', 'The season is archived: restore it first');
      }
      checkWindowPlan(parent, await activeWindowsOf(db, clubId, parent.id), windowSpan(current));
      await db
        .update(testWindow)
        .set({ archivedAt: null, updatedBy: caller.userId })
        .where(and(eq(testWindow.clubId, clubId), eq(testWindow.id, current.id)));
      return testWindowDto(await readTestWindowRow(db, clubId, current.id));
    },
  });
}
