import { createHash } from 'node:crypto';
import {
  getRosterImport,
  importRoster,
  listRosterImports,
  previewRosterImport,
  type RosterImport,
  type RosterImportPreview,
  type RosterImportRow,
  type ValidationIssue,
} from '@sport-performance/contracts';
import {
  category,
  clubBranch,
  guardian,
  invitation,
  membership,
  player,
  playerCategory,
  playerPosition,
  position,
  rosterImport,
  user,
} from '@sport-performance/db/schema';
import {
  RosterMatcher,
  compareLocalDates,
  normalizeHeader,
  rosterPersonKey,
  type CategoryId,
  type ClubId,
  type GuardianRelationship,
  type LocalDate,
  type PlayerId,
  type RosterGuardianOutcome,
  type RosterImportAction,
  type RosterImportRowOutcome,
  type RosterMatchReason,
  type Sex,
  type Sport,
} from '@sport-performance/domain';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import { clubToday, type RequestPermissions } from '../http/permissions.js';
import { markReplay, rowVersion } from '../http/writes.js';

/**
 * Roster import (padrón, B-330, ADR 0047): a preview that writes nothing and
 * an all-or-nothing import, over rows the client already read from a CSV or
 * Excel file. Only the administration runs it (`data_import.run`, which
 * without a category nobody else passes, and `player_profile.create`).
 * Guardians with an active `parent` membership are linked; the others are
 * returned as invitations to send (`POST /v1/invitations`): the import
 * sends no email.
 */

/** "Today" in the club's time zone, as SQL. */
const CLUB_TODAY = sql`(select app.club_today())`;

interface Body {
  sport?: Sport | undefined;
  rows: RosterImportRow[];
}

// ─── What the club has ─────────────────────────────────────────────────────────────────

interface ClubPlayer {
  id: PlayerId;
  userId: string | null;
  firstName: string;
  lastName: string;
  birthDate: LocalDate;
  sex: Sex;
  sport: Sport;
  archived: boolean;
  version: string;
  currentCategoryIds: CategoryId[];
  positionIds: string[];
}

interface ClubCategory {
  id: CategoryId;
  sport: Sport;
  sex: Sex;
  name: string;
  ageBandCode: string;
}

interface ClubPosition {
  id: string;
  sport: Sport;
  code: string;
  label: string | null;
}

interface ParentMember {
  userId: string;
  email: string;
}

/** Everything the rows are checked against, read once per request. */
interface ClubSnapshot {
  today: LocalDate;
  branches: Set<string>;
  categories: ClubCategory[];
  positions: ClubPosition[];
  players: Map<PlayerId, ClubPlayer>;
  matcher: RosterMatcher;
  /** Active `parent` members of the club by lowercase email. */
  parents: Map<string, ParentMember>;
  /** `playerId|userId` of the open guardian links. */
  openLinks: Set<string>;
  /** `playerId|email` of the pending `parent` invitations about a player. */
  pendingInvitations: Set<string>;
}

const branchKey = (sport: Sport, sex: Sex) => `${sport}|${sex}`;

