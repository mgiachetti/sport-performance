import { listTrainingSessionRoster, type SessionRosterEntry } from '@sport-performance/contracts';
import { participation, player, playerCategory } from '@sport-performance/db/schema';
import {
  can,
  isAvailabilityStatus,
  type AvailabilityStatus,
  type ClubId,
  type PlayerId,
} from '@sport-performance/domain';
import { and, eq, exists, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import {
  authorizeSession,
  loadPlayerFacts,
  participationColumns,
  participationDto,
  readSession,
  type ParticipationRow,
  type SessionRow,
} from './training-shared.js';

/**
 * The roster of a session (B-407): the players of its category on its club
 * day plus those with a participation in it, with that participation, their
 * derived availability and whether the caller may record it, so the staff
 * web loads the whole participation screen in one read (ADR 0032).
 *
 * Who: whoever may read the session (`training_session.read`), and of its
 * players only those the caller may read the participation of (the matrix
 * on top of the RLS of `player`). Availability comes from
 * `medical.availability` (ADR 0029): it never says the cause, and the read
 * is logged in `medical.access_log` like any other.
 */

interface RosterRow {
  id: PlayerId;
  firstName: string;
  lastName: string;
  archivedAt: Date | null;
  inCategory: boolean;
}

/** Sort by name: last name, then first name (as `GET /v1/players`). */
const fullName = sql`(${player.lastName} || ' ' || ${player.firstName})`;

const ROSTER_KEYS: KeysetSpec<RosterRow, 'name'> = {
  fields: {
    name: { column: fullName, type: 'text', value: (row) => `${row.lastName} ${row.firstName}` },
  },
  id: { column: player.id, value: (row) => row.id },
};

/** The player was in the session's category on the session's club day (`valid_to` exclusive). */
function inCategoryOnSessionDay(db: TenantDatabase, session: SessionRow) {
  if (session.categoryId === null) return undefined;
  return exists(
    db
      .select({ one: sql`1` })
      .from(playerCategory)
      .where(
        and(
          eq(playerCategory.clubId, player.clubId),
          eq(playerCategory.playerId, player.id),
          eq(playerCategory.categoryId, session.categoryId),
          sql`${playerCategory.validFrom} <= ${session.localDate}::date`,
          or(
            isNull(playerCategory.validTo),
            sql`${playerCategory.validTo} > ${session.localDate}::date`,
          ),
        ),
      ),
  );
}

function hasParticipationIn(db: TenantDatabase, session: SessionRow) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(participation)
      .where(
        and(
          eq(participation.clubId, player.clubId),
          eq(participation.trainingSessionId, session.id),
          eq(participation.playerId, player.id),
        ),
      ),
  );
}

interface AvailabilityRow extends Record<string, unknown> {
  player_id: PlayerId;
  training: string;
  match: string;
  staff_notes: string[] | null;
}

/** Availability of the players on the session's day, for its kind (audited read). */
async function availabilityOf(
  db: TenantDatabase,
  session: SessionRow,
  playerIds: readonly PlayerId[],
): Promise<Map<PlayerId, { status: AvailabilityStatus; staffNotes: string[] }>> {
  const result = new Map<PlayerId, { status: AvailabilityStatus; staffNotes: string[] }>();
  if (playerIds.length === 0) return result;
  const { rows } = await db.execute<AvailabilityRow>(
    sql`select a.player_id, a.training::text as training, a."match"::text as "match", a.staff_notes
          from medical.availability(${sql.param([...playerIds])}::uuid[], ${session.localDate}::date) a`,
  );
  for (const row of rows) {
    const status = session.kind === 'match' ? row.match : row.training;
    if (!isAvailabilityStatus(status)) {
      throw new Error(`medical.availability returned an unknown status: ${status}`);
    }
    result.set(row.player_id, { status, staffNotes: row.staff_notes ?? [] });
  }
  return result;
}

export function registerSessionRosterRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listTrainingSessionRoster, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const clubId: ClubId = caller.membership.clubId;
      const session = await readSession(db, clubId, params.trainingSessionId);
      await authorizeSession(permissions, session, 'read');
      const subject = await permissions.subject();
      const plan = keysetPage(ROSTER_KEYS, query, { trainingSessionId: session.id });

      const inCategory = inCategoryOnSessionDay(db, session);
      const rows = await db
        .select({
          id: player.id,
          firstName: player.firstName,
          lastName: player.lastName,
          archivedAt: player.archivedAt,
          inCategory: inCategory === undefined ? sql<boolean>`false` : sql<boolean>`${inCategory}`,
        })
        .from(player)
        .where(
          and(
            eq(player.clubId, clubId),
            or(inCategory, hasParticipationIn(db, session)),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      const page = plan.page(rows, (row) => row);

      // The matrix on top of the RLS: only the players whose participation the caller reads.
      const facts = await loadPlayerFacts(
        db,
        clubId,
        page.items.map((row) => row.id),
        session.sport,
      );
      const visible = page.items.filter((row) => {
        const own = facts.get(row.id);
        return (
          own !== undefined && can(subject, 'read', { kind: 'participation', clubId, player: own })
        );
      });
      const ids = visible.map((row) => row.id);

      const recorded = new Map<PlayerId, ParticipationRow>();
      if (ids.length > 0) {
        const participations = await db
          .select(participationColumns)
          .from(participation)
          .where(
            and(
              eq(participation.clubId, clubId),
              eq(participation.trainingSessionId, session.id),
              inArray(participation.playerId, ids),
            ),
          );
        for (const row of participations) recorded.set(row.playerId, row);
      }

      const availabilityReadable = ids.filter((id) => {
        const own = facts.get(id);
        return (
          own !== undefined && can(subject, 'read', { kind: 'availability', clubId, player: own })
        );
      });
      const availability = await availabilityOf(db, session, availabilityReadable);

      return {
        nextCursor: page.nextCursor,
        items: visible.map((row): SessionRosterEntry => {
          const own = facts.get(row.id);
          const current = recorded.get(row.id);
          return {
            player: {
              id: row.id,
              firstName: row.firstName,
              lastName: row.lastName,
              archivedAt: row.archivedAt?.toISOString() ?? null,
            },
            inCategory: row.inCategory,
            participation: current === undefined ? null : participationDto(current),
            availability: availability.get(row.id) ?? null,
            hasDataConsent: own?.consents?.includes('data') ?? false,
            canRecord:
              own !== undefined &&
              can(subject, 'record', { kind: 'participation', clubId, player: own }),
          };
        }),
      };
    },
  });
}
