import {
  confirmGuardianAsAdult,
  createPlayerGuardian,
  endGuardian,
  invitePlayer,
  issuePlayerAccessCode,
  listMyChildren,
  listPlayerAccessCodes,
  listPlayerGuardians,
  PLAYER_ACCESS_CODE_EXPIRES_IN_S,
  redeemPlayerAccess,
  revokePlayerAccessCode,
  updateGuardian,
  withdrawGuardianAdultConfirmation,
  type Child,
  type GuardianLink,
  type GuardianLinkStatus,
  type PlayerAccessCodeSummary,
} from '@sport-performance/contracts';
import {
  category,
  guardian,
  invitation,
  membership,
  player,
  playerAccessCode,
  playerCategory,
  user,
} from '@sport-performance/db/schema';
import {
  SPORTS,
  can,
  compareLocalDates,
  isCurrentOn,
  isOfAge,
  parseLocalDate,
  parseUserId,
  type ClubId,
  type GuardianRelationship,
  type LocalDate,
  type PlayerFacts,
  type PlayerId,
  type Sport,
  type UserId,
} from '@sport-performance/domain';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { openSessionForUser } from '../auth/better-auth.js';
import { describeSessionClient } from '../auth/device.js';
import type { AuthModule } from '../auth/module.js';
import { enforceRateLimits } from '../auth/rate-limit.js';
import type { TenantDatabase } from '../db/database.js';
import {
  accessCodeStatus,
  formatAccessCode,
  generateAccessCode,
  normalizeAccessCode,
  playerAccessLinks,
} from '../guardians/access-codes.js';
import { registerEndpoint, type ClubAuthContext } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import { insertIdempotent, rowVersion, updateAtVersion, versionMatches } from '../http/writes.js';
import { generateInvitationToken, hashInvitationToken } from '../invitations/tokens.js';
import { issueInvitation } from './invitations.js';
import { createdSessionExpiry, noticeNewDevice } from './auth.js';

/**
 * Guardians and accounts of minors (B-310, ADR 0042): guardian links, a
 * guardian's children, and how a guardian gives their child access (an
 * invitation by email, or a single-use code and link for a device without
 * email). Every handler authorizes with the permission matrix (ADR 0032) on
 * the player's facts; RLS stays as the second barrier.
 */

// ─── Players and their facts ─────────────────────────────────────────────

interface PlayerRow {
  id: PlayerId;
  firstName: string;
  lastName: string;
  birthDate: LocalDate;
  userId: string | null;
  leftOn: LocalDate | null;
}

/** "Today" in the club's time zone, from the database's clock. */
async function clubToday(db: TenantDatabase): Promise<LocalDate> {
  const { rows } = await db.execute<{ today: string | null }>(
    sql`select app.club_today()::text as today`,
  );
  const today = rows[0]?.today ?? null;
  if (today === null) throw new HttpError('forbidden', 'The club of the request is not visible');
  return parseLocalDate(today);
}

/** The player as RLS shows it to the caller: another club, or out of reach, is `404`. */
async function readPlayer(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
): Promise<PlayerRow> {
  const [row] = await db
    .select({
      id: player.id,
      firstName: player.firstName,
      lastName: player.lastName,
      birthDate: player.birthDate,
      userId: player.userId,
      leftOn: player.leftOn,
    })
    .from(player)
    .where(and(eq(player.clubId, clubId), eq(player.id, playerId)));
  if (row === undefined) throw new HttpError('not_found', 'Player not found');
  return row;
}

/** Facts of the matrix plus the names of the current categories (what `GET /v1/me/children` shows). */
interface PlayerFactsWithCategories extends PlayerFacts {
  readonly categories: Child['categories'];
}

/**
 * Facts of the matrix (ADR 0025) for some players on the club's day: their
 * current categories, a sport and whether they are of age. Consents are not
 * loaded: no rule of this module needs them (a rule that did would deny with
 * `missing_fact`, never allow). The sport is the one of the current category
 * or, without one, of the latest; it only matters to `assigned` cells, which
 * the kinds of this module do not have (a test pins it).
 */