async function loadSnapshot(db: TenantDatabase, clubId: ClubId, body: Body): Promise<ClubSnapshot> {
  const today = await clubToday(db);
  const sports = [...new Set(body.rows.map((row) => row.sport ?? body.sport))].filter(
    (sport): sport is Sport => sport !== undefined,
  );
  const emails = [
    ...new Set(body.rows.flatMap((row) => (row.guardians ?? []).map((g) => g.email.toLowerCase()))),
  ];

  const branches = await db
    .select({ sport: clubBranch.sport, sex: clubBranch.sex })
    .from(clubBranch)
    .where(and(eq(clubBranch.clubId, clubId), isNull(clubBranch.archivedAt)));
  const categories = await db
    .select({
      id: category.id,
      sport: category.sport,
      sex: category.sex,
      name: category.name,
      ageBandCode: category.ageBandCode,
    })
    .from(category)
    .where(
      and(
        eq(category.clubId, clubId),
        isNull(category.archivedAt),
        inArray(category.sport, sports),
      ),
    );
  const positions = await db
    .select({ id: position.id, sport: position.sport, code: position.code, label: position.label })
    .from(position)
    .where(and(eq(position.clubId, clubId), inArray(position.sport, sports)));

  const OUTER = sql.raw('"player"');
  const players = await db
    .select({
      id: player.id,
      userId: player.userId,
      firstName: player.firstName,
      lastName: player.lastName,
      birthDate: player.birthDate,
      sex: player.sex,
      sport: player.sport,
      archived: sql<boolean>`(${player.archivedAt} is not null)`,
      version: rowVersion(player.updatedAt),
      currentCategoryIds: sql<CategoryId[]>`coalesce((
        select array_agg(pc.category_id::text order by pc.valid_from, pc.category_id)
          from ${playerCategory} pc
         where pc.club_id = ${OUTER}.club_id and pc.player_id = ${OUTER}.id
           and pc.valid_from <= ${CLUB_TODAY}
           and (pc.valid_to is null or pc.valid_to > ${CLUB_TODAY})), '{}')::text[]`,
      positionIds: sql<string[]>`coalesce((
        select array_agg(pp.position_id::text order by pp.sort_order)
          from ${playerPosition} pp
         where pp.club_id = ${OUTER}.club_id and pp.player_id = ${OUTER}.id), '{}')::text[]`,
    })
    .from(player)
    .where(and(eq(player.clubId, clubId), inArray(player.sport, sports)));

  const parents = new Map<string, ParentMember>();
  const openLinks = new Set<string>();
  const pendingInvitations = new Set<string>();
  if (emails.length > 0) {
    const members = await db
      .select({ userId: membership.userId, email: sql<string>`lower(${user.email})` })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(
        and(
          eq(membership.clubId, clubId),
          eq(membership.role, 'parent'),
          sql`${membership.startedAt} <= now()`,
          or(isNull(membership.endedAt), gt(membership.endedAt, sql`now()`)),
          inArray(sql`lower(${user.email})`, emails),
        ),
      );
    for (const member of members) parents.set(member.email, member);
    const userIds = members.map((m) => m.userId);
    if (userIds.length > 0) {
      const links = await db
        .select({ playerId: guardian.playerId, userId: guardian.userId })
        .from(guardian)
        .where(
          and(
            eq(guardian.clubId, clubId),
            inArray(guardian.userId, userIds),
            // Open and in force: a link ending in the future still counts as linked.
            sql`${guardian.validFrom} <= ${CLUB_TODAY}`,
            or(isNull(guardian.validTo), sql`${guardian.validTo} > ${CLUB_TODAY}`),
          ),
        );
      for (const link of links) openLinks.add(`${link.playerId}|${link.userId}`);
    }
    const invitations = await db
      .select({ playerId: invitation.playerId, email: invitation.email })
      .from(invitation)
      .where(
        and(
          eq(invitation.clubId, clubId),
          eq(invitation.role, 'parent'),
          inArray(invitation.email, emails),
          isNull(invitation.acceptedAt),
          isNull(invitation.revokedAt),
          gt(invitation.expiresAt, sql`now()`),
        ),
      );
    for (const open of invitations) {
      if (open.playerId !== null) pendingInvitations.add(`${open.playerId}|${open.email}`);
    }
  }

  const byId = new Map(players.map((p) => [p.id, p]));
  return {
    today,
    branches: new Set(branches.map((b) => branchKey(b.sport, b.sex))),
    categories,
    positions,
    players: byId,
    matcher: new RosterMatcher(players),
    parents,
    openLinks,
    pendingInvitations,
  };
}

// ─── One row ───────────────────────────────────────────────────────────────────────────

interface RowMatch {
  playerId: PlayerId;
  kind: 'exact' | 'possible';
  reason: RosterMatchReason;
  player: ClubPlayer;
}

interface RowGuardian {
  email: string;
  relationship: GuardianRelationship;
  outcome: RosterGuardianOutcome;
  /** The parent to link (`linked`). */
  userId: string | null;
}

