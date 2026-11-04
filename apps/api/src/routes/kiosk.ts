import {
  getKioskRoster,
  type KioskRosterEntry,
  type KioskRosterSession,
} from '@sport-performance/contracts';
import {
  category,
  participation,
  player,
  playerCategory,
  playerStage,
  trainingSession,
  wellness,
} from '@sport-performance/db/schema';
import {
  addDays,
  can,
  participationCarriesLoad,
  rpeSubmissionWindow,
  rpeWindowState,
  wellnessItemSetForStage,
  wellnessStageOn,
  type CategoryId,
  type ClubId,
  type KioskRpeState,
  type LocalDate,
  type ParticipationStatus,
  type PlayerId,
  type Stage,
} from '@sport-performance/domain';
import { and, asc, eq, exists, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import {
  categoryCurrentOn,
  clubTimeZone,
  clubToday,
  loadPlayerFacts,
  summaryColumns,
  summaryDto,
  type SummaryRow,
} from './training-shared.js';

/**
 * The roster of the club's kiosk (B-504, ADR 0086): what a shared device
 * keeps of a category to let its players load their wellness and session
 * RPE without signal, under the session of the staff member who opened it.
 * Only names and what each player has left to load: never a score, a value,
 * availability or a cause, so whoever picks a name on the kiosk learns
 * nothing about anyone.
 */

interface RosterRow {
  id: PlayerId;
  firstName: string;
  lastName: string;
}

const fullName = sql`(${player.lastName} || ' ' || ${player.firstName})`;

const ROSTER_KEYS: KeysetSpec<RosterRow, 'name'> = {
  fields: {
    name: { column: fullName, type: 'text', value: (row) => `${row.lastName} ${row.firstName}` },
  },
  id: { column: player.id, value: (row) => row.id },
};

/** `valid_from <= day < valid_to` of a validity in memory (exclusive end, ADR 0023). */
function coversDay(validFrom: LocalDate, validTo: LocalDate | null, day: LocalDate): boolean {
  return validFrom <= day && (validTo === null || validTo > day);
}

/** The stage that sets today's wellness items of each player (as `POST /v1/wellness`). */
async function stagesToday(
  db: TenantDatabase,
  clubId: ClubId,
  playerIds: readonly PlayerId[],
  today: LocalDate,
): Promise<Map<PlayerId, Stage | null>> {
  const assigned = await db
    .select({ playerId: playerStage.playerId, stage: playerStage.stage })
    .from(playerStage)
    .where(
      and(
        eq(playerStage.clubId, clubId),
        inArray(playerStage.playerId, [...playerIds]),
        lte(playerStage.validFrom, today),
        or(isNull(playerStage.validTo), sql`${playerStage.validTo} > ${today}::date`),
      ),
    )
    // A staff pin first, then the latest: the first row of each player wins.
    .orderBy(sql`(${playerStage.basis} = 'manual') desc`, sql`${playerStage.validFrom} desc`);
  const defaults = await db
    .select({ playerId: playerCategory.playerId, stage: category.defaultStage })
    .from(playerCategory)
    .innerJoin(
      category,
      and(eq(category.clubId, playerCategory.clubId), eq(category.id, playerCategory.categoryId)),
    )
    .where(
      and(
        eq(playerCategory.clubId, clubId),
        inArray(playerCategory.playerId, [...playerIds]),
        categoryCurrentOn(today),
      ),
    );
  const stages = new Map<PlayerId, Stage | null>();
  for (const id of playerIds) {
    stages.set(
      id,
      wellnessStageOn({
        assignedStage: assigned.find((row) => row.playerId === id)?.stage ?? null,
        categoryDefaultStages: defaults.filter((row) => row.playerId === id).map((r) => r.stage),
      }),
    );
  }
  return stages;
}

interface SessionOfPlayer {
  readonly session: SummaryRow;
  readonly participation: { status: ParticipationStatus; rpe: number | null } | undefined;
}

/**
 * The sessions of yesterday and today each player reports the RPE of (as
 * `GET /v1/me/training-sessions`): active sessions of a category the player
 * was in on the session's day, or with their participation.
 */
async function sessionsOfPlayers(
  db: TenantDatabase,
  clubId: ClubId,
  playerIds: readonly PlayerId[],
  today: LocalDate,
): Promise<Map<PlayerId, SessionOfPlayer[]>> {
  const yesterday = addDays(today, -1);
  const ids = [...playerIds];
  const memberships = await db
    .select({
      playerId: playerCategory.playerId,
      categoryId: playerCategory.categoryId,
      validFrom: playerCategory.validFrom,
      validTo: playerCategory.validTo,
    })
    .from(playerCategory)
    .where(
      and(
        eq(playerCategory.clubId, clubId),
        inArray(playerCategory.playerId, ids),
        lte(playerCategory.validFrom, today),
        or(isNull(playerCategory.validTo), sql`${playerCategory.validTo} > ${yesterday}::date`),
      ),
    );
  const categoryIds = [...new Set(memberships.map((row) => row.categoryId))];
  const sessions = await db
    .select(summaryColumns)
    .from(trainingSession)
    .where(
      and(
        eq(trainingSession.clubId, clubId),
        isNull(trainingSession.archivedAt),
        gte(trainingSession.localDate, yesterday),
        lte(trainingSession.localDate, today),
        or(
          categoryIds.length > 0
            ? inArray(trainingSession.categoryId, categoryIds as CategoryId[])
            : undefined,
          exists(
            db
              .select({ one: sql`1` })
              .from(participation)
              .where(
                and(
                  eq(participation.clubId, trainingSession.clubId),
                  eq(participation.trainingSessionId, trainingSession.id),
                  inArray(participation.playerId, ids),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(trainingSession.startsAt), asc(trainingSession.id));
  const sessionIds = sessions.map((row) => row.id);
  const recorded =
    sessionIds.length === 0
      ? []
      : await db
          .select({
            trainingSessionId: participation.trainingSessionId,
            playerId: participation.playerId,
            status: participation.status,
            rpe: participation.rpe,
          })
          .from(participation)
          .where(
            and(
              eq(participation.clubId, clubId),
              inArray(participation.trainingSessionId, sessionIds),
              inArray(participation.playerId, ids),
            ),
          );
  const result = new Map<PlayerId, SessionOfPlayer[]>();
  for (const id of ids) {
    const own: SessionOfPlayer[] = [];
    for (const session of sessions) {
      const current = recorded.find((r) => r.trainingSessionId === session.id && r.playerId === id);
      const inCategory = memberships.some(
        (m) =>
          m.playerId === id &&
          m.categoryId === session.categoryId &&
          coversDay(m.validFrom, m.validTo, session.localDate),
      );
      if (current !== undefined || inCategory) own.push({ session, participation: current });
    }
    result.set(id, own);
  }
  return result;
}

function rpeStateOf(current: SessionOfPlayer['participation']): KioskRpeState {
  if (current === undefined) return 'pending';
  if (current.rpe !== null) return 'reported';
  return participationCarriesLoad(current.status) ? 'pending' : 'not_taking_part';
}

export function registerKioskRoutes(app: FastifyInstance): void {
  registerEndpoint(app, getKioskRoster, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const clubId: ClubId = caller.membership.clubId;
      // Throws `403` for a role that never loads on the kiosk.
      const wellnessScope = await permissions.listScope('wellness', 'kiosk_submit');
      const [own] = await db
        .select({ id: category.id, sport: category.sport })
        .from(category)
        .where(and(eq(category.clubId, clubId), eq(category.id, params.categoryId)));
      if (own === undefined) throw new HttpError('not_found', 'Category not found');
      const inScope =
        wellnessScope.kind === 'club' ||
        (wellnessScope.kind === 'assigned' &&
          (wellnessScope.categoryIds.includes(own.id) || wellnessScope.sports.includes(own.sport)));
      if (!inScope) throw new HttpError('forbidden', 'You are not allowed to do this');

      const today = await clubToday(db);
      const timeZone = await clubTimeZone(db, clubId);
      const plan = keysetPage(ROSTER_KEYS, query, { categoryId: own.id });
      const rows = await db
        .select({ id: player.id, firstName: player.firstName, lastName: player.lastName })
        .from(player)
        .where(
          and(
            eq(player.clubId, clubId),
            isNull(player.archivedAt),
            exists(
              db
                .select({ one: sql`1` })
                .from(playerCategory)
                .where(
                  and(
                    eq(playerCategory.clubId, player.clubId),
                    eq(playerCategory.playerId, player.id),
                    eq(playerCategory.categoryId, own.id),
                    categoryCurrentOn(today),
                  ),
                ),
            ),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      const page = plan.page(rows, (row) => row);
      const ids = page.items.map((row) => row.id);
      if (ids.length === 0) return { items: [], nextCursor: page.nextCursor, today, timeZone };

      const subject = await permissions.subject();
      const facts = await loadPlayerFacts(db, clubId, ids, own.sport);
      const stages = await stagesToday(db, clubId, ids, today);
      const submitted = new Set(
        (
          await db
            .select({ playerId: wellness.playerId })
            .from(wellness)
            .where(
              and(
                eq(wellness.clubId, clubId),
                eq(wellness.localDate, today),
                inArray(wellness.playerId, ids),
              ),
            )
        ).map((row) => row.playerId),
      );
      const sessions = await sessionsOfPlayers(db, clubId, ids, today);
      const now = new Date();

      return {
        nextCursor: page.nextCursor,
        today,
        timeZone,
        items: page.items.map((row): KioskRosterEntry => {
          const playerFacts = facts.get(row.id);
          const canReport =
            playerFacts !== undefined &&
            can(subject, 'kiosk_submit', { kind: 'wellness', clubId, player: playerFacts }) &&
            can(subject, 'kiosk_submit', { kind: 'rpe', clubId, player: playerFacts });
          const stage = stages.get(row.id) ?? null;
          const set = stage === null ? null : wellnessItemSetForStage(stage);
          return {
            player: { id: row.id, firstName: row.firstName, lastName: row.lastName },
            canReport,
            wellness:
              stage === null || set === null
                ? null
                : {
                    localDate: today,
                    stage,
                    itemCount: set.itemCount,
                    items: [...set.items],
                    submitted: submitted.has(row.id),
                  },
            sessions: (sessions.get(row.id) ?? []).flatMap((entry): KioskRosterSession[] => {
              const window = rpeSubmissionWindow(entry.session, timeZone);
              if (rpeWindowState(window, now) === 'closed') return [];
              return [
                {
                  session: summaryDto(entry.session),
                  rpeWindow: {
                    opensAt: window.opensAt.toISOString(),
                    closesAt: window.closesAt.toISOString(),
                  },
                  state: rpeStateOf(entry.participation),
                },
              ];
            }),
          };
        }),
      };
    },
  });
}
