import {
  applySeasonRollover,
  cancelSeasonRollover,
  createSeasonRollover,
  getSeasonRollover,
  listSeasonRolloverItems,
  listSeasonRollovers,
  updateSeasonRolloverItem,
  type SeasonRollover,
  type SeasonRolloverItem,
} from '@sport-performance/contracts';
import {
  category,
  player,
  playerCategory,
  season,
  seasonRollover,
  seasonRolloverItem,
} from '@sport-performance/db/schema';
import {
  SEASON_ROLLOVER_OUTCOMES,
  compareLocalDates,
  proposeSeasonRollover,
  seasonRolloverYear,
  type CategoryId,
  type ClubId,
  type LocalDate,
  type PlayerId,
  type SeasonRolloverDecision,
  type SeasonRolloverOutcome,
  type SeasonRolloverProposal,
  type SeasonRolloverStatus,
  type Sex,
  type Sport,
} from '@sport-performance/domain';
import { and, asc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import { insertIdempotent, rowVersion, updateAtVersion, versionMatches } from '../http/writes.js';
import { invalid, lockSeasonPlan, previousCreate, readSeasonRow } from './calendar/shared.js';
import { lockPlayer } from './players.js';

/**
 * Season change (B-316, ADR 0049): the proposal of moving every player of a
 * season's sport to the category of their birth year (`proposeSeasonRollover`
 * of the domain), its review player by player and its application, which
 * writes `player_category` with the same rules as a manual pass (ADR 0035).
 * Only the administration: `season.manage` for the change and
 * `category.manage` for every category it moves players to.
 */

/** Inserts per statement when a draft is created (well under the 65 535 parameters). */
const INSERT_CHUNK = 500;

// ─── Rows and DTOs ─────────────────────────────────────────────────────────────────────

const OUTCOME_COUNTS = sql.join(
  SEASON_ROLLOVER_OUTCOMES.map(
    (outcome) =>
      sql`${outcome}::text, count(*) filter (where i.outcome = ${outcome}::season_rollover_outcome)`,
  ),
  sql`, `,
);

const OUTER_ROLLOVER = sql.raw('"season_rollover"');

const rolloverColumns = {
  id: seasonRollover.id,
  seasonId: seasonRollover.seasonId,
  sport: season.sport,
  effectiveOn: seasonRollover.effectiveOn,
  seasonYear: seasonRollover.seasonYear,
  status: seasonRollover.status,
  appliedAt: seasonRollover.appliedAt,
  cancelledAt: seasonRollover.cancelledAt,
  createdAt: seasonRollover.createdAt,
  updatedAt: seasonRollover.updatedAt,
  version: rowVersion(seasonRollover.updatedAt),
  counts: sql<{
    players: number;
    moving: number;
    staying: number;
    pendingReview: number;
    outcomes: Record<SeasonRolloverOutcome, number>;
  }>`(
    select json_build_object(
      'players', count(*),
      'moving', count(*) filter (where i.decision = 'move'),
      'staying', count(*) filter (where i.decision = 'stay'),
      'pendingReview', count(*) filter (where i.needs_review and i.reviewed_at is null),
      'outcomes', json_build_object(${OUTCOME_COUNTS}))
      from ${seasonRolloverItem} i
     where i.club_id = ${OUTER_ROLLOVER}.club_id and i.rollover_id = ${OUTER_ROLLOVER}.id)`,
};

interface RolloverRow {
  id: string;
  seasonId: string;
  sport: Sport;
  effectiveOn: LocalDate;
  seasonYear: number;
  status: SeasonRolloverStatus;
  appliedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
  counts: {
    players: number;
    moving: number;
    staying: number;
    pendingReview: number;
    outcomes: Record<SeasonRolloverOutcome, number>;
  };
}

function rolloverDto(row: RolloverRow): SeasonRollover {
  return {
    id: row.id as SeasonRollover['id'],
    seasonId: row.seasonId as SeasonRollover['seasonId'],
    sport: row.sport,
    effectiveOn: row.effectiveOn,
    seasonYear: row.seasonYear,
    status: row.status,
    counts: {
      players: row.counts.players,
      moving: row.counts.moving,
      staying: row.counts.staying,
      pendingReview: row.counts.pendingReview,
      outcomes: row.status === 'applied' ? row.counts.outcomes : null,
    },
    appliedAt: row.appliedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const ROLLOVER_KEYS: KeysetSpec<RolloverRow, 'createdAt'> = {
  fields: {
    createdAt: {
      column: seasonRollover.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
  },
  id: { column: seasonRollover.id, value: (row) => row.id },
};

function selectRollovers(db: TenantDatabase) {
  return db
    .select(rolloverColumns)
    .from(seasonRollover)
    .innerJoin(
      season,
      and(eq(season.clubId, seasonRollover.clubId), eq(season.id, seasonRollover.seasonId)),
    );
}

async function readRollover(
  db: TenantDatabase,
  clubId: ClubId,
  rolloverId: string,
): Promise<RolloverRow> {
  const [row] = await selectRollovers(db).where(
    and(eq(seasonRollover.clubId, clubId), eq(seasonRollover.id, rolloverId)),
  );
  // Another club's, or not visible (RLS: only the administration): it does not exist.
  if (row === undefined) throw new HttpError('not_found', 'Season change not found');
  return row;
}

/** One write of a season change at a time: reviews, apply and cancel do not race. */
async function lockRollover(db: TenantDatabase, rolloverId: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`season_rollover:${rolloverId}`}, 0))`,
  );
}

/**
 * Outer rows referenced from correlated subqueries: Drizzle renders the columns of a
 * single-table select unqualified, which inside a subquery would bind to its own table.
 */
const OUTER_ITEM = sql.raw('"season_rollover_item"');
const OUTER_PLAYER = sql.raw('"player"');

const itemColumns = {
  id: seasonRolloverItem.id,
  rolloverId: seasonRolloverItem.rolloverId,
  playerId: player.id,
  firstName: player.firstName,
  lastName: player.lastName,
  birthDate: player.birthDate,
  sex: player.sex,
  ageInSeasonYear: seasonRolloverItem.ageInSeasonYear,
  ageBandCode: seasonRolloverItem.ageBandCode,
  proposal: seasonRolloverItem.proposal,
  proposedCategoryId: seasonRolloverItem.proposedCategoryId,
  needsReview: seasonRolloverItem.needsReview,
  decision: seasonRolloverItem.decision,
  targetCategoryId: seasonRolloverItem.targetCategoryId,
  reviewedAt: seasonRolloverItem.reviewedAt,
  outcome: seasonRolloverItem.outcome,
  membershipId: seasonRolloverItem.membershipId,
  updatedAt: seasonRolloverItem.updatedAt,
  version: rowVersion(seasonRolloverItem.updatedAt),
  /** Memberships covering the day before the change: also after applying, what they left. */
  previousCategoryIds: sql<string[]>`coalesce((
    select array_agg(pc.category_id::text order by pc.valid_from, pc.category_id)
      from ${playerCategory} pc
      join ${seasonRollover} r on r.club_id = pc.club_id and r.id = ${OUTER_ITEM}.rollover_id
     where pc.club_id = ${OUTER_ITEM}.club_id and pc.player_id = ${OUTER_ITEM}.player_id
       and pc.valid_from < r.effective_on
       and (pc.valid_to is null or pc.valid_to >= r.effective_on)), '{}')::text[]`,
};

interface ItemRow {
  id: string;
  rolloverId: string;
  playerId: PlayerId;
  firstName: string;
  lastName: string;
  birthDate: LocalDate;
  sex: Sex;
  ageInSeasonYear: number;
  ageBandCode: string | null;
  proposal: SeasonRolloverProposal;
  proposedCategoryId: CategoryId | null;
  needsReview: boolean;
  decision: SeasonRolloverDecision;
  targetCategoryId: CategoryId | null;
  reviewedAt: Date | null;
  outcome: SeasonRolloverOutcome | null;
  membershipId: string | null;
  updatedAt: Date;
  version: string;
  previousCategoryIds: string[];
}

function itemDto(row: ItemRow): SeasonRolloverItem {
  return {
    id: row.id as SeasonRolloverItem['id'],
    rolloverId: row.rolloverId as SeasonRolloverItem['rolloverId'],
    player: {
      id: row.playerId,
      firstName: row.firstName,
      lastName: row.lastName,
      birthDate: row.birthDate,
      sex: row.sex,
    },
    previousCategoryIds: row.previousCategoryIds as SeasonRolloverItem['previousCategoryIds'],
    ageInSeasonYear: row.ageInSeasonYear,
    ageBandCode: row.ageBandCode,
    proposal: row.proposal,
    proposedCategoryId: row.proposedCategoryId,
    needsReview: row.needsReview,
    decision: row.decision,
    targetCategoryId: row.targetCategoryId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    outcome: row.outcome,
    membershipId: row.membershipId as SeasonRolloverItem['membershipId'],
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const fullName = sql`(${player.lastName} || ' ' || ${player.firstName})`;

const ITEM_KEYS: KeysetSpec<ItemRow, 'name' | 'birthDate'> = {
  fields: {
    name: { column: fullName, type: 'text', value: (row) => `${row.lastName} ${row.firstName}` },
    birthDate: { column: sql`${player.birthDate}::text`, type: 'text', value: (r) => r.birthDate },
  },
  id: { column: seasonRolloverItem.id, value: (row) => row.id },
};

function selectItems(db: TenantDatabase) {
  return db
    .select(itemColumns)
    .from(seasonRolloverItem)
    .innerJoin(
      player,
      and(eq(player.clubId, seasonRolloverItem.clubId), eq(player.id, seasonRolloverItem.playerId)),
    );
}

// ─── Checks ────────────────────────────────────────────────────────────────────────────

interface CategoryRow {
  id: CategoryId;
  sport: Sport;
  sex: Sex;
  ageBandCode: string;
  archivedAt: Date | null;
}

async function categoriesOf(
  db: TenantDatabase,
  clubId: ClubId,
  where: SQL | undefined,
): Promise<CategoryRow[]> {
  return db
    .select({
      id: category.id,
      sport: category.sport,
      sex: category.sex,
      ageBandCode: category.ageBandCode,
      archivedAt: category.archivedAt,
    })
    .from(category)
    .where(and(eq(category.clubId, clubId), where));
}

/** Moving players into a category is managing it (`category.manage`, ADR 0035). */
async function authorizeTargets(
  permissions: RequestPermissions,
  categories: readonly { id: CategoryId; sport: Sport }[],
): Promise<void> {
  for (const target of categories) {
    await permissions.authorize('category', 'manage', {
      category: { id: target.id, sport: target.sport },
    });
  }
}

function requireDraft(row: RolloverRow): void {
  if (row.status === 'applied') {
    throw new HttpError('conflict', 'The season change was already applied');
  }
  if (row.status === 'cancelled') {
    throw new HttpError('conflict', 'The season change was cancelled: create another one');
  }
}

// ─── Apply ─────────────────────────────────────────────────────────────────────────────

interface MoveItem {
  id: string;
  playerId: PlayerId;
  targetCategoryId: CategoryId;
}

/**
 * Moves one player, under their lock (the one of the manual passes), on the
 * state of this moment. Returns what happened and the membership it opened.
 */
async function applyMove(
  db: TenantDatabase,
  context: { clubId: ClubId; userId: string; seasonId: string; effectiveOn: LocalDate },
  item: MoveItem,
  target: CategoryRow | undefined,
): Promise<{ outcome: SeasonRolloverOutcome; membershipId: string | null }> {
  const { clubId, effectiveOn } = context;
  await lockPlayer(db, item.playerId);
  const [current] = await db
    .select({
      sport: player.sport,
      sex: player.sex,
      joinedOn: player.joinedOn,
      archivedAt: player.archivedAt,
    })
    .from(player)
    .where(and(eq(player.clubId, clubId), eq(player.id, item.playerId)));
  if (current?.archivedAt !== null) {
    return { outcome: 'skipped_left', membershipId: null };
  }
  if (target?.archivedAt !== null || target.sport !== current.sport || target.sex !== current.sex) {
    return { outcome: 'skipped_category_unavailable', membershipId: null };
  }
  const memberships = and(
    eq(playerCategory.clubId, clubId),
    eq(playerCategory.playerId, item.playerId),
  );
  const coversEffectiveDay = sql`${playerCategory.validFrom} <= ${effectiveOn} and (${playerCategory.validTo} is null or ${playerCategory.validTo} > ${effectiveOn})`;
  const [already] = await db
    .select({ id: playerCategory.id })
    .from(playerCategory)
    .where(and(memberships, eq(playerCategory.categoryId, target.id), coversEffectiveDay))
    .limit(1);
  if (already !== undefined) return { outcome: 'stayed', membershipId: null };
  // A pass on or after the effective day (or a sign-up after it) was done by hand since
  // the draft: it is corrected by hand, never overwritten (same rule as a manual pass).
  const [later] = await db
    .select({ id: playerCategory.id })
    .from(playerCategory)
    .where(
      and(
        memberships,
        sql`${playerCategory.validFrom} >= ${effectiveOn}`,
        sql`(${playerCategory.validTo} is null or ${playerCategory.validTo} > ${playerCategory.validFrom})`,
      ),
    )
    .limit(1);
  if (later !== undefined || compareLocalDates(current.joinedOn, effectiveOn) > 0) {
    return { outcome: 'skipped_later_membership', membershipId: null };
  }
  await db
    .update(playerCategory)
    .set({ validTo: effectiveOn, updatedBy: context.userId })
    .where(
      and(
        memberships,
        sql`${playerCategory.validFrom} < ${effectiveOn}`,
        sql`(${playerCategory.validTo} is null or ${playerCategory.validTo} > ${effectiveOn})`,
      ),
    );
  const [created] = await db
    .insert(playerCategory)
    .values({
      clubId,
      playerId: item.playerId,
      categoryId: target.id,
      seasonId: context.seasonId,
      validFrom: effectiveOn,
      createdBy: context.userId,
      updatedBy: context.userId,
    })
    .returning({ id: playerCategory.id });
  if (created === undefined) throw new Error('applySeasonRollover: the membership is not visible');
  return { outcome: 'moved', membershipId: created.id };
}

// ─── Routes ────────────────────────────────────────────────────────────────────────────

export function registerSeasonRolloverRoutes(app: FastifyInstance): void {
  registerEndpoint(app, createSeasonRollover, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('season', 'manage');
      const { clubId } = caller.membership;
      const findByClientUuid = async (clientUuid: string) =>
        (
          await db
            .select({ id: seasonRollover.id, seasonId: seasonRollover.seasonId })
            .from(seasonRollover)
            .where(
              and(eq(seasonRollover.clubId, clubId), eq(seasonRollover.clientUuid, clientUuid)),
            )
        )[0];
      const previous = await previousCreate(body.clientUuid, reply, findByClientUuid);
      if (previous !== undefined) {
        if (previous.seasonId !== params.seasonId) {
          throw new HttpError('conflict', 'This clientUuid was already used');
        }
        return rolloverDto(await readRollover(db, clubId, previous.id));
      }

      // Under the season's plan lock: its dates and its archive do not change meanwhile.
      await lockSeasonPlan(db, (await readSeasonRow(db, clubId, params.seasonId)).id);
      const target = await readSeasonRow(db, clubId, params.seasonId);
      if (target.archivedAt !== null) {
        throw new HttpError('conflict', 'The season is archived: restore it first');
      }
      const effectiveOn = body.effectiveOn ?? target.startsOn;
      if (
        compareLocalDates(effectiveOn, target.startsOn) < 0 ||
        compareLocalDates(effectiveOn, target.endsOn) > 0
      ) {
        invalid(
          ['body', 'effectiveOn'],
          `The day must lie within the season (${target.startsOn} to ${target.endsOn})`,
        );
      }
      const [draft] = await db
        .select({ id: seasonRollover.id })
        .from(seasonRollover)
        .where(
          and(
            eq(seasonRollover.clubId, clubId),
            eq(seasonRollover.seasonId, target.id),
            eq(seasonRollover.status, 'draft'),
          ),
        );
      if (draft !== undefined) {
        throw new HttpError(
          'conflict',
          'The season already has a season change under review: apply or cancel it first',
        );
      }

      const categories = await categoriesOf(
        db,
        clubId,
        and(eq(category.sport, target.sport), isNull(category.archivedAt)),
      );
      // Active players of the sport who joined by the effective day, with the categories
      // they are in on the day before or start on that day.
      const players = await db
        .select({
          id: player.id,
          birthDate: player.birthDate,
          sex: player.sex,
          currentCategoryIds: sql<CategoryId[]>`coalesce((
            select array_agg(pc.category_id::text order by pc.valid_from, pc.category_id)
              from ${playerCategory} pc
             where pc.club_id = ${OUTER_PLAYER}.club_id and pc.player_id = ${OUTER_PLAYER}.id
               and pc.valid_from <= ${effectiveOn}
               and (pc.valid_to is null or pc.valid_to >= ${effectiveOn})
               and (pc.valid_to is null or pc.valid_to > pc.valid_from)), '{}')::text[]`,
        })
        .from(player)
        .where(
          and(
            eq(player.clubId, clubId),
            eq(player.sport, target.sport),
            isNull(player.archivedAt),
            sql`${player.joinedOn} <= ${effectiveOn}`,
          ),
        )
        .orderBy(asc(player.id));
      const seasonYear = seasonRolloverYear(target);
      const proposal = proposeSeasonRollover({ seasonYear, players, categories });

      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(seasonRollover)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                seasonId: target.id,
                effectiveOn,
                seasonYear,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [seasonRollover.clubId, seasonRollover.clientUuid] })
              .returning({ id: seasonRollover.id, seasonId: seasonRollover.seasonId })
          )[0],
        findByClientUuid,
      });
      for (let start = 0; start < proposal.length; start += INSERT_CHUNK) {
        await db.insert(seasonRolloverItem).values(
          proposal.slice(start, start + INSERT_CHUNK).map((item) => ({
            clubId,
            rolloverId: row.id,
            playerId: item.playerId,
            ageInSeasonYear: item.ageInSeasonYear,
            ageBandCode: item.ageBandCode,
            proposal: item.proposal,
            proposedCategoryId: item.proposedCategoryId,
            needsReview: item.needsReview,
            decision: item.decision,
            targetCategoryId: item.decision === 'move' ? item.proposedCategoryId : null,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          })),
        );
      }
      return rolloverDto(await readRollover(db, clubId, row.id));
    },
  });

  registerEndpoint(app, listSeasonRollovers, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'manage');
      const { clubId } = caller.membership;
      await readSeasonRow(db, clubId, params.seasonId);
      const plan = keysetPage(ROLLOVER_KEYS, query, {
        seasonId: params.seasonId,
        status: query.status,
      });
      const rows = await selectRollovers(db)
        .where(
          and(
            eq(seasonRollover.clubId, clubId),
            eq(seasonRollover.seasonId, params.seasonId),
            query.status === undefined ? undefined : eq(seasonRollover.status, query.status),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, rolloverDto);
    },
  });

  registerEndpoint(app, getSeasonRollover, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'manage');
      return rolloverDto(await readRollover(db, caller.membership.clubId, params.rolloverId));
    },
  });

  registerEndpoint(app, listSeasonRolloverItems, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'manage');
      const { clubId } = caller.membership;
      await readRollover(db, clubId, params.rolloverId);
      const plan = keysetPage(ITEM_KEYS, query, {
        rolloverId: params.rolloverId,
        proposal: query.proposal,
        decision: query.decision,
        outcome: query.outcome,
        needsReview: query.needsReview,
        reviewed: query.reviewed,
        targetCategoryId: query.targetCategoryId,
      });
      const rows = await selectItems(db)
        .where(
          and(
            eq(seasonRolloverItem.clubId, clubId),
            eq(seasonRolloverItem.rolloverId, params.rolloverId),
            query.proposal === undefined
              ? undefined
              : eq(seasonRolloverItem.proposal, query.proposal),
            query.decision === undefined
              ? undefined
              : eq(seasonRolloverItem.decision, query.decision),
            query.outcome === undefined ? undefined : eq(seasonRolloverItem.outcome, query.outcome),
            query.needsReview === undefined
              ? undefined
              : eq(seasonRolloverItem.needsReview, query.needsReview === 'true'),
            query.reviewed === undefined
              ? undefined
              : query.reviewed === 'true'
                ? isNotNull(seasonRolloverItem.reviewedAt)
                : isNull(seasonRolloverItem.reviewedAt),
            query.targetCategoryId === undefined
              ? undefined
              : eq(seasonRolloverItem.targetCategoryId, query.targetCategoryId),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, itemDto);
    },
  });

  registerEndpoint(app, updateSeasonRolloverItem, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'manage');
      const { clubId } = caller.membership;
      await lockRollover(db, (await readRollover(db, clubId, params.rolloverId)).id);
      requireDraft(await readRollover(db, clubId, params.rolloverId));
      const where = and(
        eq(seasonRolloverItem.clubId, clubId),
        eq(seasonRolloverItem.rolloverId, params.rolloverId),
        eq(seasonRolloverItem.id, params.itemId),
      );
      const [current] = await selectItems(db).where(where);
      if (current === undefined) throw new HttpError('not_found', 'Season change item not found');

      if (body.targetCategoryId !== undefined) {
        const [target] = await categoriesOf(db, clubId, eq(category.id, body.targetCategoryId));
        const [own] = await db
          .select({ sport: player.sport })
          .from(player)
          .where(and(eq(player.clubId, clubId), eq(player.id, current.playerId)));
        if (target?.archivedAt !== null) {
          invalid(['body', 'targetCategoryId'], 'The category does not exist or is archived');
        }
        // A category is of a branch (sport and sex, ADR 0017): the player's own.
        if (target.sport !== own?.sport || target.sex !== current.sex) {
          invalid(['body', 'targetCategoryId'], 'The category is of another branch');
        }
        await authorizeTargets(permissions, [target]);
      }
      await updateAtVersion({
        resource: 'Season change item',
        update: async () =>
          (
            await db
              .update(seasonRolloverItem)
              .set({
                decision: body.decision,
                targetCategoryId: body.targetCategoryId ?? null,
                reviewedAt: sql`now()`,
                reviewedBy: caller.userId,
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(seasonRolloverItem.updatedAt, body.version)))
              .returning({ id: seasonRolloverItem.id })
          )[0],
        exists: async () =>
          (await db.select({ id: seasonRolloverItem.id }).from(seasonRolloverItem).where(where))
            .length > 0,
      });
      // Every review changes the version of the draft: applying asks for the one reviewed.
      await db
        .update(seasonRollover)
        .set({ updatedBy: caller.userId })
        .where(and(eq(seasonRollover.clubId, clubId), eq(seasonRollover.id, params.rolloverId)));
      const [updated] = await selectItems(db).where(where);
      if (updated === undefined)
        throw new Error('updateSeasonRolloverItem: the row is not visible');
      return itemDto(updated);
    },
  });

  registerEndpoint(app, applySeasonRollover, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'manage');
      const { clubId } = caller.membership;
      await lockRollover(db, (await readRollover(db, clubId, params.rolloverId)).id);
      const current = await readRollover(db, clubId, params.rolloverId);
      // Idempotent: a retry of an apply that went through answers the applied change.
      if (current.status === 'applied') return rolloverDto(current);
      requireDraft(current);
      if (current.version !== body.version) {
        throw new HttpError(
          'conflict',
          'The season change changed since it was read: read it again',
        );
      }
      if (current.counts.pendingReview > 0) {
        throw new HttpError(
          'conflict',
          `${String(current.counts.pendingReview)} player(s) still need a review before applying`,
        );
      }
      await lockSeasonPlan(db, current.seasonId);
      const target = await readSeasonRow(db, clubId, current.seasonId);
      if (target.archivedAt !== null) {
        throw new HttpError('conflict', 'The season is archived: restore it first');
      }
      if (
        compareLocalDates(current.effectiveOn, target.startsOn) < 0 ||
        compareLocalDates(current.effectiveOn, target.endsOn) > 0
      ) {
        throw new HttpError(
          'conflict',
          'The season no longer contains the day of the change: cancel it and create another one',
        );
      }

      const ofRollover = and(
        eq(seasonRolloverItem.clubId, clubId),
        eq(seasonRolloverItem.rolloverId, current.id),
      );
      // In player order: concurrent passes lock players in a consistent order.
      const moves = (await db
        .select({
          id: seasonRolloverItem.id,
          playerId: seasonRolloverItem.playerId,
          targetCategoryId: seasonRolloverItem.targetCategoryId,
        })
        .from(seasonRolloverItem)
        .where(and(ofRollover, eq(seasonRolloverItem.decision, 'move')))
        .orderBy(asc(seasonRolloverItem.playerId))) as MoveItem[];
      const targetIds = [...new Set(moves.map((m) => m.targetCategoryId))];
      const targets = new Map(
        (targetIds.length === 0
          ? []
          : await categoriesOf(db, clubId, inArray(category.id, targetIds))
        ).map((c) => [c.id, c]),
      );
      await authorizeTargets(permissions, [...targets.values()]);

      const context = {
        clubId,
        userId: caller.userId,
        seasonId: current.seasonId,
        effectiveOn: current.effectiveOn,
      };
      for (const move of moves) {
        const result = await applyMove(db, context, move, targets.get(move.targetCategoryId));
        await db
          .update(seasonRolloverItem)
          .set({
            outcome: result.outcome,
            membershipId: result.membershipId,
            updatedBy: caller.userId,
          })
          .where(and(ofRollover, eq(seasonRolloverItem.id, move.id)));
      }
      await db
        .update(seasonRolloverItem)
        .set({ outcome: 'stayed', updatedBy: caller.userId })
        .where(and(ofRollover, eq(seasonRolloverItem.decision, 'stay')));
      await db
        .update(seasonRollover)
        .set({
          status: 'applied',
          appliedAt: sql`now()`,
          appliedBy: caller.userId,
          updatedBy: caller.userId,
        })
        .where(and(eq(seasonRollover.clubId, clubId), eq(seasonRollover.id, current.id)));
      return rolloverDto(await readRollover(db, clubId, current.id));
    },
  });

  registerEndpoint(app, cancelSeasonRollover, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('season', 'manage');
      const { clubId } = caller.membership;
      await lockRollover(db, (await readRollover(db, clubId, params.rolloverId)).id);
      const current = await readRollover(db, clubId, params.rolloverId);
      if (current.status === 'cancelled') return rolloverDto(current);
      if (current.status === 'applied') {
        throw new HttpError('conflict', 'The season change was already applied');
      }
      await db
        .update(seasonRollover)
        .set({
          status: 'cancelled',
          cancelledAt: sql`now()`,
          cancelledBy: caller.userId,
          updatedBy: caller.userId,
        })
        .where(and(eq(seasonRollover.clubId, clubId), eq(seasonRollover.id, current.id)));
      return rolloverDto(await readRollover(db, clubId, current.id));
    },
  });
}