interface RowPlan {
  index: number;
  row: RosterImportRow;
  sport: Sport;
  issues: ValidationIssue[];
  matches: RowMatch[];
  duplicateOfIndex: number | null;
  resolutionRequired: boolean;
  /** `null` when the row has issues or needs a decision. */
  action: RosterImportAction | null;
  /** The created player is not known yet; the skipped or updated one is. */
  targetPlayer: ClubPlayer | null;
  categoryId: CategoryId | null;
  /** Add the category membership (a create with a category, or an update without one). */
  addCategory: boolean;
  positionIds: string[];
  guardians: RowGuardian[];
}

function issue(index: number, field: (string | number)[], message: string): ValidationIssue {
  return { path: ['body', 'rows', index, ...field], code: 'custom', message };
}

/** A category of the branch by name, or by age band code (`M15`) if only one has it. */
function resolveCategory(
  snapshot: ClubSnapshot,
  text: string,
  sport: Sport,
  sex: Sex,
): { id: CategoryId } | { message: string } {
  const wanted = normalizeHeader(text);
  const ofBranch = snapshot.categories.filter((c) => c.sport === sport && c.sex === sex);
  const byName = ofBranch.filter((c) => normalizeHeader(c.name) === wanted);
  if (byName.length === 1 && byName[0] !== undefined) return { id: byName[0].id };
  const byBand = ofBranch.filter((c) => normalizeHeader(c.ageBandCode) === wanted);
  if (byBand.length === 1 && byBand[0] !== undefined) return { id: byBand[0].id };
  if (byBand.length > 1) {
    return {
      message: `More than one category of the branch has that age band: use its name (${byBand.map((c) => c.name).join(', ')})`,
    };
  }
  const names = ofBranch.map((c) => c.name).join(', ');
  return {
    message:
      names === ''
        ? 'The branch of the player has no active category'
        : `Not an active category of the branch of the player (${names})`,
  };
}

/** A position of the sport by code, or by the club's label. */
function resolvePosition(snapshot: ClubSnapshot, text: string, sport: Sport): string | undefined {
  const wanted = normalizeHeader(text);
  const ofSport = snapshot.positions.filter((p) => p.sport === sport);
  const found =
    ofSport.find((p) => p.code === text) ??
    ofSport.find((p) => normalizeHeader(p.code) === wanted) ??
    ofSport.find((p) => p.label !== null && normalizeHeader(p.label) === wanted);
  return found?.id;
}

