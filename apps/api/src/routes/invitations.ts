import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  previewInvitation,
  revokeInvitation,
  STAFF_ROLES,
  type Invitation as InvitationDto,
  type InvitationStatus,
  type ValidationIssue,
} from '@sport-performance/contracts';
import { category, club, invitation, invitationCategory } from '@sport-performance/db/schema';
import type { ClubId, MembershipRole } from '@sport-performance/domain';
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
 * Who manages invitations. Until the permissions matrix (#34, B-305) lands,
 * only the club's `admin`.
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
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

const invitationColumns = {
  id: invitation.id,
  email: invitation.email,
  role: invitation.role,
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

/** `/v1/invitations`: invitations by link to a club (ADR 0007, ADR 0028). */
export function registerInvitationRoutes(app: FastifyInstance, auth: AuthModule): void {
  registerEndpoint(app, createInvitation, {
    transaction: true,
    handler: async ({ body }, { db, auth: caller }) => {
      requireInvitationManager(caller);
      const { clubId } = caller.membership;
      const email = body.email.toLowerCase();
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
      if (issues.length > 0) {
        throw new HttpError('validation_failed', 'The request does not match the contract', {
          details: issues,
        });
      }

      const [clubRow] = await db
        .select({ name: club.name, timeZone: club.timeZone })
        .from(club)
        .where(eq(club.id, clubId));
      if (clubRow === undefined) throw new HttpError('not_found', 'Club not found');

      const now = auth.now();
      // Inviting again (same email and role) replaces the previous link. Two admins inviting
      // the same person at once run one after the other (the second revokes the first's link):
      // `invitation_pending_key` allows one open link per club, email and role.
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`invitation:${clubId}:${email}:${body.role}`}, 0))`,
      );
      await db
        .update(invitation)
        .set({ revokedAt: now, revokedBy: caller.userId, updatedBy: caller.userId })
        .where(
          and(
            eq(invitation.clubId, clubId),
            eq(invitation.email, email),
            eq(invitation.role, body.role),
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
          role: body.role,
          tokenHash: hashInvitationToken(token),
          expiresAt: new Date(now.getTime() + body.expiresInDays * DAY_MS),
          createdBy: caller.userId,
          updatedBy: caller.userId,
        })
        .returning(invitationColumns);
      if (row === undefined) throw new Error('createInvitation: insert returned no row');
      if (categoryIds.length > 0) {
        await db.insert(invitationCategory).values(
          categoryIds.map((categoryId) => ({
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
          role: body.role,
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
      return { invitation: toDto(row, [...categoryIds].sort(), now), links };
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