async function playerFacts(
  db: TenantDatabase,
  clubId: ClubId,
  players: readonly Pick<PlayerRow, 'id' | 'birthDate'>[],
  today: LocalDate,
): Promise<Map<PlayerId, PlayerFactsWithCategories>> {
  const facts = new Map<PlayerId, PlayerFactsWithCategories>();
  if (players.length === 0) return facts;
  const rows = await db
    .select({
      playerId: playerCategory.playerId,
      categoryId: playerCategory.categoryId,
      categoryName: category.name,
      sport: category.sport,
      validFrom: playerCategory.validFrom,
      validTo: playerCategory.validTo,
    })
    .from(playerCategory)
    .innerJoin(
      category,
      and(eq(category.clubId, playerCategory.clubId), eq(category.id, playerCategory.categoryId)),
    )
    .where(
      and(
        eq(playerCategory.clubId, clubId),
        inArray(
          playerCategory.playerId,
          players.map((p) => p.id),
        ),
      ),
    )
    .orderBy(desc(playerCategory.validFrom));
  for (const row of players) {
    const history = rows.filter((r) => r.playerId === row.id);
    const current = history.filter((r) => isCurrentOn(r, today));
    // TODO(#46): a player who never had a category falls back to the first sport; revisit
    // with the roster (B-315), which may give every player a sport of their own.
    const sport: Sport = current[0]?.sport ?? history[0]?.sport ?? SPORTS[0];
    facts.set(row.id, {
      id: row.id,
      sport,
      categoryIds: current.map((r) => r.categoryId),
      ofAge: isOfAge(row.birthDate, today),
      categories: current.map((r) => ({ id: r.categoryId, name: r.categoryName, sport: r.sport })),
    });
  }
  return facts;
}

/** Reads a player and authorizes `kind.action` on it; returns the row and the club's day. */
async function authorizedPlayer(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  playerId: PlayerId,
  check:
    { kind: 'guardian_link'; action: 'read' | 'manage' | 'review' } | { kind: 'player_account' },
): Promise<{ row: PlayerRow; today: LocalDate }> {
  const row = await readPlayer(db, clubId, playerId);
  const today = await clubToday(db);
  const facts = (await playerFacts(db, clubId, [row], today)).get(row.id);
  if (facts === undefined) throw new Error('playerFacts: no facts for the player');
  if (check.kind === 'guardian_link') {
    await permissions.authorize('guardian_link', check.action, { player: facts });
  } else {
    await permissions.authorize('player_account', 'invite', { player: facts });
  }
  return { row, today };
}

/** Whether the caller sees the whole club (emails of guardians are for the administration). */
async function seesWholeClub(permissions: RequestPermissions): Promise<boolean> {
  const { role } = await permissions.subject();
  return role === 'admin' || role === 'superadmin';
}

// ─── Guardian links ──────────────────────────────────────────────────────