function planRow(
  snapshot: ClubSnapshot,
  row: RosterImportRow,
  index: number,
  batchSport: Sport | undefined,
  seen: Map<string, number>,
): RowPlan {
  const sport = row.sport ?? batchSport;
  // The contract requires a sport per row or for the batch.
  if (sport === undefined)
    throw new Error('roster import: a row without sport passed the contract');
  const issues: ValidationIssue[] = [];
  const plan: RowPlan = {
    index,
    row,
    sport,
    issues,
    matches: [],
    duplicateOfIndex: null,
    resolutionRequired: false,
    action: null,
    targetPlayer: null,
    categoryId: null,
    addCategory: false,
    positionIds: [],
    guardians: [],
  };

  if (compareLocalDates(row.birthDate, snapshot.today) > 0) {
    issues.push(issue(index, ['birthDate'], 'The date cannot be in the future'));
  }

  const person = { ...row, sport };
  const key = rosterPersonKey(person);
  const first = seen.get(key);
  if (first !== undefined) {
    plan.duplicateOfIndex = first;
    issues.push(issue(index, [], `The same person as row ${String(first)} of the import`));
  } else {
    seen.set(key, index);
  }

  plan.matches = snapshot.matcher.matches(person).flatMap((match) => {
    const found = snapshot.players.get(match.playerId);
    return found === undefined ? [] : [{ ...match, player: found }];
  });
  const exact = plan.matches.filter((m) => m.kind === 'exact');
  const resolution = row.resolution;

  // The decision: the staff's, or the default for what was found.
  let action: RosterImportAction | null = null;
  if (resolution === undefined) {
    if (exact[0] !== undefined) {
      action = 'skip';
      plan.targetPlayer = exact[0].player;
    } else if (plan.matches.length > 0) {
      plan.resolutionRequired = true;
      issues.push({
        ...issue(
          index,
          ['resolution'],
          'The row may be a player of the club: decide create, skip or update',
        ),
        code: 'resolution_required',
      });
    } else {
      action = 'create';
    }
  } else if (resolution.action === 'create') {
    if (exact.length > 0) {
      issues.push(
        issue(
          index,
          ['resolution'],
          exact[0]?.player.archived === true
            ? 'The player already exists and left the club: restore them instead'
            : 'The player already exists: skip or update it',
        ),
      );
    } else {
      action = 'create';
    }
  } else if (resolution.action === 'skip') {
    action = 'skip';
    plan.targetPlayer = exact[0]?.player ?? null;
  } else {
    const candidate = plan.matches.find((m) => m.playerId === resolution.playerId);
    if (candidate === undefined) {
      issues.push(issue(index, ['resolution', 'playerId'], 'Not a match of this row'));
    } else if (candidate.player.archived) {
      issues.push(
        issue(index, ['resolution', 'playerId'], 'The player left the club: restore them first'),
      );
    } else {
      action = 'update';
      plan.targetPlayer = candidate.player;
    }
  }

  // The branch the row is checked against: the row's for a new player, the player's otherwise.
  const target = plan.targetPlayer;
  const branchSex = action === 'update' && target !== null ? target.sex : row.sex;
  if (action === 'create') {
    if (!snapshot.branches.has(branchKey(sport, row.sex))) {
      issues.push(issue(index, ['sport'], 'The branch (sport and sex) is not enabled in the club'));
    }
    const joinedOn = row.joinedOn;
    if (joinedOn !== undefined) {
      if (compareLocalDates(joinedOn, snapshot.today) > 0) {
        issues.push(issue(index, ['joinedOn'], 'The date cannot be in the future'));
      } else if (compareLocalDates(joinedOn, row.birthDate) < 0) {
        issues.push(issue(index, ['joinedOn'], 'The player cannot join before being born'));
      }
    }
  }

  if (row.category !== undefined && action !== 'skip') {
    const resolved = resolveCategory(snapshot, row.category, sport, branchSex);
    if ('message' in resolved) {
      issues.push(issue(index, ['category'], resolved.message));
    } else {
      plan.categoryId = resolved.id;
      if (action === 'create') {
        plan.addCategory = true;
      } else if (action === 'update' && target !== null) {
        if (target.currentCategoryIds.length === 0) plan.addCategory = true;
        else if (!target.currentCategoryIds.includes(resolved.id)) {
          issues.push(
            issue(
              index,
              ['category'],
              'The player is in another category: a change of category is a transfer (pase), not an import',
            ),
          );
        }
      }
    }
  }

  if (row.positions !== undefined && action !== 'skip') {
    const ids: string[] = [];
    row.positions.forEach((text, at) => {
      const id = resolvePosition(snapshot, text, sport);
      if (id === undefined) {
        issues.push(issue(index, ['positions', at], 'Not a position of the sport'));
      } else if (ids.includes(id)) {
        issues.push(issue(index, ['positions', at], 'Repeated position'));
      } else {
        ids.push(id);
      }
    });
    plan.positionIds = ids;
  }

  const playerId = target?.id ?? null;
  plan.guardians = (row.guardians ?? []).map((g, at): RowGuardian => {
    const email = g.email.toLowerCase();
    const base = { email, relationship: g.relationship, userId: null };
    // Nobody to link: a skipped row without a match, or a player who left the club.
    if ((action === 'skip' && playerId === null) || target?.archived === true) {
      return { ...base, outcome: 'skipped' };
    }
    const parent = snapshot.parents.get(email);
    if (parent !== undefined) {
      if (target?.userId === parent.userId) {
        issues.push(issue(index, ['guardians', at, 'email'], 'A player is not their own guardian'));
        return { ...base, outcome: 'skipped' };
      }
      if (playerId !== null && snapshot.openLinks.has(`${playerId}|${parent.userId}`)) {
        return { ...base, outcome: 'already_linked' };
      }
      return { ...base, outcome: 'linked', userId: parent.userId };
    }
    if (playerId !== null && snapshot.pendingInvitations.has(`${playerId}|${email}`)) {
      return { ...base, outcome: 'invitation_pending' };
    }
    return { ...base, outcome: 'invite' };
  });

  plan.action = issues.length === 0 ? action : null;
  return plan;
}

