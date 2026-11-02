import type { CategoryId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { timestamptz } from './columns.js';
import { membershipRoleEnum } from './enums.js';
import { category } from './organization.js';
import { tenantColumns, tenantConstraints, tenantReference } from './tenant.js';

/**
 * Access to a club (B-309, ADR 0007, ADR 0028): invitations by link and the
 * attempt counters of the sign-in flow.
 */

/**
 * An invitation to join a club with a role. The link carries a random token
 * (256 bits); only its SHA-256 is stored, so a database leak does not leak
 * usable links. Accepting it creates the `membership` (and the staff
 * assignments of `invitation_category`). It ends accepted, revoked or
 * expired: never both accepted and revoked, and the application never
 * deletes it (it is the record of who invited whom: `created_by`).
 *
 * RLS (ADR 0026, migration 0006): only `admin` and `superadmin` of the club
 * read and write it. The invitee is not a member yet: the link is looked up
 * and accepted through `app.invitation_by_token()` / `app.accept_invitation()`.
 */
export const invitation = pgTable(
  'invitation',
  {
    ...tenantColumns(),
    /** Lowercase, like Better Auth stores `user.email`; only that user can accept it. */
    email: text('email').notNull(),
    role: membershipRoleEnum('role').notNull(),
    /** Lowercase hex SHA-256 of the token of the link. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    acceptedAt: timestamptz('accepted_at'),
    /** `NULL` after acceptance only if that account was deleted afterwards. */
    acceptedBy: text('accepted_by').references(() => user.id, { onDelete: 'set null' }),
    revokedAt: timestamptz('revoked_at'),
    revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    ...tenantConstraints('invitation', t),
    unique('invitation_token_hash_key').on(t.tokenHash),
    /**
     * At most one open link per email and role in a club (inviting again revokes
     * the previous one, ADR 0028); also the admin list of pending invitations.
     * `email` is lowercase (check below), so this is case-insensitive.
     */
    uniqueIndex('invitation_pending_key')
      .on(t.clubId, t.email, t.role)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    check('invitation_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('invitation_token_hash_format', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('invitation_single_outcome', sql`${t.acceptedAt} is null or ${t.revokedAt} is null`),
    check('invitation_accepted_by', sql`${t.acceptedBy} is null or ${t.acceptedAt} is not null`),
    check('invitation_revoked_by', sql`${t.revokedBy} is null or ${t.revokedAt} is not null`),
    check('invitation_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

/**
 * Category scope of a staff invitation: on acceptance each row becomes a
 * `staff_assignment` of the new membership, valid from the club's day.
 */
export const invitationCategory = pgTable(
  'invitation_category',
  {
    ...tenantColumns(),
    invitationId: uuid('invitation_id').notNull(),
    categoryId: uuid('category_id').notNull().$type<CategoryId>(),
  },
  (t) => [
    ...tenantConstraints('invitation_category', t),
    tenantReference('invitation_category', t.clubId, t.invitationId, invitation).onDelete(
      'cascade',
    ),
    tenantReference('invitation_category', t.clubId, t.categoryId, category),
    unique('invitation_category_invitation_category_key').on(
      t.clubId,
      t.invitationId,
      t.categoryId,
    ),
    index('invitation_category_category_idx').on(t.clubId, t.categoryId),
  ],
);

/**
 * Fixed-window attempt counters of the sign-in flow (send and verify a code,
 * by email and by IP). Global, like the identity tables: the keys are HMACs,
 * never an email or an IP in clear text. A row whose window ended is reset by
 * the next attempt; the API prunes ended windows periodically. RLS: only
 * Better Auth's role (`sport_performance_auth`) reaches it.
 */
export const authRateLimit = pgTable(
  'auth_rate_limit',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    windowEndsAt: timestamptz('window_ends_at').notNull(),
  },
  (t) => [
    check('auth_rate_limit_count_positive', sql`${t.count} > 0`),
    index('auth_rate_limit_window_ends_at_idx').on(t.windowEndsAt),
  ],
);
