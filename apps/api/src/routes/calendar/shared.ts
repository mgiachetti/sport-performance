import type { Fixture, Season, TestSession, TestWindow } from '@sport-performance/contracts';
import {
  category,
  club,
  fixture,
  season,
  testSession,
  testWindow,
  type TestConditions,
} from '@sport-performance/db/schema';
import {
  isTestWindowNumber,
  parseLocalTime,
  testWindowLabel,
  type CategoryId,
  type ClubId,
  type FixtureStatus,
  type FixtureVenue,
  type LocalDate,
  type Sport,
  type TestSessionStatus,
  type TestWindowNumber,
} from '@sport-performance/domain';
import { and, asc, eq, inArray, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { TenantDatabase } from '../../db/database.js';
import { HttpError } from '../../http/errors.js';
import { markReplay, rowVersion } from '../../http/writes.js';

/**
 * Rows, DTOs and checks shared by the calendar routes (B-317): seasons,
 * testing windows, scheduled test days, the fixture and the calendar of a
 * category.
 */

/** `400 validation_failed` on one input field. */
export function invalid(path: readonly (string | number)[], message: string): never {
  throw new HttpError('validation_failed', message, {
    details: [{ path: [...path], code: 'custom', message }],
  });
}

/**
 * Serializes the writes of a season's plan in this transaction: its dates,
 * its windows and the test days scheduled in them. The checks that span rows
 * (windows inside the season, in order; test days inside their window) are
 * only race free under it. An advisory lock and not `FOR UPDATE`: the S&C
 * staff writes windows without the right to update the season row.
 */
export async function lockSeasonPlan(db: TenantDatabase, seasonId: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`season_plan:${seasonId}`}, 0))`,
  );
}

/**
 * The create a previous request with the same `clientUuid` already made, if
 * any (ADR 0032), looked up before the checks: they depend on the current
 * state, and a replay must answer what the first request did.
 */
export async function previousCreate<Row>(
  clientUuid: string | undefined,
  reply: FastifyReply,
  find: (clientUuid: string) => Promise<Row | undefined>,
): Promise<Row | undefined> {
  if (clientUuid === undefined) return undefined;
  const row = await find(clientUuid);
  if (row !== undefined) markReplay(reply);
  return row;
}

/** Days are compared as `YYYY-MM-DD` text in keyset cursors (the order is the same). */
export function dayKey(column: AnyColumn): SQL {
  return sql`${column}::text`;
}

// ─── Seasons and windows ─────────────────────────────────────────────────────────────

export const seasonColumns = {
  id: season.id,
  sport: season.sport,
  name: season.name,
  startsOn: season.startsOn,
  endsOn: season.endsOn,
  archivedAt: season.archivedAt,
  createdAt: season.createdAt,
  updatedAt: season.updatedAt,
  version: rowVersion(season.updatedAt),
};

export interface SeasonRow {
  id: string;
  sport: Sport;
  name: string;
  startsOn: LocalDate;
  endsOn: LocalDate;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

export const testWindowColumns = {
  id: testWindow.id,
  seasonId: testWindow.seasonId,
  number: testWindow.number,
  startsOn: testWindow.startsOn,
  endsOn: testWindow.endsOn,
  archivedAt: testWindow.archivedAt,
  createdAt: testWindow.createdAt,
  updatedAt: testWindow.updatedAt,
  version: rowVersion(testWindow.updatedAt),
};

export interface TestWindowRow {
  id: string;
  seasonId: string;
  number: number;
  startsOn: LocalDate;
  endsOn: LocalDate;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

export function windowNumber(row: Pick<TestWindowRow, 'number'>): TestWindowNumber {
  if (!isTestWindowNumber(row.number)) {
    throw new Error(`test_window.number out of range: ${String(row.number)}`);
  }
  return row.number;
}

export function testWindowDto(row: TestWindowRow): TestWindow {
  const number = windowNumber(row);
  return {
    id: row.id as TestWindow['id'],
    seasonId: row.seasonId as TestWindow['seasonId'],
    number,
    label: testWindowLabel(number),
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export function seasonDto(row: SeasonRow, windows: readonly TestWindowRow[]): Season {
  return {
    id: row.id as Season['id'],
    sport: row.sport,
    name: row.name,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    testWindows: windows.filter((w) => w.seasonId === row.id).map(testWindowDto),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

/** Every window of the seasons, by number. */
export async function windowsOf(
  db: TenantDatabase,
  clubId: ClubId,
  seasonIds: readonly string[],
): Promise<TestWindowRow[]> {
  if (seasonIds.length === 0) return [];
  return db
    .select(testWindowColumns)
    .from(testWindow)
    .where(and(eq(testWindow.clubId, clubId), inArray(testWindow.seasonId, [...seasonIds])))
    .orderBy(asc(testWindow.number));
}

/** The active windows of a season. */
export async function activeWindowsOf(
  db: TenantDatabase,
  clubId: ClubId,
  seasonId: string,
): Promise<TestWindowRow[]> {
  return db
    .select(testWindowColumns)
    .from(testWindow)
    .where(
      and(
        eq(testWindow.clubId, clubId),
        eq(testWindow.seasonId, seasonId),
        isNull(testWindow.archivedAt),
      ),
    )
    .orderBy(asc(testWindow.number));
}

export async function readSeasonRow(
  db: TenantDatabase,
  clubId: ClubId,
  seasonId: string,
): Promise<SeasonRow> {
  const [row] = await db
    .select(seasonColumns)
    .from(season)
    .where(and(eq(season.clubId, clubId), eq(season.id, seasonId)));
  if (row === undefined) throw new HttpError('not_found', 'Season not found');
  return row;
}

export async function readSeason(
  db: TenantDatabase,
  clubId: ClubId,
  seasonId: string,
): Promise<Season> {
  const row = await readSeasonRow(db, clubId, seasonId);
  return seasonDto(row, await windowsOf(db, clubId, [row.id]));
}

export async function readTestWindowRow(
  db: TenantDatabase,
  clubId: ClubId,
  testWindowId: string,
): Promise<TestWindowRow> {
  const [row] = await db
    .select(testWindowColumns)
    .from(testWindow)
    .where(and(eq(testWindow.clubId, clubId), eq(testWindow.id, testWindowId)));
  if (row === undefined) throw new HttpError('not_found', 'Testing window not found');
  return row;
}

// ─── Categories ──────────────────────────────────────────────────────────────────────

export interface CategoryFactsRow {
  id: CategoryId;
  sport: Sport;
  archivedAt: Date | null;
}

/** A category of the club (`404` if not), with what authorization needs. */
export async function readCategoryFacts(
  db: TenantDatabase,
  clubId: ClubId,
  categoryId: CategoryId,
): Promise<CategoryFactsRow> {
  const [row] = await db
    .select({ id: category.id, sport: category.sport, archivedAt: category.archivedAt })
    .from(category)
    .where(and(eq(category.clubId, clubId), eq(category.id, categoryId)));
  if (row === undefined) throw new HttpError('not_found', 'Category not found');
  return row;
}

// ─── Test days ───────────────────────────────────────────────────────────────────────

export const testSessionColumns = {
  id: testSession.id,
  sport: testSession.sport,
  categoryId: testSession.categoryId,
  testWindowId: testSession.testWindowId,
  scheduledOn: testSession.scheduledOn,
  status: testSession.status,
  location: testSession.location,
  conditions: testSession.conditions,
  notes: testSession.notes,
  evaluatorId: testSession.evaluatorId,
  startedAt: testSession.startedAt,
  completedAt: testSession.completedAt,
  createdAt: testSession.createdAt,
  updatedAt: testSession.updatedAt,
  version: rowVersion(testSession.updatedAt),
};

export interface TestSessionRow {
  id: string;
  sport: Sport;
  categoryId: CategoryId | null;
  testWindowId: string | null;
  scheduledOn: LocalDate;
  status: TestSessionStatus;
  location: string | null;
  conditions: TestConditions;
  notes: string | null;
  evaluatorId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

export function testSessionDto(row: TestSessionRow): TestSession {
  return {
    id: row.id as TestSession['id'],
    sport: row.sport,
    categoryId: row.categoryId,
    testWindowId: row.testWindowId as TestSession['testWindowId'],
    scheduledOn: row.scheduledOn,
    status: row.status,
    location: row.location,
    conditions: row.conditions,
    notes: row.notes,
    evaluatorId: row.evaluatorId as TestSession['evaluatorId'],
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

// ─── Fixture ─────────────────────────────────────────────────────────────────────────

/**
 * The start of a match as an instant: its day and kick-off on the wall clock
 * of the club's current time zone (Postgres resolves DST gaps and overlaps).
 */
const fixtureStartsAt = sql<Date | null>`case when ${fixture.kickoffTime} is null then null
  else (${fixture.matchDate} + ${fixture.kickoffTime}) at time zone (
    select ${club.timeZone} from ${club} where ${club.id} = ${fixture.clubId}) end`.mapWith(
  fixture.archivedAt,
);

/** Columns of a match; the query joins its category (`fixtureFrom`). */
export const fixtureColumns = {
  id: fixture.id,
  sport: category.sport,
  categoryId: fixture.categoryId,
  opponent: fixture.opponent,
  venue: fixture.venue,
  competition: fixture.competition,
  date: fixture.matchDate,
  kickoffTime: fixture.kickoffTime,
  startsAt: fixtureStartsAt,
  location: fixture.location,
  status: fixture.status,
  notes: fixture.notes,
  archivedAt: fixture.archivedAt,
  createdAt: fixture.createdAt,
  updatedAt: fixture.updatedAt,
  version: rowVersion(fixture.updatedAt),
};

export interface FixtureRow {
  id: string;
  sport: Sport;
  categoryId: CategoryId;
  opponent: string;
  venue: FixtureVenue;
  competition: string | null;
  date: LocalDate;
  kickoffTime: string | null;
  startsAt: Date | null;
  location: string | null;
  status: FixtureStatus;
  notes: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

/** Matches (joined to their category for the sport), filtered, ordered and limited. */
export async function selectFixtures(
  db: TenantDatabase,
  where: SQL | undefined,
  page: { orderBy?: SQL[]; limit?: number } = {},
): Promise<FixtureRow[]> {
  const query = db
    .select(fixtureColumns)
    .from(fixture)
    .innerJoin(
      category,
      and(eq(category.clubId, fixture.clubId), eq(category.id, fixture.categoryId)),
    )
    .where(where)
    .orderBy(...(page.orderBy ?? []));
  return page.limit === undefined ? query : query.limit(page.limit);
}

export function fixtureDto(row: FixtureRow): Fixture {
  return {
    id: row.id as Fixture['id'],
    sport: row.sport,
    categoryId: row.categoryId,
    opponent: row.opponent,
    venue: row.venue,
    competition: row.competition,
    date: row.date,
    kickoffTime: row.kickoffTime === null ? null : parseLocalTime(row.kickoffTime),
    startsAt: row.startsAt?.toISOString() ?? null,
    location: row.location,
    status: row.status,
    notes: row.notes,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export async function readFixtureRow(
  db: TenantDatabase,
  clubId: ClubId,
  fixtureId: string,
): Promise<FixtureRow> {
  const [row] = await selectFixtures(
    db,
    and(eq(fixture.clubId, clubId), eq(fixture.id, fixtureId)),
  );
  if (row === undefined) throw new HttpError('not_found', 'Match not found');
  return row;
}