function planRows(snapshot: ClubSnapshot, body: Body): RowPlan[] {
  const seen = new Map<string, number>();
  return body.rows.map((row, index) => planRow(snapshot, row, index, body.sport, seen));
}

async function authorizeImport(permissions: RequestPermissions): Promise<void> {
  await permissions.authorize('data_import', 'run');
  await permissions.authorize('player_profile', 'create');
}

// ─── Writing ───────────────────────────────────────────────────────────────────────────

/** UUIDv5 (RFC 9562) of the batch's `clientUuid` and the row: retries find the same player. */
function rowClientUuid(batchClientUuid: string, index: number): string {
  const namespace = Buffer.from(batchClientUuid.replace(/-/g, ''), 'hex');
  const bytes = createHash('sha1')
    .update(namespace)
    .update(`roster_import.player:${String(index)}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** SHA-256 of the validated body: a retry sends the same one. */
function requestSha256(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

const importColumns = {
  id: rosterImport.id,
  clientUuid: rosterImport.clientUuid,
  rowCount: rosterImport.rowCount,
  createdCount: rosterImport.createdCount,
  updatedCount: rosterImport.updatedCount,
  skippedCount: rosterImport.skippedCount,
  guardiansLinkedCount: rosterImport.guardiansLinkedCount,
  invitationsToSendCount: rosterImport.invitationsToSendCount,
  createdBy: rosterImport.createdBy,
  createdAt: rosterImport.createdAt,
};

interface ImportRow {
  id: string;
  clientUuid: string;
  rowCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  guardiansLinkedCount: number;
  invitationsToSendCount: number;
  createdBy: string | null;
  createdAt: Date;
}

function summaryDto(row: ImportRow): Omit<RosterImport, 'rows'> {
  return {
    id: row.id as RosterImport['id'],
    clientUuid: row.clientUuid as RosterImport['clientUuid'],
    rowCount: row.rowCount,
    createdCount: row.createdCount,
    updatedCount: row.updatedCount,
    skippedCount: row.skippedCount,
    guardiansLinkedCount: row.guardiansLinkedCount,
    invitationsToSendCount: row.invitationsToSendCount,
    createdBy: row.createdBy as RosterImport['createdBy'],
    createdAt: row.createdAt.toISOString(),
  };
}

function importDto(row: ImportRow, outcomes: RosterImportRowOutcome[]): RosterImport {
  return {
    ...summaryDto(row),
    rows: outcomes,
  };
}

/** The invitations a result asks to send: from the outcomes and the (same) request body. */
function invitationsToSend(body: Body, outcomes: RosterImportRowOutcome[]) {
  return outcomes.flatMap((outcome) =>
    outcome.guardians.flatMap((result, guardianIndex) => {
      const sent = body.rows[outcome.index]?.guardians?.[guardianIndex];
      if (result !== 'invite' || sent === undefined || outcome.playerId === null) return [];
      return [
        {
          rowIndex: outcome.index,
          guardianIndex,
          playerId: outcome.playerId,
          email: sent.email.toLowerCase(),
          relationship: sent.relationship,
        },
      ];
    }),
  );
}

const IMPORT_KEYS: KeysetSpec<ImportRow, 'createdAt'> = {
  fields: {
    createdAt: { column: rosterImport.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: rosterImport.id, value: (row) => row.id },
};

// ─── Routes ────────────────────────────────────────────────────────────────────────────

export function registerRosterImportRoutes(app: FastifyInstance): void {
  registerEndpoint(app, previewRosterImport, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller }): Promise<RosterImportPreview> => {
      await authorizeImport(permissions);
      const snapshot = await loadSnapshot(db, caller.membership.clubId, body);
      const plans = planRows(snapshot, body);
      const count = (test: (plan: RowPlan) => boolean) => plans.filter(test).length;
      const guardians = plans.flatMap((plan) => (plan.action === null ? [] : plan.guardians));
      return {
        rowCount: plans.length,
        invalidCount: count((p) => p.issues.some((i) => i.code !== 'resolution_required')),
        resolutionRequiredCount: count((p) => p.resolutionRequired),
        createCount: count((p) => p.action === 'create'),
        updateCount: count((p) => p.action === 'update'),
        skipCount: count((p) => p.action === 'skip'),
        guardiansToLinkCount: guardians.filter((g) => g.outcome === 'linked').length,
        invitationsToSendCount: guardians.filter((g) => g.outcome === 'invite').length,
        rows: plans.map((plan) => ({
          index: plan.index,
          sourceRow: plan.row.sourceRow ?? null,
          issues: plan.issues,
          action: plan.action,
          resolutionRequired: plan.resolutionRequired,
          categoryId: plan.categoryId,
          positionIds: plan.positionIds as RosterImportPreview['rows'][number]['positionIds'],
          matches: plan.matches.map((m) => ({
            playerId: m.playerId,
            kind: m.kind,
            reason: m.reason,
            firstName: m.player.firstName,
            lastName: m.player.lastName,
            birthDate: m.player.birthDate,
            sex: m.player.sex,
            sport: m.player.sport,
            currentCategoryIds: m.player.currentCategoryIds,
            archived: m.player.archived,
            version: m.player.version,
          })),
          duplicateOfIndex: plan.duplicateOfIndex,
          guardians: plan.guardians.map((g) => ({
            email: g.email,
            relationship: g.relationship,
            outcome: g.outcome,
          })),
        })),
      };
    },
  });

  registerEndpoint(app, importRoster, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await authorizeImport(permissions);
      const { clubId } = caller.membership;
      // One import of the club at a time: duplicates are checked against what the other wrote.
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`roster-import:${clubId}`}, 0))`,
      );
      const hash = requestSha256(body);
      const [previous] = await db
        .select({
          ...importColumns,
          requestSha256: rosterImport.requestSha256,
          outcomes: rosterImport.outcomes,
        })
        .from(rosterImport)
        .where(and(eq(rosterImport.clubId, clubId), eq(rosterImport.clientUuid, body.clientUuid)));
      if (previous !== undefined) {
        if (previous.requestSha256 !== hash) {
          throw new HttpError('conflict', 'This clientUuid was already used for another import');
        }
        markReplay(reply);
        return {
          import: importDto(previous, previous.outcomes),
          invitationsToSend: invitationsToSend(body, previous.outcomes),
        };
      }

      const snapshot = await loadSnapshot(db, clubId, body);
      const plans = planRows(snapshot, body);
      const issues = plans.flatMap((plan) => plan.issues);
      if (issues.length > 0) {
        throw new HttpError('validation_failed', 'The roster does not match the club', {
          details: issues,
        });
      }
      for (const plan of plans) {
        const resolution = plan.row.resolution;
        if (
          resolution?.action === 'update' &&
          plan.targetPlayer !== null &&
          plan.targetPlayer.version !== resolution.version
        ) {
          throw new HttpError(
            'conflict',
            `The player of row ${String(plan.index)} changed since the preview: preview again`,
          );
        }
      }

      const outcomes: RosterImportRowOutcome[] = [];
      let linked = 0;
      let toInvite = 0;
      for (const plan of plans) {
        let playerId: PlayerId | null = plan.targetPlayer?.id ?? null;
        const { row } = plan;
        if (plan.action === 'create') {
          const joinedOn = row.joinedOn ?? snapshot.today;
          const [created] = await db
            .insert(player)
            .values({
              clubId,
              clientUuid: rowClientUuid(body.clientUuid, plan.index),
              firstName: row.firstName,
              lastName: row.lastName,
              birthDate: row.birthDate,
              sex: row.sex,
              sport: plan.sport,
              dominantSide: row.dominantSide ?? null,
              joinedOn,
              createdBy: caller.userId,
              updatedBy: caller.userId,
            })
            .returning({ id: player.id });
          if (created === undefined) throw new Error('roster import: the insert returned no row');
          playerId = created.id;
          await writePositions(db, clubId, created.id, plan.positionIds, caller.userId, false);
          if (plan.addCategory && plan.categoryId !== null) {
            await db.insert(playerCategory).values({
              clubId,
              playerId: created.id,
              categoryId: plan.categoryId,
              validFrom: joinedOn,
              createdBy: caller.userId,
              updatedBy: caller.userId,
            });
          }
        } else if (plan.action === 'update' && plan.targetPlayer !== null) {
          const target = plan.targetPlayer;
          await db
            .update(player)
            .set({
              ...(row.dominantSide !== undefined && { dominantSide: row.dominantSide }),
              // Always written: the version moves, like any edit of the profile.
              updatedBy: caller.userId,
            })
            .where(and(eq(player.clubId, clubId), eq(player.id, target.id)));
          if (row.positions !== undefined) {
            await writePositions(db, clubId, target.id, plan.positionIds, caller.userId, true);
          }
          if (plan.addCategory && plan.categoryId !== null) {
            await db.insert(playerCategory).values({
              clubId,
              playerId: target.id,
              categoryId: plan.categoryId,
              validFrom: snapshot.today,
              createdBy: caller.userId,
              updatedBy: caller.userId,
            });
          }
        }

        for (const g of plan.guardians) {
          if (g.outcome === 'linked' && g.userId !== null && playerId !== null) {
            await db.insert(guardian).values({
              clubId,
              playerId,
              userId: g.userId,
              relationship: g.relationship,
              validFrom: snapshot.today,
              createdBy: caller.userId,
              updatedBy: caller.userId,
            });
            linked += 1;
          }
          if (g.outcome === 'invite') toInvite += 1;
        }
        outcomes.push({
          index: plan.index,
          sourceRow: row.sourceRow ?? null,
          result:
            plan.action === 'create' ? 'created' : plan.action === 'update' ? 'updated' : 'skipped',
          playerId,
          guardians: plan.guardians.map((g) => g.outcome),
        });
      }

      const count = (result: RosterImportRowOutcome['result']) =>
        outcomes.filter((o) => o.result === result).length;
      const [stored] = await db
        .insert(rosterImport)
        .values({
          clubId,
          clientUuid: body.clientUuid,
          requestSha256: hash,
          rowCount: outcomes.length,
          createdCount: count('created'),
          updatedCount: count('updated'),
          skippedCount: count('skipped'),
          guardiansLinkedCount: linked,
          invitationsToSendCount: toInvite,
          outcomes,
          createdBy: caller.userId,
          updatedBy: caller.userId,
        })
        .returning(importColumns);
      if (stored === undefined) throw new Error('roster import: the record was not written');
      return {
        import: importDto(stored, outcomes),
        invitationsToSend: invitationsToSend(body, outcomes),
      };
    },
  });

  registerEndpoint(app, listRosterImports, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('data_import', 'run');
      const plan = keysetPage(IMPORT_KEYS, query, {});
      const rows = await db
        .select(importColumns)
        .from(rosterImport)
        .where(and(eq(rosterImport.clubId, caller.membership.clubId), plan.where))
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, summaryDto);
    },
  });

  registerEndpoint(app, getRosterImport, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('data_import', 'run');
      const [row] = await db
        .select({ ...importColumns, outcomes: rosterImport.outcomes })
        .from(rosterImport)
        .where(
          and(
            eq(rosterImport.clubId, caller.membership.clubId),
            eq(rosterImport.id, params.rosterImportId),
          ),
        );
      if (row === undefined) throw new HttpError('not_found', 'Roster import not found');
      return importDto(row, row.outcomes);
    },
  });
}

/** Writes the positions of a player, the main one first (replacing them on an update). */
async function writePositions(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
  positionIds: readonly string[],
  userId: string,
  replace: boolean,
): Promise<void> {
  if (replace) {
    await db
      .delete(playerPosition)
      .where(and(eq(playerPosition.clubId, clubId), eq(playerPosition.playerId, playerId)));
  }
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
