import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  previewInvitation,
  revokeInvitation,
  STAFF_ROLES,
  type CreatedInvitation,
  type Invitation as InvitationDto,
  type InvitationStatus,
  type ValidationIssue,
} from '@sport-performance/contracts';
import {
  category,
  club,
  invitation,
  invitationCategory,
  player,
} from '@sport-performance/db/schema';
import type {
  CategoryId,
  ClubId,
  GuardianRelationship,
  MembershipRole,
  PlayerId,
} from '@sport-performance/domain';
import { and, eq, gt, inArray, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { membershipSummary } from '../auth/identity.js';
import type { AuthModule } from '../auth/module.js';
import { enforceRateLimits } from '../auth/rate-limit.js';
import type { TenantDatabase } from '../db/database.js';
import { EmailDeliveryError } from '../email/transport.js';
import { registerEndpoint, type ClubAuthContext } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import {
  generateInvitationToken,
  hashInvitationToken,
  invitationLinks,
  invitationStatus,
  maskEmail,
} from '../invitations/tokens.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Who manages the club's invitations: only its `admin` (a guardian invites
 * their child through `POST /v1/players/{id}/invitations`, B-310).
 */
function requireInvitationManager(caller: ClubAuthContext): void {
  if (caller.membership.role !== 'admin') {
    throw new HttpError('forbidden', 'Only an admin of the club manages invitations');
  }
}

interface InvitationRow {
  id: string;
  email: string;
  role: MembershipRole;
  playerId: PlayerId | null;
  guardianRelationship: GuardianRelationship | null;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

const invitationColumns = {
  id: invitation.id,
  email: invitation.email,
  role: invitation.role,
  playerId: invitation.playerId,
  guardianRelationship: invitation.guardianRelationship,
  expiresAt: invitation.expiresAt,
  createdAt: invitation.createdAt,
  acceptedAt: invitation.acceptedAt,
  revokedAt: invitation.revokedAt,
};

function toDto(row: InvitationRow, categoryIds: readonly string[], now: Date): InvitationDto {
  return {
    id: row.id as InvitationDto['id'],
    email: row.email,
    role: row.role,
    categoryIds: [...categoryIds] as InvitationDto['categoryIds'],
    playerId: row.playerId,
    relationship: row.guardianRelationship,
    status: invitationStatus(row, now),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

async function categoriesOf(
  db: TenantDatabase,
  clubId: ClubId,
  invitationIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byInvitation = new Map<string, string[]>();
  if (invitationIds.length === 0) return byInvitation;
  const rows = await db
    .select({
      invitationId: invitationCategory.invitationId,
      categoryId: invitationCategory.categoryId,
    })
    .from(invitationCategory)
    .where(
      and(
        eq(invitationCategory.clubId, clubId),
        inArray(invitationCategory.invitationId, [...invitationIds]),
      ),
    )
    .orderBy(invitationCategory.categoryId);
  for (const row of rows) {
    byInvitation.set(row.invitationId, [
      ...(byInvitation.get(row.invitationId) ?? []),
      row.categoryId,
    ]);
  }
  return byInvitation;
}

function statusFilter(status: InvitationStatus | undefined, now: Date): SQL | undefined {
  const open = and(isNull(invitation.acceptedAt), isNull(invitation.revokedAt));
  switch (status) {
    case undefined:
      return undefined;
    case 'pending':
      return and(open, gt(invitation.expiresAt, now));
    case 'expired':
      return and(open, lte(invitation.expiresAt, now));
    case 'accepted':
      return isNotNull(invitation.acceptedAt);
    case 'revoked':
      return isNotNull(invitation.revokedAt);
  }
}

const INVITATION_KEYS: KeysetSpec<InvitationRow, 'createdAt' | 'expiresAt'> = {
  fields: {
    createdAt: { column: invitation.createdAt, type: 'timestamp', value: (row) => row.createdAt },
    expiresAt: { column: invitation.expiresAt, type: 'timestamp', value: (row) => row.expiresAt },
  },
  id: { column: invitation.id, value: (row) => row.id },
};

/** What {@link issueInvitation} needs: the contract's input, already validated by the caller. */
export interface InvitationRequest {
  email: string;
  role: MembershipRole;
  categoryIds: readonly CategoryId[];
  playerId: PlayerId | null;
  relationship: GuardianRelationship | null;
  expiresInDays: number;
}

/**
 * Creates an invitation and emails its link, in the request transaction
 * (ADR 0028). Inviting again (same email, role and player) replaces the
 * previous link. Shared by the administration (`POST /v1/invitations`) and
 * by a guardian inviting their child (`POST /v1/players/{id}/invitations`,
 * B-310): the caller authorizes and validates first; RLS lets a `parent`
 * write only `player` invitations of their children.
 */
export async function issueInvitation(
  db: TenantDatabase,
  auth: AuthModule,
  caller: ClubAuthContext,
  request: InvitationRequest,
): Promise<CreatedInvitation> {
  const { clubId } = caller.membership;
  const email = request.email.toLowerCase();
  const [clubRow] = await db
    .select({ name: club.name, timeZone: club.timeZone })
    .from(club)
    .where(eq(club.id, clubId));
  if (clubRow === undefined) throw new HttpError('not_found', 'Club not found');

  const now = auth.now();
  // Inviting again (same email, role and player) replaces the previous link. Two people
  // inviting the same person at once run one after the other (the second revokes the
  // first's link): `invitation_pending_key` allows one open link per club, email, role and
  // player.
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`invitation:${clubId}:${email}:${request.role}:${request.playerId ?? ''}`}, 0))`,
  );
  await db
    .update(invitation)
    .set({ revokedAt: now, revokedBy: caller.userId, updatedBy: caller.userId })
    .where(
      and(
        eq(invitation.clubId, clubId),
        eq(invitation.email, email),
        eq(invitation.role, request.role),
        request.playerId === null
          ? isNull(invitation.playerId)
          : eq(invitation.playerId, request.playerId),
        isNull(invitation.acceptedAt),
        isNull(invitation.revokedAt),
      ),
    );

  const token = generateInvitationToken();
  const [row] = await db
    .insert(invitation)
    .values({
      clubId,
      email,
      role: request.role,
      playerId: request.playerId,
      guardianRelationship: request.relationship,
      tokenHash: hashInvitationToken(token),
      expiresAt: new Date(now.getTime() + request.expiresInDays * DAY_MS),
      createdBy: caller.userId,
      updatedBy: caller.userId,
    })
    .returning(invitationColumns);
  if (row === undefined) throw new Error('createInvitation: insert returned no row');
  if (request.categoryIds.length > 0) {
    await db.insert(invitationCategory).values(
      request.categoryIds.map((categoryId) => ({
        clubId,
        invitationId: row.id,
        categoryId,
        createdBy: caller.userId,
        updatedBy: caller.userId,
      })),
    );
  }

  const links = invitationLinks(token, auth.links);
  try {
    // Inside the transaction: if the email cannot be sent, the invitation is not created.
    // Trade-off (ADR 0028): a commit failing after the send leaves a dead link; moves to
    // a pg-boss job enqueued in this transaction once the worker exists (ADR 0011).
    await auth.mailer.sendInvitation({
      to: email,
      clubName: clubRow.name,
      role: request.role,
      inviterName: caller.name,
      url: links.web,
      expiresAt: row.expiresAt,
      timeZone: clubRow.timeZone,
    });
  } catch (error) {
    if (error instanceof EmailDeliveryError) {
      throw new HttpError('service_unavailable', 'The invitation email could not be sent', {
        cause: error,
      });
    }
    throw error;
  }
  return { invitation: toDto(row, [...request.categoryIds].sort(), now), links };
}

/** `/v1/invitations`: invitations by link to a club (ADR 0007, ADR 0028). */
export function registerInvitationRoutes(app: FastifyInstance, auth: AuthModule): void {
  registerEndpoint(app, createInvitation, {
    transaction: true,
    handler: async ({ body }, { db, auth: caller }) => {
      requireInvitationManager(caller);
      const { clubId } = caller.membership;
      const categoryIds = [...new Set(body.categoryIds)];

      const issues: ValidationIssue[] = [];
      if (categoryIds.length > 0 && !(STAFF_ROLES as readonly string[]).includes(body.role)) {
        issues.push({
          path: ['body', 'categoryIds'],
          code: 'custom',
          message: `Only ${STAFF_ROLES.join(', ')} invitations take categories`,
        });
      } else if (categoryIds.length > 0) {
        const found = await db
          .select({ id: category.id })
          .from(category)
          .where(
            and(
              eq(category.clubId, clubId),
              inArray(category.id, categoryIds),
              isNull(category.archivedAt),
            ),
          );
        const known = new Set<string>(found.map((row) => row.id));
        body.categoryIds.forEach((id, index) => {
          if (!known.has(id)) {
            issues.push({
              path: ['body', 'categoryIds', index],
              code: 'custom',
              message: 'Not an active category of this club',
            });
          }
        });
      }
      // About a player (B-310, ADR 0042): their own account (`player`), or a guardian link
      // (`parent`, with its relationship).
      if (body.playerId !== undefined && body.role !== 'player' && body.role !== 'parent') {
        issues.push({
          path: ['body', 'playerId'],
          code: 'custom',
          message: 'Only player and parent invitations are about a player',
        });
      }
      const opensLink = body.role === 'parent' && body.playerId !== undefined;
      if (opensLink !== (body.relationship !== undefined)) {
        issues.push({
          path: ['body', 'relationship'],
          code: 'custom',
          message: 'A parent invitation about a player takes the relationship; no other does',
        });
      }
      if (body.playerId !== undefined && issues.length === 0) {
        const [target] = await db
          .select({ userId: player.userId })
          .from(player)
          .where(and(eq(player.clubId, clubId), eq(player.id, body.playerId)));
        if (target === undefined) {
          issues.push({
            path: ['body', 'playerId'],
            code: 'custom',
            message: 'Not a player of this club',
          });
        } else if (body.role === 'player' && target.userId !== null) {
          throw new HttpError('conflict', 'The player already has an account');
        }
      }
      if (issues.length > 0) {
        throw new HttpError('validation_failed', 'The request does not match the contract', {
          details: issues,
        });
      }

      return issueInvitation(db, auth, caller, {
        email: body.email,
        role: body.role,
        categoryIds,
        playerId: body.playerId ?? null,
        relationship: body.relationship ?? null,
        expiresInDays: body.expiresInDays,
      });
    },
  });

  registerEndpoint(app, listInvitations, {
    transaction: true,
    handler: async ({ query }, { db, auth: caller }) => {
      requireInvitationManager(caller);
      const { clubId } = caller.membership;
      const now = auth.now();
      const plan = keysetPage(INVITATION_KEYS, query, { status: query.status });
      const rows = await db
        .select(invitationColumns)
        .from(invitation)
        .where(and(eq(invitation.clubId, clubId), statusFilter(query.status, now), plan.where))
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      const page = plan.page(rows, (row) => row);
      const categories = await categoriesOf(
        db,
        clubId,
        page.items.map((row) => row.id),
      );
      return {
        items: page.items.map((row) => toDto(row, categories.get(row.id) ?? [], now)),
        nextCursor: page.nextCursor,
      };
    },
  });

  registerEndpoint(app, revokeInvitation, {
    transaction: true,
    handler: async ({ params }, { db, auth: caller }) => {
      requireInvitationManager(caller);
      const { clubId } = caller.membership;
      const [row] = await db
        .select({ acceptedAt: invitation.acceptedAt, revokedAt: invitation.revokedAt })
        .from(invitation)
        .where(and(eq(invitation.clubId, clubId), eq(invitation.id, params.invitationId)))
        .for('update');
      if (row === undefined) throw new HttpError('not_found', 'Invitation not found');
      if (row.acceptedAt !== null) {
        throw new HttpError('conflict', 'The invitation was already accepted');
      }
      // Revoking twice is a no-op: DELETE is idempotent.
      if (row.revokedAt === null) {
        await db
          .update(invitation)
          .set({ revokedAt: auth.now(), revokedBy: caller.userId, updatedBy: caller.userId })
          .where(and(eq(invitation.clubId, clubId), eq(invitation.id, params.invitationId)));
      }
      return undefined;
    },
  });

  registerEndpoint(app, previewInvitation, {
    transaction: false,
    handler: async ({ body }, { request }) => {
      await enforceRateLimits(auth.rateLimiter, [[auth.limits.invitationByIp, request.ip]]);
      const found = await auth.identity.previewInvitation(
        hashInvitationToken(body.token),
        auth.now(),
      );
      if (found === undefined) throw new HttpError('not_found', 'Invitation not found');
      return {
        club: found.club,
        role: found.role,
        status: found.status,
        expiresAt: found.expiresAt.toISOString(),
        emailHint: maskEmail(found.email),
      };
    },
  });

  registerEndpoint(app, acceptInvitation, {
    transaction: false,
    handler: async ({ body }, { request, auth: caller }) => {
      // Per user too: a session endpoint, so a shared wifi does not exhaust someone else's budget.
      await enforceRateLimits(auth.rateLimiter, [
        [auth.limits.invitationByIp, request.ip],
        [auth.limits.invitationAcceptByUser, caller.userId],
      ]);
      const result = await auth.identity.acceptInvitation(hashInvitationToken(body.token), {
        userId: caller.userId,
      });
      switch (result.kind) {
        case 'not_found':
          throw new HttpError('not_found', 'Invitation not found');
        case 'unavailable':
          throw new HttpError('conflict', `The invitation is ${result.status}`);
        case 'wrong_email':
          throw new HttpError('forbidden', 'The invitation is for another email');
        case 'player_taken':
          throw new HttpError(
            'conflict',
            'The player already has an account, or this account already is another player of the club',
          );
        case 'own_guardian':
          throw new HttpError('conflict', 'A player cannot be their own guardian');
        case 'accepted':
          request.log.info(
            {
              clubId: result.membership.clubId,
              membershipId: result.membership.id,
              created: result.created,
            },
            'invitation accepted',
          );
          return { membership: membershipSummary(result.membership) };
      }
    },
  });
}
