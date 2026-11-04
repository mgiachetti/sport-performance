import {
  correctWellness,
  getWellness,
  getWellnessForm,
  listWellness,
  submitWellness,
  type ValidationIssue,
  type Wellness,
  type WellnessForm,
} from '@sport-performance/contracts';
import {
  category,
  consent,
  player,
  playerCategory,
  playerStage,
  wellness,
} from '@sport-performance/db/schema';
import {
  WELLNESS_ITEMS,
  WELLNESS_ITEM_SETS,
  isOfAge,
  isWellnessItemCount,
  isWithinWellnessWindow,
  parseLocalDate,
  wellnessItemSetForStage,
  wellnessMeanScore,
  wellnessScoreIssues,
  wellnessStageOn,
  type CategoryId,
  type ClubId,
  type ConsentType,
  type LocalDate,
  type PlayerFacts,
  type PlayerId,
  type Sport,
  type Stage,
  type WellnessItem,
  type WellnessItemCount,
  type WellnessScores,
} from '@sport-performance/domain';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import {
  insertIdempotent,
  markReplay,
  rowVersion,
  updateAtVersion,
  versionMatches,
} from '../http/writes.js';

/**
 * Wellness (B-319, ADR 0038): the player's pre-training check-in, one per
 * club day, with the item set of their stage that day; staff read it by
 * the scope of the permission matrix.
 */

export const wellnessColumns = {
  id: wellness.id,
  playerId: wellness.playerId,
  localDate: wellness.localDate,
  itemCount: wellness.itemCount,
  sleep: wellness.sleep,
  fatigue: wellness.fatigue,
  soreness: wellness.soreness,
  stress: wellness.stress,
  mood: wellness.mood,
  submittedAt: wellness.submittedAt,
  createdAt: wellness.createdAt,
  updatedAt: wellness.updatedAt,
  version: rowVersion(wellness.updatedAt),
};

export type WellnessRow = Record<WellnessItem, number | null> & {
  id: string;
  playerId: PlayerId;
  localDate: LocalDate;
  itemCount: number;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  version: string;
};

function itemCountOf(row: WellnessRow): WellnessItemCount {
  // `wellness_item_count` checks it in the database.
  if (!isWellnessItemCount(row.itemCount)) {
    throw new Error(`wellness ${row.id}: unknown item count ${String(row.itemCount)}`);
  }
  return row.itemCount;
}