interface GuardianRow {
  id: string;
  playerId: PlayerId;
  userId: string;
  name: string | null;
  email: string | null;
  relationship: GuardianRelationship;
  validFrom: LocalDate;
  validTo: LocalDate | null;
  adultConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

const guardianColumns = {
  id: guardian.id,
  playerId: guardian.playerId,
  userId: guardian.userId,
  name: user.name,
  email: user.email,
  relationship: guardian.relationship,
  validFrom: guardian.validFrom,
  validTo: guardian.validTo,
  adultConfirmedAt: guardian.adultConfirmedAt,
  createdAt: guardian.createdAt,
  updatedAt: guardian.updatedAt,
  version: rowVersion(guardian.updatedAt),
};

const GUARDIAN_KEYS: KeysetSpec<GuardianRow, 'validFrom' | 'createdAt'> = {
  fields: {
    // `YYYY-MM-DD` sorts as text in calendar order.
    validFrom: {
      column: sql`${guardian.validFrom}::text`,
      type: 'text',
      value: (r) => r.validFrom,
    },
    createdAt: { column: guardian.createdAt, type: 'timestamp', value: (r) => r.createdAt },
  },
  id: { column: guardian.id, value: (r) => r.id },
};

function guardianDto(row: GuardianRow, today: LocalDate, withEmail: boolean): GuardianLink {
  return {
    id: row.id as GuardianLink['id'],
    playerId: row.playerId,
    guardian: {
      userId: parseUserId(row.userId),
      name: row.name,
      email: withEmail ? row.email : null,
    },
    relationship: row.relationship,
    validFrom: row.validFrom,
    validTo: row.validTo,
    current: isCurrentOn(row, today),
    adultConfirmedAt: row.adultConfirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function linkStatusFilter(status: GuardianLinkStatus, today: LocalDate): SQL | undefined {
  switch (status) {
    case 'current':
      return and(
        lte(guardian.validFrom, today),
        or(isNull(guardian.validTo), gt(guardian.validTo, today)),
      );
    case 'ended':
      return lte(guardian.validTo, today);
    case 'all':
      return undefined;
  }
}

/** The users RLS shows the caller (themselves; the club's members to the staff). */
const guardianUserJoin = eq(user.id, guardian.userId);

async function readGuardian(
  db: TenantDatabase,
  clubId: ClubId,
  guardianId: string,
): Promise<GuardianRow> {
  const [row] = await db
    .select(guardianColumns)
    .from(guardian)
    .leftJoin(user, guardianUserJoin)
    .where(and(eq(guardian.clubId, clubId), eq(guardian.id, guardianId)));
  if (row === undefined) throw new HttpError('not_found', 'Guardian link not found');
  return row;
}

// ─── Access codes ────────────────────────────────────────────────────────

interface AccessCodeRow {
  id: string;
  playerId: PlayerId;
  createdBy: string | null;
  issuerName: string | null;
  expiresAt: Date;
  createdAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
}

const accessCodeColumns = {
  id: playerAccessCode.id,
  playerId: playerAccessCode.playerId,
  createdBy: playerAccessCode.createdBy,
  issuerName: user.name,
  expiresAt: playerAccessCode.expiresAt,
  createdAt: playerAccessCode.createdAt,
  consumedAt: playerAccessCode.consumedAt,
  revokedAt: playerAccessCode.revokedAt,
};

const ACCESS_CODE_KEYS: KeysetSpec<AccessCodeRow, 'createdAt'> = {
  fields: {
    createdAt: { column: playerAccessCode.createdAt, type: 'timestamp', value: (r) => r.createdAt },
  },
  id: { column: playerAccessCode.id, value: (r) => r.id },
};

function accessCodeDto(row: AccessCodeRow, now: Date): PlayerAccessCodeSummary {
  return {
    id: row.id as PlayerAccessCodeSummary['id'],
    playerId: row.playerId,
    status: accessCodeStatus(row, now),
    issuedBy: {
      userId: row.createdBy === null ? null : parseUserId(row.createdBy),
      name: row.issuerName,
    },
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    usedAt: row.consumedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/** Attempts to draw a code that no row has used (8 characters: a clash is ~1 in 10^11). */
const CODE_ATTEMPTS = 5;

// ─── Children ────────────────────────────────────────────────────────────

interface ChildRow extends Record<string, unknown> {
  guardianId: string;
  relationship: GuardianRelationship;
  playerId: PlayerId;
  firstName: string;
  lastName: string;
  birthDate: LocalDate;
  hasAccount: boolean;
  adultConfirmed: boolean;
  sortName: string;
}

/**
 * Rows of `app.guardian_children()` (alias `w`): the caller's current links
 * with the little a guardian may know of each child whatever their age. RLS
 * hides an adult who did not keep the link from the guardian (B-311), so a
 * plain join with `player` would drop them from the list.
 */
const childSortName = sql<string>`w.last_name || ' ' || w.first_name`;

const CHILD_KEYS: KeysetSpec<ChildRow, 'name'> = {
  fields: { name: { column: childSortName, type: 'text', value: (r) => r.sortName } },
  id: { column: sql`w.guardian_id`, value: (r) => r.guardianId },
};

/** The caller's own guardianships: a `parent` of the club, nobody else. */
function requireGuardianRole(caller: ClubAuthContext): void {
  if (caller.membership.role !== 'parent') {
    throw new HttpError('forbidden', 'Only a guardian (role parent) has children in the club');
  }
}

export function registerGuardianRoutes(app: FastifyInstance, auth: AuthModule): void {
  registerEndpoint(app, listPlayerGuardians, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { today } = await authorizedPlayer(db, permissions, clubId, params.playerId, {
        kind: 'guardian_link',
        action: 'read',
      });
      const plan = keysetPage(GUARDIAN_KEYS, query, { status: query.status });
      const rows = await db
        .select(guardianColumns)
        .from(guardian)
        .leftJoin(user, guardianUserJoin)
        .where(
          and(
            eq(guardian.clubId, clubId),
            eq(guardian.playerId, params.playerId),
            linkStatusFilter(query.status, today),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      const withEmail = await seesWholeClub(permissions);
      return plan.page(rows, (row) => guardianDto(row, today, withEmail));
    },
  });

  registerEndpoint(app, createPlayerGuardian, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const { today } = await authorizedPlayer(db, permissions, clubId, params.playerId, {
        kind: 'guardian_link',
        action: 'manage',
      });
      const [parent] = await db
        .select({ userId: membership.userId })
        .from(membership)
        .where(
          and(
            eq(membership.clubId, clubId),
            eq(membership.id, body.membershipId),
            eq(membership.role, 'parent'),
            lte(membership.startedAt, sql`now()`),
            or(isNull(membership.endedAt), gt(membership.endedAt, sql`now()`)),
          ),
        );
      if (parent === undefined) {
        throw new HttpError('validation_failed', 'The request does not match the contract', {
          details: [
            {
              path: ['body', 'membershipId'],
              code: 'custom',
              message: 'Not an active parent membership of this club',
            },
          ],
        });
      }
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () => {
          const [inserted] = await db
            .insert(guardian)
            .values({
              clubId,
              ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
              playerId: params.playerId,
              userId: parent.userId,
              relationship: body.relationship,
              validFrom: body.validFrom ?? today,
              createdBy: caller.userId,
              updatedBy: caller.userId,
            })
            .onConflictDoNothing({ target: [guardian.clubId, guardian.clientUuid] })
            .returning({ id: guardian.id });
          return inserted === undefined ? undefined : readGuardian(db, clubId, inserted.id);
        },
        findByClientUuid: async (clientUuid) => {
          const [found] = await db
            .select({ id: guardian.id })
            .from(guardian)
            .where(and(eq(guardian.clubId, clubId), eq(guardian.clientUuid, clientUuid)));
          return found === undefined ? undefined : readGuardian(db, clubId, found.id);
        },
      });
      return guardianDto(row, today, true);
    },
  });

  /** Reads a link and authorizes managing it, on its player. */
  async function managedLink(
    db: TenantDatabase,
    permissions: RequestPermissions,
    clubId: ClubId,
    guardianId: string,
  ) {
    const link = await readGuardian(db, clubId, guardianId);
    const { today } = await authorizedPlayer(db, permissions, clubId, link.playerId, {
      kind: 'guardian_link',
      action: 'manage',
    });
    return { link, today };
  }

  registerEndpoint(app, updateGuardian, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { today } = await managedLink(db, permissions, clubId, params.guardianId);
      const where = and(eq(guardian.clubId, clubId), eq(guardian.id, params.guardianId));
      await updateAtVersion({
        resource: 'Guardian link',
        update: async () =>
          (
            await db
              .update(guardian)
              .set({ relationship: body.relationship, updatedBy: caller.userId })
              .where(and(where, versionMatches(guardian.updatedAt, body.version)))
              .returning({ id: guardian.id })
          )[0],
        exists: async () =>
          (await db.select({ id: guardian.id }).from(guardian).where(where)).length > 0,
      });
      return guardianDto(await readGuardian(db, clubId, params.guardianId), today, true);
    },
  });

  /**
   * The adult player's decision on one of their guardians (B-311, ADR 0048):
   * the matrix (`guardian_link.review`), then `app.review_guardian`, which
   * checks it all again and is the only writer of the confirmation.
   */
  async function reviewLink(
    db: TenantDatabase,
    permissions: RequestPermissions,
    clubId: ClubId,
    guardianId: string,
    decision: 'confirm' | 'withdraw' | 'end',
  ): Promise<GuardianLink> {
    const link = await readGuardian(db, clubId, guardianId);
    const { today } = await authorizedPlayer(db, permissions, clubId, link.playerId, {
      kind: 'guardian_link',
      action: 'review',
    });
    const { rows } = await db.execute<{ outcome: string }>(
      sql`select app.review_guardian(${guardianId}::uuid, ${decision}) as outcome`,
    );
    const outcome = rows[0]?.outcome;
    switch (outcome) {
      case 'ok':
        break;
      case 'ended':
        throw new HttpError('conflict', 'The guardian link already ended');
      case 'not_found':
        throw new HttpError('not_found', 'Guardian link not found');
      case 'minor':
        // The matrix let a minor through: the database refuses (fail closed).
        throw new HttpError('forbidden', 'Only the player, once of age, decides');
      default:
        throw new Error(`review_guardian: unexpected outcome ${String(outcome)}`);
    }
    return guardianDto(await readGuardian(db, clubId, guardianId), today, false);
  }

  registerEndpoint(app, confirmGuardianAsAdult, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) =>
      reviewLink(db, permissions, caller.membership.clubId, params.guardianId, 'confirm'),
  });

  registerEndpoint(app, withdrawGuardianAdultConfirmation, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) =>
      reviewLink(db, permissions, caller.membership.clubId, params.guardianId, 'withdraw'),
  });

  registerEndpoint(app, endGuardian, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      // The adult player ends their own guardian's link (B-311); everyone else needs `manage`.
      if (caller.membership.role === 'player') {
        return reviewLink(db, permissions, clubId, params.guardianId, 'end');
      }
      const { link, today } = await managedLink(db, permissions, clubId, params.guardianId);
      if (link.validTo !== null && compareLocalDates(link.validTo, today) <= 0) {
        return guardianDto(link, today, true);
      }
      // From today; a link that starts today or later ends as an empty range: never counted.
      const validTo = compareLocalDates(link.validFrom, today) > 0 ? link.validFrom : today;
      await db
        .update(guardian)
        .set({ validTo, updatedBy: caller.userId })
        .where(and(eq(guardian.clubId, clubId), eq(guardian.id, params.guardianId)));
      // What the former guardian left open for the child stops working too: their access
      // codes (redeeming checks the issuer again anyway) and their player invitations.
      const now = auth.now();
      await db
        .update(playerAccessCode)
        .set({ revokedAt: now, revokedBy: caller.userId, updatedBy: caller.userId })
        .where(
          and(
            eq(playerAccessCode.clubId, clubId),
            eq(playerAccessCode.playerId, link.playerId),
            eq(playerAccessCode.createdBy, link.userId),
            isNull(playerAccessCode.consumedAt),
            isNull(playerAccessCode.revokedAt),
          ),
        );
      await db
        .update(invitation)
        .set({ revokedAt: now, revokedBy: caller.userId, updatedBy: caller.userId })
        .where(
          and(
            eq(invitation.clubId, clubId),
            eq(invitation.playerId, link.playerId),
            eq(invitation.createdBy, link.userId),
            eq(invitation.role, 'player'),
            isNull(invitation.acceptedAt),
            isNull(invitation.revokedAt),
          ),
        );
      return guardianDto(await readGuardian(db, clubId, params.guardianId), today, true);
    },
  });

  registerEndpoint(app, listMyChildren, {
    transaction: true,
    usage: 'guardian_home',
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      requireGuardianRole(caller);
      const { clubId } = caller.membership;
      const scope = await permissions.listScope('player_summary', 'read');
      const plan = keysetPage(CHILD_KEYS, query, {});
      if (scope.kind !== 'players' || scope.playerIds.length === 0) {
        return { items: [], nextCursor: null };
      }
      const today = await clubToday(db);
      const { rows } = await db.execute<ChildRow>(sql`
        select w.guardian_id as "guardianId", w.relationship, w.player_id as "playerId",
               w.first_name as "firstName", w.last_name as "lastName",
               w.birth_date::text as "birthDate", w.has_account as "hasAccount",
               w.adult_confirmed as "adultConfirmed", ${childSortName} as "sortName"
          from app.guardian_children() w
         where ${plan.where ?? sql`true`}
         order by ${sql.join(plan.orderBy, sql`, `)}
         limit ${plan.limit}`);
      const subject = await permissions.subject();
      const facts = await playerFacts(
        db,
        clubId,
        rows.map((r) => ({ id: r.playerId, birthDate: r.birthDate })),
        today,
      );
      return plan.page(rows, (row): Child => {
        const playerFactsOfRow = facts.get(row.playerId);
        const ofAge = isOfAge(row.birthDate, today);
        // An adult who did not keep the guardian's access shows only the link (B-311).
        const visible = !ofAge || row.adultConfirmed;
        return {
          playerId: row.playerId,
          firstName: row.firstName,
          lastName: row.lastName,
          birthDate: row.birthDate,
          ofAge,
          guardianId: row.guardianId as Child['guardianId'],
          relationship: row.relationship,
          hasAccount: row.hasAccount,
          adultConfirmed: row.adultConfirmed,
          categories: visible ? (playerFactsOfRow?.categories ?? []) : [],
          canManageAccess:
            playerFactsOfRow !== undefined &&
            can(subject, 'invite', { kind: 'player_account', clubId, player: playerFactsOfRow }),
        };
      });
    },
  });

  registerEndpoint(app, invitePlayer, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { row } = await authorizedPlayer(db, permissions, clubId, params.playerId, {
        kind: 'player_account',
      });
      await enforceRateLimits(auth.rateLimiter, [
        [auth.limits.playerAccessIssueByUser, caller.userId],
      ]);
      if (row.userId !== null) throw new HttpError('conflict', 'The player already has an account');
      return issueInvitation(db, auth, caller, {
        email: body.email,
        role: 'player',
        categoryIds: [],
        playerId: row.id,
        relationship: null,
        expiresInDays: body.expiresInDays,
      });
    },
  });

  registerEndpoint(app, issuePlayerAccessCode, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller, reply, log }) => {
      const { clubId } = caller.membership;
      const { row, today } = await authorizedPlayer(db, permissions, clubId, params.playerId, {
        kind: 'player_account',
      });
      await enforceRateLimits(auth.rateLimiter, [
        [auth.limits.playerAccessIssueByUser, caller.userId],
      ]);
      if (row.leftOn !== null && compareLocalDates(row.leftOn, today) <= 0) {
        throw new HttpError('conflict', 'The player left the club');
      }
      // A code only ever opens the player's account without email (ADR 0042): a session is
      // the user's in every club, so an account with an email signs in with that email.
      const { rows: takes } = await db.execute<{ takes: boolean | null }>(
        sql`select app.player_takes_access_codes(${row.id}) as takes`,
      );
      if (takes[0]?.takes !== true) {
        throw new HttpError(
          'conflict',
          'The player has an account with email: they sign in with it',
        );
      }
      // One open code per player: two guardians issuing at once run one after the other,
      // and the second revokes the first's code.
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`player_access:${clubId}:${row.id}`}, 0))`,
      );
      const now = auth.now();
      await db
        .update(playerAccessCode)
        .set({ revokedAt: now, revokedBy: caller.userId, updatedBy: caller.userId })
        .where(
          and(
            eq(playerAccessCode.clubId, clubId),
            eq(playerAccessCode.playerId, row.id),
            isNull(playerAccessCode.consumedAt),
            isNull(playerAccessCode.revokedAt),
          ),
        );
      const token = generateInvitationToken();
      for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
        const code = generateAccessCode();
        const [inserted] = await db
          .insert(playerAccessCode)
          .values({
            clubId,
            playerId: row.id,
            codeHash: auth.hashAccessCode(code),
            tokenHash: hashInvitationToken(token),
            // The database's clock, like `created_at` (the expiry cap is checked against it).
            expiresAt: sql`now() + make_interval(secs => ${PLAYER_ACCESS_CODE_EXPIRES_IN_S})`,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          })
          .onConflictDoNothing({ target: playerAccessCode.codeHash })
          .returning({ id: playerAccessCode.id });
        if (inserted === undefined) continue;
        const [issued] = await db
          .select(accessCodeColumns)
          .from(playerAccessCode)
          .leftJoin(user, eq(user.id, playerAccessCode.createdBy))
          .where(and(eq(playerAccessCode.clubId, clubId), eq(playerAccessCode.id, inserted.id)));
        if (issued === undefined) throw new Error('issuePlayerAccessCode: the code is not visible');
        // Never cached: it carries a credential.
        void reply.header('cache-control', 'no-store');
        log.info(
          { clubId, playerId: row.id, accessCodeId: inserted.id },
          'player access code issued',
        );
        return {
          accessCode: accessCodeDto(issued, now),
          code: formatAccessCode(code),
          links: playerAccessLinks(token, auth.links),
        };
      }
      throw new Error('issuePlayerAccessCode: no free code after several attempts');
    },
  });

  registerEndpoint(app, listPlayerAccessCodes, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      await authorizedPlayer(db, permissions, clubId, params.playerId, { kind: 'player_account' });
      const plan = keysetPage(ACCESS_CODE_KEYS, query, {});
      const rows = await db
        .select(accessCodeColumns)
        .from(playerAccessCode)
        .leftJoin(user, eq(user.id, playerAccessCode.createdBy))
        .where(
          and(
            eq(playerAccessCode.clubId, clubId),
            eq(playerAccessCode.playerId, params.playerId),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      const now = auth.now();
      return plan.page(rows, (row) => accessCodeDto(row, now));
    },
  });

  registerEndpoint(app, revokePlayerAccessCode, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      await authorizedPlayer(db, permissions, clubId, params.playerId, { kind: 'player_account' });
      const where = and(
        eq(playerAccessCode.clubId, clubId),
        eq(playerAccessCode.playerId, params.playerId),
        eq(playerAccessCode.id, params.accessCodeId),
      );
      const [row] = await db
        .select({ consumedAt: playerAccessCode.consumedAt, revokedAt: playerAccessCode.revokedAt })
        .from(playerAccessCode)
        .where(where)
        .for('update');
      if (row === undefined) throw new HttpError('not_found', 'Access code not found');
      if (row.consumedAt !== null) {
        throw new HttpError('conflict', 'The access code was already used');
      }
      // Revoking twice is a no-op: DELETE is idempotent.
      if (row.revokedAt === null) {
        await db
          .update(playerAccessCode)
          .set({ revokedAt: auth.now(), revokedBy: caller.userId, updatedBy: caller.userId })
          .where(where);
      }
      return undefined;
    },
  });

  registerEndpoint(app, redeemPlayerAccess, {
    transaction: false,
    handler: async ({ body }, { request, reply }) => {
      // The code (~40 bits) is limited per IP and in total; the link (256 bits) per IP only,
      // so a flood of guessed codes never blocks a guardian's link.
      let hash: { codeHash: string } | { tokenHash: string };
      if ('code' in body) {
        // One after the other: a request the IP limit refuses does not spend the global
        // budget, so a single IP cannot block the codes of every club.
        await enforceRateLimits(auth.rateLimiter, [[auth.limits.playerAccessCodeByIp, request.ip]]);
        await enforceRateLimits(auth.rateLimiter, [[auth.limits.playerAccessCodeGlobal, 'all']]);
        hash = { codeHash: auth.hashAccessCode(normalizeAccessCode(body.code)) };
      } else {
        await enforceRateLimits(auth.rateLimiter, [[auth.limits.playerAccessLinkByIp, request.ip]]);
        hash = { tokenHash: hashInvitationToken(body.token) };
      }
      const result = await auth.identity.redeemPlayerAccess(hash);
      if (result.kind === 'not_found') throw new HttpError('not_found', 'Access code not found');
      if (result.kind === 'unavailable') {
        // Used, revoked, expired or no longer allowed: the same answer for all of them.
        request.log.info({ reason: result.reason }, 'player access code refused');
        throw new HttpError('conflict', 'The access code cannot be used: ask for a new one');
      }

      const client = describeSessionClient('bearer', request.headers['user-agent']);
      let token: string;
      try {
        token = await openSessionForUser(auth.betterAuth, { userId: result.userId, client });
      } catch (error) {
        // The redeem already committed: the code stays used. Support finds it by its id.
        request.log.error(
          {
            err: error,
            accessCodeId: result.accessCodeId,
            clubId: result.clubId,
            membershipId: result.membershipId,
          },
          'player access code used but the session did not open',
        );
        throw error;
      }
      const found = await auth.betterAuth.api.getSession({
        headers: new Headers({ authorization: `Bearer ${token}` }),
        query: { disableRefresh: true },
      });
      if (found === null) throw new Error('Better Auth did not find the session it just opened');
      const expiresAt = await createdSessionExpiry(auth.betterAuth, token);
      const userId: UserId = parseUserId(found.user.id);
      await noticeNewDevice(auth, request.log, {
        userId,
        email: found.user.email,
        deviceId: body.deviceId,
        client,
        userCreated: result.userCreated,
      });
      request.log.info(
        {
          accessCodeId: result.accessCodeId,
          clubId: result.clubId,
          membershipId: result.membershipId,
          userCreated: result.userCreated,
        },
        'player access code redeemed',
      );
      // No caching of a response that carries a session token.
      void reply.header('cache-control', 'no-store');
      return {
        user: {
          id: userId,
          email: found.user.email,
          name: found.user.name,
          isSuperadmin: (found.user as { isSuperadmin?: unknown }).isSuperadmin === true,
        },
        session: { expiresAt: expiresAt.toISOString(), token },
      };
    },
  });
}
