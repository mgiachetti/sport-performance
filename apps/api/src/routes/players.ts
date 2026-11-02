import {
  addPlayerCategory,
  archivePlayer,
  createPlayer,
  getPlayer,
  getPlayerParentHeights,
  listPlayerCategories,
  listPlayers,
  restorePlayer,
  setPlayerParentHeight,
  updatePlayer,
  updatePlayerCategory,
  type ParentHeight,
  type Player,
  type PlayerCategoryMembership,
} from '@sport-performance/contracts';
import {
  category,
  clubBranch,
  consent,
  player,
  playerCategory,
  playerParentHeight,
  playerPosition,
  position,
} from '@sport-performance/db/schema';
import {
  AGE_OF_MAJORITY_YEARS,
  addDays,
  can,
  compareLocalDates,
  isConsentType,
  isOfAge,
  parseLocalDate,
  ruleFor,
  type CategoryId,
  type ClubId,
  type ConsentType,
  type DominantSide,
  type HeightSource,
  type LocalDate,
  type Parent,
  type PermissionSubject,
  type PlayerFacts,
  type PlayerId,
  type PlayerLeaveReason,
  type Sex,
  type Sport,
} from '@sport-performance/domain';
import { and, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, likePattern, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import {
  archiveStatusFilter,
  insertIdempotent,
  markReplay,
  rowVersion,
  updateAtVersion,
  versionMatches,
} from '../http/writes.js';

/**
 * Players and roster (B-315, ADR 0035): the profile, positions, sign-up and
 * leave, category history and the parents' heights. Every handler asks the
 * permission matrix first (ADR 0025, ADR 0032); RLS stays as the second
 * barrier, so a player the caller cannot see is `404`, not `403`.
 */

/** "Today" in the club's time zone (CLAUDE.md), from the database's clock. */
const CLUB_TODAY = sql`(select app.club_today())`;

/**
 * The `player` row of the outer query, qualified: Drizzle renders the columns of a
 * single-table select unqualified, which inside a subquery would bind to its own table.
 */
const OUTER_PLAYER = sql.raw('"player"');

/** A membership row covers the club's today (`valid_to` exclusive, ADR 0023). */
const currentMembership = sql`pc.valid_from <= ${CLUB_TODAY} and (pc.valid_to is null or pc.valid_to > ${CLUB_TODAY})`;

const playerColumns = {
  id: player.id,
  firstName: player.firstName,
  lastName: player.lastName,
  birthDate: player.birthDate,
  sex: player.sex,
  sport: player.sport,
  dominantSide: player.dominantSide,
  joinedOn: player.joinedOn,
  leftOn: player.leftOn,
  leftReason: player.leftReason,
  leftNote: player.leftNote,
  archivedAt: player.archivedAt,
  createdAt: player.createdAt,
  updatedAt: player.updatedAt,
  version: rowVersion(player.updatedAt),
  hasAccount: sql<boolean>`(${player.userId} is not null)`,
  positionIds: sql<string[]>`coalesce((
    select array_agg(pp.position_id::text order by pp.sort_order)
      from ${playerPosition} pp
     where pp.club_id = ${OUTER_PLAYER}.club_id and pp.player_id = ${OUTER_PLAYER}.id), '{}')::text[]`,
  currentCategoryIds: sql<string[]>`coalesce((
    select array_agg(pc.category_id::text order by pc.valid_from, pc.category_id)
      from ${playerCategory} pc
     where pc.club_id = ${OUTER_PLAYER}.club_id and pc.player_id = ${OUTER_PLAYER}.id
       and ${currentMembership}), '{}')::text[]`,
};

interface PlayerRow {
  id: PlayerId;
  firstName: string;
  lastName: string;
  birthDate: LocalDate;
  sex: Sex;
  sport: Sport;
  dominantSide: DominantSide | null;
  joinedOn: LocalDate;
  leftOn: LocalDate | null;
  leftReason: PlayerLeaveReason | null;
  leftNote: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
  hasAccount: boolean;
  positionIds: string[];
  currentCategoryIds: string[];
}

function playerDto(row: PlayerRow): Player {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    birthDate: row.birthDate,
    sex: row.sex,
    sport: row.sport,
    dominantSide: row.dominantSide,
    positionIds: row.positionIds as Player['positionIds'],
    currentCategoryIds: row.currentCategoryIds as Player['currentCategoryIds'],
    joinedOn: row.joinedOn,
    leftOn: row.leftOn,
    leftReason: row.leftReason,
    leftNote: row.leftNote,
    hasAccount: row.hasAccount,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

/** Sort by name: last name, then first name (the same text the cursor carries). */
const fullName = sql`(${player.lastName} || ' ' || ${player.firstName})`;

const PLAYER_KEYS: KeysetSpec<PlayerRow, 'name' | 'birthDate' | 'joinedOn' | 'createdAt'> = {
  fields: {
    name: { column: fullName, type: 'text', value: (row) => `${row.lastName} ${row.firstName}` },
    // ISO dates sort as text the same way they sort as dates.
    birthDate: { column: sql`${player.birthDate}::text`, type: 'text', value: (r) => r.birthDate },
    joinedOn: { column: sql`${player.joinedOn}::text`, type: 'text', value: (r) => r.joinedOn },
    createdAt: { column: player.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: player.id, value: (row) => row.id },
};

const membershipColumns = {
  id: playerCategory.id,
  playerId: playerCategory.playerId,
  categoryId: playerCategory.categoryId,
  seasonId: playerCategory.seasonId,
  validFrom: playerCategory.validFrom,
  validTo: playerCategory.validTo,
  createdAt: playerCategory.createdAt,
  updatedAt: playerCategory.updatedAt,
  version: rowVersion(playerCategory.updatedAt),
};

interface MembershipRow {
  id: string;
  playerId: PlayerId;
  categoryId: CategoryId;
  seasonId: string | null;
  validFrom: LocalDate;
  validTo: LocalDate | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

function membershipDto(row: MembershipRow): PlayerCategoryMembership {
  return {
    id: row.id as PlayerCategoryMembership['id'],
    playerId: row.playerId,
    categoryId: row.categoryId,
    seasonId: row.seasonId as PlayerCategoryMembership['seasonId'],
    validFrom: row.validFrom,
    validTo: row.validTo,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const MEMBERSHIP_KEYS: KeysetSpec<MembershipRow, 'validFrom'> = {
  fields: {
    validFrom: {
      column: sql`${playerCategory.validFrom}::text`,
      type: 'text',
      value: (row) => row.validFrom,
    },
  },
  id: { column: playerCategory.id, value: (row) => row.id },
};

const parentHeightColumns = {
  parent: playerParentHeight.parent,
  heightCm: playerParentHeight.heightCm,
  source: playerParentHeight.source,
  updatedAt: playerParentHeight.updatedAt,
  version: rowVersion(playerParentHeight.updatedAt),
};

interface ParentHeightRow {
  parent: Parent;
  heightCm: number;
  source: HeightSource;
  updatedAt: Date;
  version: string;
}

function parentHeightDto(row: ParentHeightRow): ParentHeight {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

// ─── Reads and checks ──────────────────────────────────────────────────────────────────

async function clubToday(db: TenantDatabase): Promise<LocalDate> {
  const { rows } = await db.execute<{ today: string | null }>(
    sql`select app.club_today()::text as today`,
  );
  const today = rows[0]?.today ?? null;
  if (today === null) throw new HttpError('forbidden', 'The club of the request is not visible');
  return parseLocalDate(today);
}

async function findPlayer(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
): Promise<PlayerRow | undefined> {
  const [row] = await db
    .select(playerColumns)
    .from(player)
    .where(and(eq(player.clubId, clubId), eq(player.id, playerId)));
  return row;
}

async function readPlayer(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
): Promise<PlayerRow> {
  const row = await findPlayer(db, clubId, playerId);
  // Another club's, or one the RLS does not show the caller: it does not exist for them.
  if (row === undefined) throw new HttpError('not_found', 'Player not found');
  return row;
}

/** Types of the player's current consents (signed, not revoked; B-312). */
async function currentConsents(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
): Promise<ConsentType[]> {
  const rows = await db
    .selectDistinct({ type: consent.type })
    .from(consent)
    .where(
      and(eq(consent.clubId, clubId), eq(consent.playerId, playerId), isNull(consent.revokedAt)),
    );
  return rows.map((r) => r.type).filter(isConsentType);
}

/** What the matrix needs to know about a player, on the club's day. */
function factsOf(row: PlayerRow, today: LocalDate, consents?: ConsentType[]): PlayerFacts {
  return {
    id: row.id,
    sport: row.sport,
    categoryIds: row.currentCategoryIds as CategoryId[],
    ofAge: isOfAge(row.birthDate, today),
    ...(consents !== undefined && { consents }),
  };
}

/**
 * The resource a role reads a profile through: the full profile
 * (`player_profile`) or, for a guardian, the summarised one
 * (`player_summary`, ADR 0035). Both serve the same roster data.
 */
function profileReadKind(subject: PermissionSubject): 'player_profile' | 'player_summary' {
  return ruleFor('player_profile', 'read', subject.role).effect === 'allow'
    ? 'player_profile'
    : 'player_summary';
}

/** Reads a player and checks the caller may `action` it on the matrix. */
async function authorizedPlayer(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  playerId: PlayerId,
  access:
    | { kind: 'profile_read' }
    | { kind: 'player_profile'; action: 'update' | 'archive' }
    | { kind: 'parent_height'; action: 'read' | 'report' },
): Promise<{ row: PlayerRow; today: LocalDate }> {
  const row = await readPlayer(db, clubId, playerId);
  const today = await clubToday(db);
  switch (access.kind) {
    case 'profile_read': {
      const kind = profileReadKind(await permissions.subject());
      await permissions.authorize(kind, 'read', { player: factsOf(row, today) });
      break;
    }
    case 'player_profile':
      await permissions.authorize('player_profile', access.action, {
        player: factsOf(row, today),
      });
      break;
    case 'parent_height': {
      // Reporting collects data of the player: it needs a current `data` consent.
      const consents =
        access.action === 'report' ? await currentConsents(db, clubId, playerId) : undefined;
      await permissions.authorize('parent_height', access.action, {
        player: factsOf(row, today, consents),
      });
      break;
    }
  }
  return { row, today };
}

function invalid(path: (string | number)[], message: string): HttpError {
  return new HttpError('validation_failed', message, {
    details: [{ path, code: 'custom', message }],
  });
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

/** Every position exists in the club and is of the sport (the trigger is the backstop). */
async function checkPositions(
  db: TenantDatabase,
  clubId: ClubId,
  sport: Sport,
  positionIds: readonly string[],
): Promise<void> {
  if (positionIds.length === 0) return;
  const rows = await db
    .select({ id: position.id })
    .from(position)
    .where(
      and(
        eq(position.clubId, clubId),
        eq(position.sport, sport),
        inArray(position.id, [...positionIds]),
      ),
    );
  if (rows.length !== positionIds.length) {
    throw invalid(['body', 'positionIds'], 'Every position must be of the sport of the player');
  }
}

async function replacePositions(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
  positionIds: readonly string[],
  userId: string,
): Promise<void> {
  await db
    .delete(playerPosition)
    .where(and(eq(playerPosition.clubId, clubId), eq(playerPosition.playerId, playerId)));
  if (positionIds.length === 0) return;
  await db.insert(playerPosition).values(
    positionIds.map((positionId, sortOrder) => ({
      clubId,
      playerId,
      positionId,
      sortOrder,
      createdBy: userId,
      updatedBy: userId,
    })),
  );
}

/** An active category of the club and of the player's branch, or a validation error on `path`. */
async function categoryForPlayer(
  db: TenantDatabase,
  clubId: ClubId,
  categoryId: CategoryId,
  player: { sport: Sport; sex: Sex },
  path: (string | number)[],
): Promise<{ id: CategoryId; sport: Sport }> {
  const [row] = await db
    .select({ id: category.id, sport: category.sport, sex: category.sex })
    .from(category)
    .where(
      and(eq(category.clubId, clubId), eq(category.id, categoryId), isNull(category.archivedAt)),
    );
  if (row === undefined) throw invalid(path, 'The category does not exist or is archived');
  if (row.sport !== player.sport) throw invalid(path, 'The category is of another sport');
  // A category is of a branch (sport and sex, ADR 0017): no mixed categories (ADR 0035).
  if (row.sex !== player.sex) throw invalid(path, 'The category is of another branch (sex)');
  return { id: row.id, sport: row.sport };
}

/** One membership change at a time per player: checks and writes do not race. */
async function lockPlayer(db: TenantDatabase, playerId: PlayerId): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`player:${playerId}`}, 0))`);
}

function notAfterToday(date: LocalDate, today: LocalDate, path: (string | number)[]): void {
  if (compareLocalDates(date, today) > 0) throw invalid(path, 'The date cannot be in the future');
}

/** Rows of the same category overlapping `[from, to)` (`to` null: open ended). */
async function overlapsSameCategory(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
  categoryId: CategoryId,
  from: LocalDate,
  to: LocalDate | null,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: playerCategory.id })
    .from(playerCategory)
    .where(
      and(
        eq(playerCategory.clubId, clubId),
        eq(playerCategory.playerId, playerId),
        eq(playerCategory.categoryId, categoryId),
        exceptId === undefined ? undefined : ne(playerCategory.id, exceptId),
        sql`(${playerCategory.validTo} is null or ${playerCategory.validTo} > ${from})`,
        to === null ? undefined : sql`${playerCategory.validFrom} < ${to}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

// ─── Routes ────────────────────────────────────────────────────────────────────────────

export function registerPlayerRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listPlayers, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const subject = await permissions.subject();
      const kind = profileReadKind(subject);
      const scope = await permissions.listScope(kind, 'read');
      const plan = keysetPage(PLAYER_KEYS, query, {
        categoryId: query.categoryId,
        sport: query.sport,
        sex: query.sex,
        status: query.status,
        q: query.q,
      });
      if (scope.kind === 'none') return { items: [], nextCursor: null };

      let inScope: SQL | undefined;
      switch (scope.kind) {
        case 'club':
        case 'platform':
          break;
        case 'assigned': {
          // The same rule as the RLS (`app.visible_player_ids`): players currently in a
          // category of the assignments, or in any category of an assigned sport.
          const byCategory =
            scope.categoryIds.length > 0
              ? sql`pc.category_id = any(${sql.param([...scope.categoryIds])}::uuid[])`
              : sql`false`;
          const bySport =
            scope.sports.length > 0
              ? sql`c.sport::text = any(${sql.param([...scope.sports])}::text[])`
              : sql`false`;
          inScope = sql`exists (
            select 1 from ${playerCategory} pc
              join ${category} c on c.club_id = pc.club_id and c.id = pc.category_id
             where pc.club_id = ${OUTER_PLAYER}.club_id and pc.player_id = ${OUTER_PLAYER}.id
               and ${currentMembership} and (${byCategory} or ${bySport}))`;
          break;
        }
        case 'players':
          inScope = inArray(player.id, [...scope.playerIds]);
          break;
      }
      // A guardian's access ends at the player's majority unless the adult confirms it:
      // only minors, decided in SQL so pages stay full.
      // TODO(B-311): also the adult wards whose guardianship has `confirmedByAdultPlayer`
      // (GET of one player already allows them through the matrix).
      const minorsOnly =
        kind === 'player_summary'
          ? sql`${player.birthDate} > (${CLUB_TODAY} - make_interval(years => ${AGE_OF_MAJORITY_YEARS}))::date`
          : undefined;

      const search =
        query.q === undefined
          ? undefined
          : or(
              ilike(player.firstName, likePattern(query.q)),
              ilike(player.lastName, likePattern(query.q)),
              ilike(fullName, likePattern(query.q)),
            );
      const inCategory =
        query.categoryId === undefined
          ? undefined
          : sql`exists (
              select 1 from ${playerCategory} pc
               where pc.club_id = ${OUTER_PLAYER}.club_id and pc.player_id = ${OUTER_PLAYER}.id
                 and pc.category_id = ${query.categoryId} and ${currentMembership})`;

      const rows = await db
        .select(playerColumns)
        .from(player)
        .where(
          and(
            eq(player.clubId, clubId),
            inScope,
            minorsOnly,
            query.sport === undefined ? undefined : eq(player.sport, query.sport),
            query.sex === undefined ? undefined : eq(player.sex, query.sex),
            archiveStatusFilter(player.archivedAt, query.status),
            inCategory,
            search,
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);

      if (scope.rowCheck) {
        // Defense in depth: every row must pass the matrix with its own facts.
        const today = await clubToday(db);
        for (const row of rows) {
          if (!can(subject, 'read', { kind, clubId, player: factsOf(row, today) })) {
            throw new Error('listPlayers: a row outside the scope of the matrix');
          }
        }
      }
      return plan.page(rows, playerDto);
    },
  });

  registerEndpoint(app, getPlayer, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { row } = await authorizedPlayer(
        db,
        permissions,
        caller.membership.clubId,
        params.playerId,
        { kind: 'profile_read' },
      );
      return playerDto(row);
    },
  });

  registerEndpoint(app, createPlayer, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('player_profile', 'create');
      const { clubId } = caller.membership;
      const today = await clubToday(db);

      if (body.clientUuid !== undefined) {
        const [replay] = await db
          .select({ id: player.id })
          .from(player)
          .where(and(eq(player.clubId, clubId), eq(player.clientUuid, body.clientUuid)));
        if (replay !== undefined) {
          markReplay(reply);
          return playerDto(await readPlayer(db, clubId, replay.id));
        }
      }

      const joinedOn = body.joinedOn ?? today;
      notAfterToday(body.birthDate, today, ['body', 'birthDate']);
      notAfterToday(joinedOn, today, ['body', 'joinedOn']);
      if (compareLocalDates(joinedOn, body.birthDate) < 0) {
        throw invalid(['body', 'joinedOn'], 'The player cannot join before being born');
      }
      if (!(await branchIsActive(db, clubId, body.sport, body.sex))) {
        throw invalid(
          ['body', 'sport'],
          'The branch (sport and sex) is not enabled in the club: enable or restore it first',
        );
      }
      const positionIds = body.positionIds ?? [];
      await checkPositions(db, clubId, body.sport, positionIds);
      const initial =
        body.categoryId === undefined
          ? undefined
          : await categoryForPlayer(db, clubId, body.categoryId, body, ['body', 'categoryId']);

      const { row: created, replayed } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(player)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                firstName: body.firstName,
                lastName: body.lastName,
                birthDate: body.birthDate,
                sex: body.sex,
                sport: body.sport,
                dominantSide: body.dominantSide ?? null,
                joinedOn,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [player.clubId, player.clientUuid] })
              .returning({ id: player.id })
          )[0],
        // A concurrent create with the same clientUuid won the race.
        findByClientUuid: async (clientUuid) =>
          (
            await db
              .select({ id: player.id })
              .from(player)
              .where(and(eq(player.clubId, clubId), eq(player.clientUuid, clientUuid)))
          )[0],
      });
      if (replayed) return playerDto(await readPlayer(db, clubId, created.id));
      await replacePositions(db, clubId, created.id, positionIds, caller.userId);
      if (initial !== undefined) {
        await db.insert(playerCategory).values({
          clubId,
          playerId: created.id,
          categoryId: initial.id,
          validFrom: joinedOn,
          createdBy: caller.userId,
          updatedBy: caller.userId,
        });
      }
      return playerDto(await readPlayer(db, clubId, created.id));
    },
  });

  registerEndpoint(app, updatePlayer, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { row: current, today } = await authorizedPlayer(
        db,
        permissions,
        clubId,
        params.playerId,
        { kind: 'player_profile', action: 'update' },
      );
      if (body.joinedOn !== undefined) {
        // The memberships are checked against the new day: no membership change in between.
        await lockPlayer(db, params.playerId);
      }
      const birthDate = body.birthDate ?? current.birthDate;
      const joinedOn = body.joinedOn ?? current.joinedOn;
      if (body.birthDate !== undefined) notAfterToday(body.birthDate, today, ['body', 'birthDate']);
      if (body.joinedOn !== undefined) notAfterToday(body.joinedOn, today, ['body', 'joinedOn']);
      if (compareLocalDates(joinedOn, birthDate) < 0) {
        throw invalid(['body', 'joinedOn'], 'The player cannot join before being born');
      }
      if (current.leftOn !== null && compareLocalDates(joinedOn, current.leftOn) > 0) {
        throw invalid(['body', 'joinedOn'], 'The player cannot join after leaving');
      }
      if (body.joinedOn !== undefined && compareLocalDates(body.joinedOn, current.joinedOn) > 0) {
        const [earlier] = await db
          .select({ id: playerCategory.id })
          .from(playerCategory)
          .where(
            and(
              eq(playerCategory.clubId, clubId),
              eq(playerCategory.playerId, params.playerId),
              sql`${playerCategory.validFrom} < ${body.joinedOn}`,
            ),
          )
          .limit(1);
        if (earlier !== undefined) {
          throw new HttpError(
            'conflict',
            'The player has a category membership that starts before that day: correct it first',
          );
        }
      }
      if (
        body.sex !== undefined &&
        body.sex !== current.sex &&
        !(await branchIsActive(db, clubId, current.sport, body.sex))
      ) {
        throw invalid(['body', 'sex'], 'The branch (sport and sex) is not enabled in the club');
      }
      if (body.positionIds !== undefined) {
        await checkPositions(db, clubId, current.sport, body.positionIds);
      }

      const where = and(eq(player.clubId, clubId), eq(player.id, params.playerId));
      await updateAtVersion({
        resource: 'Player',
        update: async () =>
          (
            await db
              .update(player)
              .set({
                ...(body.firstName !== undefined && { firstName: body.firstName }),
                ...(body.lastName !== undefined && { lastName: body.lastName }),
                ...(body.birthDate !== undefined && { birthDate: body.birthDate }),
                ...(body.sex !== undefined && { sex: body.sex }),
                ...(body.dominantSide !== undefined && { dominantSide: body.dominantSide }),
                ...(body.joinedOn !== undefined && { joinedOn: body.joinedOn }),
                // Always written: the version moves also when only the positions change.
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(player.updatedAt, body.version)))
              .returning({ id: player.id })
          )[0],
        exists: async () =>
          (await db.select({ id: player.id }).from(player).where(where)).length > 0,
      });
      if (body.positionIds !== undefined) {
        await replacePositions(db, clubId, params.playerId, body.positionIds, caller.userId);
      }
      return playerDto(await readPlayer(db, clubId, params.playerId));
    },
  });

  registerEndpoint(app, archivePlayer, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { today } = await authorizedPlayer(db, permissions, clubId, params.playerId, {
        kind: 'player_profile',
        action: 'archive',
      });
      // Read again under the lock: a concurrent archive must not overwrite the first one.
      await lockPlayer(db, params.playerId);
      const row = await readPlayer(db, clubId, params.playerId);
      if (row.archivedAt !== null) return playerDto(row);
      notAfterToday(body.leftOn, today, ['body', 'leftOn']);
      if (compareLocalDates(body.leftOn, row.joinedOn) < 0) {
        throw invalid(['body', 'leftOn'], 'The player cannot leave before joining');
      }
      const end = addDays(body.leftOn, 1);
      const memberships = and(
        eq(playerCategory.clubId, clubId),
        eq(playerCategory.playerId, params.playerId),
      );
      const [later] = await db
        .select({ id: playerCategory.id })
        .from(playerCategory)
        .where(and(memberships, sql`${playerCategory.validFrom} >= ${end}`))
        .limit(1);
      if (later !== undefined) {
        throw new HttpError(
          'conflict',
          'The player has a category membership that starts after leaving: correct it first',
        );
      }
      // The categories close the day after the last one (`valid_to` is exclusive).
      await db
        .update(playerCategory)
        .set({ validTo: end, updatedBy: caller.userId })
        .where(
          and(
            memberships,
            sql`(${playerCategory.validTo} is null or ${playerCategory.validTo} > ${end})`,
          ),
        );
      await db
        .update(player)
        .set({
          leftOn: body.leftOn,
          leftReason: body.reason,
          leftNote: body.note ?? null,
          archivedAt: sql`now()`,
          updatedBy: caller.userId,
        })
        .where(and(eq(player.clubId, clubId), eq(player.id, params.playerId)));
      return playerDto(await readPlayer(db, clubId, params.playerId));
    },
  });

  registerEndpoint(app, restorePlayer, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      await authorizedPlayer(db, permissions, clubId, params.playerId, {
        kind: 'player_profile',
        action: 'archive',
      });
      await lockPlayer(db, params.playerId);
      const row = await readPlayer(db, clubId, params.playerId);
      if (row.archivedAt === null) return playerDto(row);
      await db
        .update(player)
        .set({
          leftOn: null,
          leftReason: null,
          leftNote: null,
          archivedAt: null,
          updatedBy: caller.userId,
        })
        .where(and(eq(player.clubId, clubId), eq(player.id, params.playerId)));
      return playerDto(await readPlayer(db, clubId, params.playerId));
    },
  });

  registerEndpoint(app, listPlayerCategories, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      await authorizedPlayer(db, permissions, clubId, params.playerId, { kind: 'profile_read' });
      const plan = keysetPage(MEMBERSHIP_KEYS, query, {});
      const rows = await db
        .select(membershipColumns)
        .from(playerCategory)
        .where(
          and(
            eq(playerCategory.clubId, clubId),
            eq(playerCategory.playerId, params.playerId),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, membershipDto);
    },
  });

  registerEndpoint(app, addPlayerCategory, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      await authorizedPlayer(db, permissions, clubId, params.playerId, {
        kind: 'player_profile',
        action: 'update',
      });
      await lockPlayer(db, params.playerId);
      // Read again under the lock: an archive or edit in between is seen.
      const target = await readPlayer(db, clubId, params.playerId);

      // The replay comes first: a retry returns the original row even if the category
      // was archived since.
      if (body.clientUuid !== undefined) {
        const [replay] = await db
          .select(membershipColumns)
          .from(playerCategory)
          .where(
            and(eq(playerCategory.clubId, clubId), eq(playerCategory.clientUuid, body.clientUuid)),
          );
        if (replay !== undefined) {
          if (replay.playerId !== params.playerId) {
            throw new HttpError('conflict', 'This clientUuid was already used');
          }
          await permissions.authorize('category', 'manage', {
            category: { id: replay.categoryId, sport: target.sport },
          });
          markReplay(reply);
          return membershipDto(replay);
        }
      }
      if (target.archivedAt !== null) {
        throw new HttpError('conflict', 'The player left the club: restore them first');
      }
      const destination = await categoryForPlayer(db, clubId, body.categoryId, target, [
        'body',
        'categoryId',
      ]);
      // Who is in a category is part of managing the category (the administration).
      await permissions.authorize('category', 'manage', { category: destination });
      if (compareLocalDates(body.validFrom, target.joinedOn) < 0) {
        throw invalid(
          ['body', 'validFrom'],
          'The membership cannot start before the player joined',
        );
      }
      if (
        await overlapsSameCategory(
          db,
          clubId,
          params.playerId,
          body.categoryId,
          body.validFrom,
          null,
        )
      ) {
        throw new HttpError('conflict', 'The player is already in that category on those days');
      }
      const memberships = and(
        eq(playerCategory.clubId, clubId),
        eq(playerCategory.playerId, params.playerId),
      );
      if (!body.keepCurrent) {
        // A move: the memberships open on `validFrom` close that day. One that starts that
        // same day or later would be left empty or overlapping: correct it instead.
        const [blocking] = await db
          .select({ id: playerCategory.id })
          .from(playerCategory)
          .where(
            and(
              memberships,
              sql`${playerCategory.validFrom} >= ${body.validFrom}`,
              sql`(${playerCategory.validTo} is null or ${playerCategory.validTo} > ${body.validFrom})`,
            ),
          )
          .limit(1);
        if (blocking !== undefined) {
          throw new HttpError(
            'conflict',
            'Another membership starts on or after that day: correct it instead',
          );
        }
        await db
          .update(playerCategory)
          .set({ validTo: body.validFrom, updatedBy: caller.userId })
          .where(
            and(
              memberships,
              sql`${playerCategory.validFrom} < ${body.validFrom}`,
              sql`(${playerCategory.validTo} is null or ${playerCategory.validTo} > ${body.validFrom})`,
            ),
          );
      }
      const [created] = await db
        .insert(playerCategory)
        .values({
          clubId,
          ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
          playerId: params.playerId,
          categoryId: body.categoryId,
          validFrom: body.validFrom,
          createdBy: caller.userId,
          updatedBy: caller.userId,
        })
        .returning(membershipColumns);
      if (created === undefined) throw new Error('addPlayerCategory: the row is not visible');
      return membershipDto(created);
    },
  });

  registerEndpoint(app, updatePlayerCategory, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { row: authorized } = await authorizedPlayer(db, permissions, clubId, params.playerId, {
        kind: 'player_profile',
        action: 'update',
      });
      const where = and(
        eq(playerCategory.clubId, clubId),
        eq(playerCategory.playerId, params.playerId),
        eq(playerCategory.id, params.membershipId),
      );
      const [current] = await db.select(membershipColumns).from(playerCategory).where(where);
      if (current === undefined) throw new HttpError('not_found', 'Membership not found');
      await permissions.authorize('category', 'manage', {
        category: { id: current.categoryId, sport: authorized.sport },
      });
      await lockPlayer(db, params.playerId);
      // Read under the lock. The archive closed the categories and the restore does not
      // reopen them (ADR 0035): no membership of a player who left changes.
      const target = await readPlayer(db, clubId, params.playerId);
      if (target.archivedAt !== null) {
        throw new HttpError('conflict', 'The player left the club: restore them first');
      }

      const validFrom = body.validFrom ?? current.validFrom;
      const validTo = body.validTo === undefined ? current.validTo : body.validTo;
      if (validTo !== null && compareLocalDates(validTo, validFrom) <= 0) {
        throw invalid(['body', 'validTo'], 'The membership must end after it starts');
      }
      if (compareLocalDates(validFrom, target.joinedOn) < 0) {
        throw invalid(
          ['body', 'validFrom'],
          'The membership cannot start before the player joined',
        );
      }
      if (
        await overlapsSameCategory(
          db,
          clubId,
          params.playerId,
          current.categoryId,
          validFrom,
          validTo,
          current.id,
        )
      ) {
        throw new HttpError('conflict', 'The player is already in that category on those days');
      }
      const row = await updateAtVersion({
        resource: 'Membership',
        update: async () =>
          (
            await db
              .update(playerCategory)
              .set({ validFrom, validTo, updatedBy: caller.userId })
              .where(and(where, versionMatches(playerCategory.updatedAt, body.version)))
              .returning(membershipColumns)
          )[0],
        exists: async () =>
          (await db.select({ id: playerCategory.id }).from(playerCategory).where(where)).length > 0,
      });
      return membershipDto(row);
    },
  });

  registerEndpoint(app, getPlayerParentHeights, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      await authorizedPlayer(db, permissions, clubId, params.playerId, {
        kind: 'parent_height',
        action: 'read',
      });
      const rows = await db
        .select(parentHeightColumns)
        .from(playerParentHeight)
        .where(
          and(
            eq(playerParentHeight.clubId, clubId),
            eq(playerParentHeight.playerId, params.playerId),
          ),
        );
      const of = (parent: Parent) => {
        const row = rows.find((r) => r.parent === parent);
        return row === undefined ? null : parentHeightDto(row);
      };
      return { mother: of('mother'), father: of('father') };
    },
  });

  registerEndpoint(app, setPlayerParentHeight, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId, role } = caller.membership;
      await authorizedPlayer(db, permissions, clubId, params.playerId, {
        kind: 'parent_height',
        action: 'report',
      });
      if (role === 'parent' && body.source !== 'reported') {
        // A guardian informs; measuring is the staff's (also refused by the RLS).
        throw new HttpError('forbidden', 'A guardian only reports heights');
      }
      await lockPlayer(db, params.playerId);
      const where = and(
        eq(playerParentHeight.clubId, clubId),
        eq(playerParentHeight.playerId, params.playerId),
        eq(playerParentHeight.parent, params.parent),
      );
      const [existing] = await db.select(parentHeightColumns).from(playerParentHeight).where(where);
      if (existing === undefined) {
        if (body.version !== undefined) {
          throw new HttpError('conflict', 'The height changed since it was read: read it again');
        }
        const [created] = await db
          .insert(playerParentHeight)
          .values({
            clubId,
            playerId: params.playerId,
            parent: params.parent,
            heightCm: body.heightCm,
            source: body.source,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          })
          .returning(parentHeightColumns);
        if (created === undefined) throw new Error('setPlayerParentHeight: row not visible');
        return parentHeightDto(created);
      }
      if (role === 'parent' && existing.source === 'measured') {
        throw new HttpError('conflict', 'A measured height is not replaced by a report');
      }
      if (body.version === undefined) {
        throw new HttpError('conflict', 'A height is already recorded: send its version');
      }
      const version = body.version;
      const row = await updateAtVersion({
        resource: 'Height',
        update: async () =>
          (
            await db
              .update(playerParentHeight)
              .set({ heightCm: body.heightCm, source: body.source, updatedBy: caller.userId })
              .where(and(where, versionMatches(playerParentHeight.updatedAt, version)))
              .returning(parentHeightColumns)
          )[0],
        exists: async () =>
          (await db.select({ id: playerParentHeight.id }).from(playerParentHeight).where(where))
            .length > 0,
      });
      return parentHeightDto(row);
    },
  });
}
