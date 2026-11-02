import type {
  Participation,
  TrainingSession,
  TrainingSessionSummary,
} from '@sport-performance/contracts';
import {
  category,
  club,
  consent,
  participation,
  player,
  playerCategory,
  trainingSession,
} from '@sport-performance/db/schema';
import {
  SPORTS,
  isConsentType,
  parseTimeZone,
  type CategoryId,
  type ClubId,
  type ConsentType,
  type ExposureContext,
  type LocalDate,
  type ParticipationStatus,
  type PlayerFacts,
  type PlayerId,
  type Sport,
  type TimeZone,
} from '@sport-performance/domain';
import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { TenantDatabase } from '../db/database.js';
import { HttpError } from '../http/errors.js';
import type { RequestPermissions } from '../http/permissions.js';
import { rowVersion } from '../http/writes.js';

/**
 * What the routes of training sessions, drills and participation share
 * (B-318): row shapes, DTOs, the authorization of a session and the facts
 * of the players the permission matrix needs.
 */

export const sessionColumns = {
  id: trainingSession.id,
  sport: trainingSession.sport,
  kind: trainingSession.kind,
  categoryId: trainingSession.categoryId,
  title: trainingSession.title,
  startsAt: trainingSession.startsAt,
  localDate: trainingSession.localDate,
  plannedDurationMin: trainingSession.plannedDurationMin,
  location: trainingSession.location,
  opponent: trainingSession.opponent,
  notes: trainingSession.notes,
  archivedAt: trainingSession.archivedAt,
  createdAt: trainingSession.createdAt,
  updatedAt: trainingSession.updatedAt,
  version: rowVersion(trainingSession.updatedAt),
};