export function wellnessDto(row: WellnessRow): Wellness {
  const itemCount = itemCountOf(row);
  const scores: Partial<Record<WellnessItem, number>> = {};
  for (const item of WELLNESS_ITEMS) {
    const score = row[item];
    if (score !== null) scores[item] = score;
  }
  return {
    id: row.id as Wellness['id'],
    playerId: row.playerId,
    localDate: row.localDate,
    itemCount,
    items: [...WELLNESS_ITEM_SETS[itemCount]],
    scores,
    meanScore: wellnessMeanScore(scores),
    submittedAt: row.submittedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const WELLNESS_KEYS: KeysetSpec<WellnessRow, 'localDate' | 'submittedAt'> = {
  fields: {
    // `YYYY-MM-DD` sorts as text in calendar order.
    localDate: {
      column: sql`${wellness.localDate}::text`,
      type: 'text',
      value: (row) => row.localDate,
    },
    submittedAt: {
      column: wellness.submittedAt,
      type: 'timestamp',
      value: (row) => row.submittedAt,
    },
  },
  id: { column: wellness.id, value: (row) => row.id },
};

/** "Today" in the club's time zone, from the database clock (CLAUDE.md). */
async function clubToday(db: TenantDatabase): Promise<LocalDate> {
  const { rows } = await db.execute<{ today: string | null }>(
    sql`select app.club_today()::text as today`,
  );
  const today = rows[0]?.today ?? null;
  if (today === null) throw new HttpError('forbidden', 'The club of the request is not visible');
  return parseLocalDate(today);
}

/** `valid_from <= day < valid_to` (exclusive end, ADR 0023). */
function validOn(validFrom: AnyColumn, validTo: AnyColumn, day: LocalDate): SQL {
  return sql`(${validFrom} <= ${day} and (${validTo} is null or ${validTo} > ${day}))`;
}

/**
 * Facts of a player for the permission matrix, on the club's `today`:
 * current categories and their sport, majority and current consents. `404`
 * when the player is not visible (RLS) to the caller.
 */
async function loadPlayerFacts(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
  today: LocalDate,
): Promise<PlayerFacts> {
  const [own] = await db
    .select({ id: player.id, birthDate: player.birthDate })
    .from(player)
    .where(and(eq(player.clubId, clubId), eq(player.id, playerId)));
  if (own === undefined) throw new HttpError('not_found', 'Player not found');

  const categories = await db
    .select({
      categoryId: playerCategory.categoryId,
      sport: category.sport,
      current: sql<boolean>`${validOn(playerCategory.validFrom, playerCategory.validTo, today)}`,
    })
    .from(playerCategory)
    .innerJoin(
      category,
      and(eq(category.clubId, playerCategory.clubId), eq(category.id, playerCategory.categoryId)),
    )
    .where(and(eq(playerCategory.clubId, clubId), eq(playerCategory.playerId, playerId)))
    .orderBy(desc(playerCategory.validFrom));
  const current = categories.filter((row) => row.current);
  // The sport of a player is that of their categories: the current ones, else the latest.
  const sport: Sport | undefined = current[0]?.sport ?? categories[0]?.sport;
  if (sport === undefined) {
    throw new HttpError('conflict', 'The player is not in any category of the club');
  }

  const consents = await db
    .selectDistinct({ type: consent.type })
    .from(consent)
    .where(
      and(eq(consent.clubId, clubId), eq(consent.playerId, playerId), isNull(consent.revokedAt)),
    );
  return {
    id: own.id,
    sport,
    categoryIds: current.map((row) => row.categoryId),
    ofAge: isOfAge(own.birthDate, today),
    consents: consents.map((row): ConsentType => row.type),
  };
}

/**
 * Stage that sets the item set of `day`: the stage assignment valid that
 * day (a staff pin first), else the youngest default stage of the
 * categories the player is in that day (domain `wellnessStageOn`).
 */
export async function wellnessStageOf(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
  day: LocalDate,
): Promise<Stage | null> {
  const [assigned] = await db
    .select({ stage: playerStage.stage })
    .from(playerStage)
    .where(
      and(
        eq(playerStage.clubId, clubId),
        eq(playerStage.playerId, playerId),
        validOn(playerStage.validFrom, playerStage.validTo, day),
      ),
    )
    .orderBy(sql`(${playerStage.basis} = 'manual') desc`, desc(playerStage.validFrom))
    .limit(1);
  const categories = await db
    .select({ defaultStage: category.defaultStage })
    .from(playerCategory)
    .innerJoin(
      category,
      and(eq(category.clubId, playerCategory.clubId), eq(category.id, playerCategory.categoryId)),
    )
    .where(
      and(
        eq(playerCategory.clubId, clubId),
        eq(playerCategory.playerId, playerId),
        validOn(playerCategory.validFrom, playerCategory.validTo, day),
      ),
    );
  return wellnessStageOn({
    assignedStage: assigned?.stage ?? null,
    categoryDefaultStages: categories.map((row) => row.defaultStage),
  });
}

/** The caller's own player, authorized to submit wellness (self + data consent). */
async function submittingPlayer(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  today: LocalDate,
): Promise<PlayerFacts> {
  const subject = await permissions.subject();
  const playerId = subject.playerId ?? null;
  if (playerId === null) {
    // Not a player (or a player without a profile): the matrix answers.
    await permissions.authorize('wellness', 'submit');
    throw new HttpError('forbidden', 'You are not allowed to do this');
  }
  const facts = await loadPlayerFacts(db, clubId, playerId, today);
  await permissions.authorize('wellness', 'submit', { player: facts });
  return facts;
}

function scoreIssues(itemCount: WellnessItemCount, scores: WellnessScores): ValidationIssue[] {
  const messages = {
    missing: 'Required by the item set of the stage',
    not_in_set: `Not asked in the ${String(itemCount)}-item set`,
    out_of_range: 'An integer from 1 to 5',
  } as const;
  return wellnessScoreIssues(itemCount, scores).map(({ item, problem }) => ({
    path: ['body', 'scores', item],
    code: 'custom',
    message: messages[problem],
  }));
}

function assertScores(itemCount: WellnessItemCount, scores: WellnessScores): void {
  const issues = scoreIssues(itemCount, scores);
  if (issues.length > 0) {
    throw new HttpError('validation_failed', 'The scores do not match the item set', {
      details: issues,
    });
  }
}

/** Column values of an answer: the items of the set, `NULL` the rest. */
function scoreColumns(scores: WellnessScores): Record<WellnessItem, number | null> {
  return {
    sleep: scores.sleep ?? null,
    fatigue: scores.fatigue ?? null,
    soreness: scores.soreness ?? null,
    stress: scores.stress ?? null,
    mood: scores.mood ?? null,
  };
}

async function readWellness(
  db: TenantDatabase,
  clubId: ClubId,
  wellnessId: string,
): Promise<WellnessRow> {
  const [row] = await db
    .select(wellnessColumns)
    .from(wellness)
    .where(and(eq(wellness.clubId, clubId), eq(wellness.id, wellnessId)));
  if (row === undefined) throw new HttpError('not_found', 'Wellness entry not found');
  return row;
}

/** Players whose current category is in the assignments (as `app.visible_player_ids`). */
function assignedPlayers(
  today: LocalDate,
  categoryIds: readonly CategoryId[],
  sports: readonly Sport[],
): SQL {
  const target = or(
    categoryIds.length > 0 ? inArray(category.id, [...categoryIds]) : undefined,
    sports.length > 0 ? inArray(category.sport, [...sports]) : undefined,
  );
  return sql`exists (
    select 1 from ${playerCategory}
      join ${category} on ${category.clubId} = ${playerCategory.clubId}
                      and ${category.id} = ${playerCategory.categoryId}
     where ${playerCategory.clubId} = ${wellness.clubId}
       and ${playerCategory.playerId} = ${wellness.playerId}
       and ${validOn(playerCategory.validFrom, playerCategory.validTo, today)}
       and ${target})`;
}

/** Entries whose player was in `categoryId` on the day of the entry. */
function inCategoryOnTheDay(categoryId: CategoryId): SQL {
  return sql`exists (
    select 1 from ${playerCategory}
     where ${playerCategory.clubId} = ${wellness.clubId}
       and ${playerCategory.playerId} = ${wellness.playerId}
       and ${playerCategory.categoryId} = ${categoryId}
       and ${playerCategory.validFrom} <= ${wellness.localDate}
       and (${playerCategory.validTo} is null or ${playerCategory.validTo} > ${wellness.localDate}))`;
}

export function registerWellnessRoutes(app: FastifyInstance): void {
  registerEndpoint(app, getWellnessForm, {
    transaction: true,
    handler: async (_input, { db, permissions, auth: caller }): Promise<WellnessForm> => {
      const { clubId } = caller.membership;
      const today = await clubToday(db);
      const facts = await submittingPlayer(db, permissions, clubId, today);
      const stage = await wellnessStageOf(db, clubId, facts.id, today);
      if (stage === null) {
        throw new HttpError('conflict', 'The player has no stage nor category today');
      }
      const set = wellnessItemSetForStage(stage);
      const [entry] = await db
        .select(wellnessColumns)
        .from(wellness)
        .where(
          and(
            eq(wellness.clubId, clubId),
            eq(wellness.playerId, facts.id),
            eq(wellness.localDate, today),
          ),
        );
      return {
        playerId: facts.id,
        localDate: today,
        stage,
        itemCount: set.itemCount,
        items: [...set.items],
        entry: entry === undefined ? null : wellnessDto(entry),
      };
    },
  });

  registerEndpoint(app, submitWellness, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const today = await clubToday(db);
      const facts = await submittingPlayer(db, permissions, clubId, today);
      if (body.clientUuid !== undefined) {
        // A replay of the offline queue answers what it created, even after the window closed.
        const [replay] = await db
          .select(wellnessColumns)
          .from(wellness)
          .where(
            and(
              eq(wellness.clubId, clubId),
              eq(wellness.playerId, facts.id),
              eq(wellness.clientUuid, body.clientUuid),
            ),
          );
        if (replay !== undefined) {
          markReplay(reply);
          return wellnessDto(replay);
        }
      }
      const day = body.localDate ?? today;
      if (!isWithinWellnessWindow(day, today)) {
        throw new HttpError('validation_failed', 'Wellness is loaded for today or yesterday', {
          details: [
            {
              path: ['body', 'localDate'],
              code: 'custom',
              message: `A club day from yesterday to today (${today})`,
            },
          ],
        });
      }
      const stage = await wellnessStageOf(db, clubId, facts.id, day);
      if (stage === null) {
        throw new HttpError('conflict', 'The player has no stage nor category on that day');
      }
      const { itemCount } = wellnessItemSetForStage(stage);
      assertScores(itemCount, body.scores);
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(wellness)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                playerId: facts.id,
                localDate: day,
                itemCount,
                ...scoreColumns(body.scores),
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              // The day's unique key (`wellness_club_id_player_id_local_date_key`) still
              // raises: another check-in of the same day is `409 conflict`.
              .onConflictDoNothing({ target: [wellness.clubId, wellness.clientUuid] })
              .returning(wellnessColumns)
          )[0],
        findByClientUuid: async (clientUuid) =>
          (
            await db
              .select(wellnessColumns)
              .from(wellness)
              .where(and(eq(wellness.clubId, clubId), eq(wellness.clientUuid, clientUuid)))
          )[0],
      });
      return wellnessDto(row);
    },
  });

  registerEndpoint(app, correctWellness, {
    transaction: true,
    changeReason: ({ body }) => body.changeReason,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const today = await clubToday(db);
      const entry = await readWellness(db, clubId, params.wellnessId);
      const facts = await loadPlayerFacts(db, clubId, entry.playerId, today);
      await permissions.authorize('wellness', 'submit', { player: facts });
      if (!isWithinWellnessWindow(entry.localDate, today)) {
        throw new HttpError(
          'conflict',
          'Only the check-ins of today and yesterday are corrected by the player',
        );
      }
      // The item set of an entry is the one it was answered with: it never changes.
      assertScores(itemCountOf(entry), body.scores);
      const row = await updateAtVersion({
        resource: 'Wellness entry',
        update: async () =>
          (
            await db
              .update(wellness)
              .set({ ...scoreColumns(body.scores), updatedBy: caller.userId })
              .where(
                and(
                  eq(wellness.clubId, clubId),
                  eq(wellness.id, entry.id),
                  versionMatches(wellness.updatedAt, body.version),
                ),
              )
              .returning(wellnessColumns)
          )[0],
        exists: async () =>
          (
            await db
              .select({ id: wellness.id })
              .from(wellness)
              .where(and(eq(wellness.clubId, clubId), eq(wellness.id, entry.id)))
          ).length > 0,
      });
      return wellnessDto(row);
    },
  });

  registerEndpoint(app, listWellness, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const scope = await permissions.listScope('wellness', 'read');
      const plan = keysetPage(WELLNESS_KEYS, query, {
        playerId: query.playerId,
        categoryId: query.categoryId,
        from: query.from,
        to: query.to,
      });
      if (scope.kind === 'none') return { items: [], nextCursor: null };
      if (scope.rowCheck) {
        // `wellness.read` has no consent or condition today; a new one needs a row check here.
        throw new Error('listWellness: the matrix asks for a row check the list does not do');
      }
      let inScope: SQL | undefined;
      switch (scope.kind) {
        case 'club':
          inScope = undefined;
          break;
        case 'assigned':
          inScope = assignedPlayers(await clubToday(db), scope.categoryIds, scope.sports);
          break;
        case 'players':
          inScope = inArray(wellness.playerId, [...scope.playerIds]);
          break;
        case 'platform':
          // No rule of `wellness.read` is platform-wide: deny instead of guessing.
          return { items: [], nextCursor: null };
      }
      const rows = await db
        .select(wellnessColumns)
        .from(wellness)
        .where(
          and(
            eq(wellness.clubId, caller.membership.clubId),
            inScope,
            query.playerId === undefined ? undefined : eq(wellness.playerId, query.playerId),
            query.categoryId === undefined ? undefined : inCategoryOnTheDay(query.categoryId),
            query.from === undefined ? undefined : gte(wellness.localDate, query.from),
            query.to === undefined ? undefined : lte(wellness.localDate, query.to),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, wellnessDto);
    },
  });

  registerEndpoint(app, getWellness, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const entry = await readWellness(db, clubId, params.wellnessId);
      const facts = await loadPlayerFacts(db, clubId, entry.playerId, await clubToday(db));
      await permissions.authorize('wellness', 'read', { player: facts });
      return wellnessDto(entry);
    },
  });
}