export interface SessionRow {
  id: string;
  sport: Sport;
  kind: ExposureContext;
  categoryId: CategoryId | null;
  title: string | null;
  startsAt: Date;
  localDate: LocalDate;
  plannedDurationMin: number | null;
  location: string | null;
  opponent: string | null;
  notes: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

export function sessionDto(row: SessionRow): TrainingSession {
  return {
    id: row.id as TrainingSession['id'],
    sport: row.sport,
    kind: row.kind,
    categoryId: row.categoryId,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    localDate: row.localDate,
    plannedDurationMin: row.plannedDurationMin,
    location: row.location,
    opponent: row.opponent,
    notes: row.notes,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export const summaryColumns = {
  id: trainingSession.id,
  sport: trainingSession.sport,
  kind: trainingSession.kind,
  categoryId: trainingSession.categoryId,
  title: trainingSession.title,
  startsAt: trainingSession.startsAt,
  localDate: trainingSession.localDate,
  plannedDurationMin: trainingSession.plannedDurationMin,
  archivedAt: trainingSession.archivedAt,
};

export type SummaryRow = Pick<SessionRow, keyof typeof summaryColumns>;

export function summaryDto(row: SummaryRow): TrainingSessionSummary {
  return {
    id: row.id as TrainingSessionSummary['id'],
    sport: row.sport,
    kind: row.kind,
    categoryId: row.categoryId,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    localDate: row.localDate,
    plannedDurationMin: row.plannedDurationMin,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export const participationColumns = {
  id: participation.id,
  trainingSessionId: participation.trainingSessionId,
  playerId: participation.playerId,
  status: participation.status,
  minutes: participation.minutes,
  contactsN: participation.contactsN,
  rpe: participation.rpe,
  rpeReportedAt: participation.rpeReportedAt,
  srpeAu: participation.srpeAu,
  clientUuid: participation.clientUuid,
  createdAt: participation.createdAt,
  updatedAt: participation.updatedAt,
  version: rowVersion(participation.updatedAt),
};

export interface ParticipationRow {
  id: string;
  trainingSessionId: string;
  playerId: PlayerId;
  status: ParticipationStatus;
  minutes: number | null;
  contactsN: number | null;
  rpe: number | null;
  rpeReportedAt: Date | null;
  srpeAu: number | null;
  clientUuid: string;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

export function participationDto(row: ParticipationRow): Participation {
  return {
    id: row.id as Participation['id'],
    trainingSessionId: row.trainingSessionId as Participation['trainingSessionId'],
    playerId: row.playerId,
    status: row.status,
    minutes: row.minutes,
    contactsN: row.contactsN,
    rpe: row.rpe,
    rpeReportedAt: row.rpeReportedAt?.toISOString() ?? null,
    srpeAu: row.srpeAu,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

/** One session of the club, or `404` (another club's rows are invisible under RLS). */
export async function readSession(
  db: TenantDatabase,
  clubId: ClubId,
  sessionId: string,
): Promise<SessionRow> {
  const [row] = await db
    .select(sessionColumns)
    .from(trainingSession)
    .where(and(eq(trainingSession.clubId, clubId), eq(trainingSession.id, sessionId)));
  if (row === undefined) throw new HttpError('not_found', 'Training session not found');
  return row;
}

/**
 * Checks the caller may `action` the session. The matrix scopes sessions by
 * category (`coach` in their assignments); a session without a category
 * (a whole-sport import) is only for the roles that see the whole club.
 */
export async function authorizeSession(
  permissions: RequestPermissions,
  row: Pick<SessionRow, 'categoryId' | 'sport'>,
  action: 'read' | 'manage',
): Promise<void> {
  await permissions.authorize(
    'training_session',
    action,
    row.categoryId === null ? {} : { category: { id: row.categoryId, sport: row.sport } },
  );
}

/** An archived session takes no new drills, participation or RPE. */
export function assertSessionActive(row: Pick<SessionRow, 'archivedAt'>): void {
  if (row.archivedAt !== null) {
    throw new HttpError('conflict', 'The training session is archived: restore it first');
  }
}

/** The club's IANA time zone ("the day" of every club metric). */
export async function clubTimeZone(db: TenantDatabase, clubId: ClubId): Promise<TimeZone> {
  const [row] = await db.select({ timeZone: club.timeZone }).from(club).where(eq(club.id, clubId));
  if (row === undefined) throw new HttpError('forbidden', 'The club of the request is not visible');
  return parseTimeZone(row.timeZone);
}

/** "Today" in the club's time zone, from the database's clock. */
export async function clubToday(db: TenantDatabase): Promise<LocalDate> {
  const { rows } = await db.execute<{ today: string | null }>(
    sql`select app.club_today()::text as today`,
  );
  const today = rows[0]?.today ?? null;
  if (today === null) throw new HttpError('forbidden', 'The club of the request is not visible');
  return today as LocalDate;
}

/** Condition "the `player_category` row covers `day`" (`valid_to` exclusive, ADR 0023). */
export function categoryCurrentOn(day: LocalDate) {
  return and(
    lte(playerCategory.validFrom, sql`${day}::date`),
    or(isNull(playerCategory.validTo), gt(playerCategory.validTo, sql`${day}::date`)),
  );
}

/**
 * The facts of each player the matrix needs to record their participation
 * or RPE: current categories (today, in the club's time zone), the sport
 * and the current consents. Players the caller cannot see (another club, or
 * outside the RLS scope) are missing from the map.
 *
 * `sport` is that of the current category in `preferredSport` if there is
 * one, otherwise of any current category, otherwise `preferredSport` or the
 * first sport. Only `assigned` rules read it, and a player without a current
 * category is invisible to those roles anyway (`app.visible_player_ids`).
 */
export async function loadPlayerFacts(
  db: TenantDatabase,
  clubId: ClubId,
  playerIds: readonly PlayerId[],
  preferredSport?: Sport,
): Promise<Map<PlayerId, PlayerFacts>> {
  const facts = new Map<PlayerId, PlayerFacts>();
  if (playerIds.length === 0) return facts;
  const ids = [...new Set(playerIds)];
  const today = await clubToday(db);
  // One after the other: they share the request's connection.
  const players = await db
    .select({ id: player.id })
    .from(player)
    .where(and(eq(player.clubId, clubId), inArray(player.id, ids)));
  const categories = await db
    .select({
      playerId: playerCategory.playerId,
      categoryId: playerCategory.categoryId,
      sport: category.sport,
    })
    .from(playerCategory)
    .innerJoin(
      category,
      and(eq(category.clubId, playerCategory.clubId), eq(category.id, playerCategory.categoryId)),
    )
    .where(
      and(
        eq(playerCategory.clubId, clubId),
        inArray(playerCategory.playerId, ids),
        categoryCurrentOn(today),
      ),
    );
  const consents = await db
    .select({ playerId: consent.playerId, type: consent.type })
    .from(consent)
    .where(
      and(eq(consent.clubId, clubId), inArray(consent.playerId, ids), isNull(consent.revokedAt)),
    );
  for (const { id } of players) {
    const own = categories.filter((c) => c.playerId === id);
    const sport =
      own.find((c) => c.sport === preferredSport)?.sport ??
      own[0]?.sport ??
      preferredSport ??
      SPORTS[0];
    const types: ConsentType[] = [];
    for (const c of consents) {
      if (c.playerId === id && isConsentType(c.type) && !types.includes(c.type)) types.push(c.type);
    }
    facts.set(id, {
      id,
      sport,
      categoryIds: own.map((c) => c.categoryId),
      consents: types,
    });
  }
  return facts;
}
