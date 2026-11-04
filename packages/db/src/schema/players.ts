import type { CategoryId, PlayerId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { finite, validityCheck } from './checks.js';
import { localDate, timestamptz } from './columns.js';
import {
  consentSignerEnum,
  consentTypeEnum,
  dominantSideEnum,
  guardianRelationshipEnum,
  heightSourceEnum,
  parentKindEnum,
  playerLeaveReasonEnum,
  sexEnum,
  sportEnum,
  stageBasisEnum,
  stageEnum,
  stageReasonEnum,
} from './enums.js';
import { category, position, season } from './organization.js';
import {
  tenantColumns,
  tenantConstraints,
  tenantReference,
  tenantReferenceIndex,
} from './tenant.js';

/** Longest first or last name of a player. */
export const PLAYER_NAME_MAX_LENGTH = 80;
/** Longest note of a player's leave (baja). */
export const PLAYER_LEAVE_NOTE_MAX_LENGTH = 500;

/**
 * A player of the club. Personal data of a minor: visibility is restricted
 * by RLS (#33) and nothing here is health data (ADR 0008).
 */
export const player = pgTable(
  'player',
  {
    ...tenantColumns(),
    id: uuid('id').primaryKey().defaultRandom().$type<PlayerId>(),
    /** The player's own account, once they have one (B-310). */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    birthDate: localDate('birth_date').notNull(),
    /** Sex for maturation formulas and references; not gender identity (ADR 0017). */
    sex: sexEnum('sex').notNull(),
    /**
     * Sport of the player (ADR 0017, ADR 0035). Fixed once created (trigger
     * `player_sport_guard`): categories and positions must be of this sport.
     */
    sport: sportEnum('sport').notNull(),
    dominantSide: dominantSideEnum('dominant_side'),
    /** Club days the player joined and left (alta y baja, B-315), both inclusive. */
    joinedOn: localDate('joined_on').notNull(),
    leftOn: localDate('left_on'),
    /** Why the player left; set exactly when `left_on` is. */
    leftReason: playerLeaveReasonEnum('left_reason'),
    leftNote: text('left_note'),
    /** When the leave was recorded: a player who left is archived (ADR 0032). */
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [
    ...tenantConstraints('player', t),
    uniqueIndex('player_club_id_user_id_key')
      .on(t.clubId, t.userId)
      .where(sql`${t.userId} is not null`),
    index('player_name_idx').on(t.clubId, t.lastName, t.firstName),
    check(
      'player_first_name_format',
      sql`${t.firstName} = btrim(${t.firstName}) and ${t.firstName} <> '' and char_length(${t.firstName}) <= ${sql.raw(String(PLAYER_NAME_MAX_LENGTH))}`,
    ),
    check(
      'player_last_name_format',
      sql`${t.lastName} = btrim(${t.lastName}) and ${t.lastName} <> '' and char_length(${t.lastName}) <= ${sql.raw(String(PLAYER_NAME_MAX_LENGTH))}`,
    ),
    check('player_membership_period', sql`${t.leftOn} is null or ${t.leftOn} >= ${t.joinedOn}`),
    check(
      'player_leave',
      sql`(${t.leftOn} is null) = (${t.leftReason} is null) and (${t.leftOn} is null) = (${t.archivedAt} is null) and (${t.leftNote} is null or (${t.leftOn} is not null and char_length(${t.leftNote}) between 1 and ${sql.raw(String(PLAYER_LEAVE_NOTE_MAX_LENGTH))}))`,
    ),
  ],
);

/**
 * Positions a player plays (B-315), in order: `sort_order = 0` is the main
 * one. Only positions of the player's sport (trigger `player_position_sport`).
 * A current attribute, not history: editing the profile replaces the rows.
 */
export const playerPosition = pgTable(
  'player_position',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    positionId: uuid('position_id').notNull(),
    sortOrder: smallint('sort_order').notNull(),
  },
  (t) => [
    ...tenantConstraints('player_position', t),
    tenantReference('player_position', t.clubId, t.playerId, player),
    tenantReference('player_position', t.clubId, t.positionId, position),
    unique('player_position_player_position_key').on(t.clubId, t.playerId, t.positionId),
    unique('player_position_player_order_key').on(t.clubId, t.playerId, t.sortOrder),
    index('player_position_position_idx').on(t.clubId, t.positionId),
    check('player_position_sort_order', sql`${t.sortOrder} >= 0`),
  ],
);

/**
 * Height of each biological parent, for Khamis-Roche (B-203), with its
 * origin (B-315): measured by the staff or reported. One row per parent.
 */
export const playerParentHeight = pgTable(
  'player_parent_height',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    parent: parentKindEnum('parent').notNull(),
    heightCm: doublePrecision('height_cm').notNull(),
    source: heightSourceEnum('source').notNull(),
  },
  (t) => [
    ...tenantConstraints('player_parent_height', t),
    tenantReference('player_parent_height', t.clubId, t.playerId, player),
    unique('player_parent_height_player_parent_key').on(t.clubId, t.playerId, t.parent),
    check(
      'player_parent_height_cm',
      sql`${finite(t.heightCm)} and ${t.heightCm} > 0 and ${t.heightCm} < 300`,
    ),
  ],
);

/**
 * Category history (B-316): the season change closes the current row and
 * opens the next one, so past results keep the category they were measured in.
 */
export const playerCategory = pgTable(
  'player_category',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    categoryId: uuid('category_id').notNull().$type<CategoryId>(),
    seasonId: uuid('season_id'),
    validFrom: localDate('valid_from').notNull(),
    validTo: localDate('valid_to'),
  },
  (t) => [
    ...tenantConstraints('player_category', t),
    tenantReference('player_category', t.clubId, t.playerId, player),
    tenantReference('player_category', t.clubId, t.categoryId, category),
    tenantReference('player_category', t.clubId, t.seasonId, season),
    tenantReferenceIndex('player_category', t.clubId, t.seasonId),
    index('player_category_player_idx').on(t.clubId, t.playerId, t.validFrom),
    index('player_category_category_idx').on(t.clubId, t.categoryId),
    validityCheck('player_category_validity', t.validFrom, t.validTo),
  ],
);

/** Parent or guardian ↔ player link, per club (ADR 0007, B-310). */
export const guardian = pgTable(
  'guardian',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    relationship: guardianRelationshipEnum('relationship').notNull(),
    validFrom: localDate('valid_from').notNull(),
    /** Closed when the link ends, for example when the player comes of age and revokes it (B-311). */
    validTo: localDate('valid_to'),
    /**
     * The adult player kept this guardian's access (B-311, ADR 0048). Without
     * it, the link stops giving access the day the player turns 18. Set and
     * cleared only through `app.review_guardian`, by the player themself.
     */
    adultConfirmedAt: timestamptz('adult_confirmed_at'),
    /** Who confirmed (the player's account; `NULL` only if deleted afterwards). */
    adultConfirmedBy: text('adult_confirmed_by').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    ...tenantConstraints('guardian', t),
    tenantReference('guardian', t.clubId, t.playerId, player),
    uniqueIndex('guardian_active_key')
      .on(t.clubId, t.playerId, t.userId)
      .where(sql`${t.validTo} is null`),
    index('guardian_user_id_idx').on(t.userId),
    /**
     * Unlike other validity ranges, an empty one (`valid_to = valid_from`) is
     * allowed: a link ended on the day it starts (a wrong guardian, linked
     * by mistake) must stop counting at once, and never counted (ADR 0042).
     */
    check('guardian_validity', sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
    check(
      'guardian_adult_confirmation',
      sql`${t.adultConfirmedBy} is null or ${t.adultConfirmedAt} is not null`,
    ),
  ],
);

/**
 * Access of a player without email (B-310, ADR 0042): a guardian (or the
 * administration) issues a short **code** to type and a **link** to open on
 * the player's device; redeeming either one, once, opens a session of the
 * player's account (creating it on first use). Only hashes are stored: the
 * HMAC-SHA-256 of the code with the auth secret (8 characters are too few
 * for a plain hash to resist a dump) and the SHA-256 of the 256-bit token.
 *
 * Short-lived (the API issues them for 15 minutes; the database caps them at
 * one hour), single use, one open per player. Rows stay as the record of who
 * gave access to whom and when it was used. RLS (migration 0018): the
 * administration and the player's guardians; redeeming goes through
 * `app.redeem_player_access()` (`SECURITY DEFINER`).
 */
export const playerAccessCode = pgTable(
  'player_access_code',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    /** Lowercase hex HMAC-SHA-256 of the normalized code. */
    codeHash: text('code_hash').notNull(),
    /** Lowercase hex SHA-256 of the token of the link. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    consumedAt: timestamptz('consumed_at'),
    /** The player's account that redeemed it (`NULL` only if deleted afterwards). */
    consumedBy: text('consumed_by').references(() => user.id, { onDelete: 'set null' }),
    revokedAt: timestamptz('revoked_at'),
    revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    ...tenantConstraints('player_access_code', t),
    tenantReference('player_access_code', t.clubId, t.playerId, player),
    unique('player_access_code_code_hash_key').on(t.codeHash),
    unique('player_access_code_token_hash_key').on(t.tokenHash),
    /** One open code per player: issuing a new one revokes the previous one. */
    uniqueIndex('player_access_code_open_key')
      .on(t.clubId, t.playerId)
      .where(sql`${t.consumedAt} is null and ${t.revokedAt} is null`),
    index('player_access_code_player_idx').on(t.clubId, t.playerId, t.createdAt),
    check('player_access_code_code_hash_format', sql`${t.codeHash} ~ '^[0-9a-f]{64}$'`),
    check('player_access_code_token_hash_format', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'player_access_code_expiry',
      sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '1 hour'`,
    ),
    check(
      'player_access_code_single_outcome',
      sql`${t.consumedAt} is null or ${t.revokedAt} is null`,
    ),
    check(
      'player_access_code_consumed_by',
      sql`${t.consumedBy} is null or ${t.consumedAt} is not null`,
    ),
    check(
      'player_access_code_revoked_by',
      sql`${t.revokedBy} is null or ${t.revokedAt} is not null`,
    ),
  ],
);

/** Longest version tag of a consent text (`2026-11`, `v2`). */
export const CONSENT_DOCUMENT_VERSION_MAX_LENGTH = 40;
/** Pattern of a consent text version: letters, digits, `.`, `_` and `-`, starting with a letter or digit. */
export const CONSENT_DOCUMENT_VERSION_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]*$';

/**
 * A published version of a consent text of the club (B-312, ADR 0043): what
 * the signer reads. Immutable once inserted (trigger `consent_document_guard`,
 * also for the owner): a new text is a new version, and the current one of
 * each type is the last published. `body_sha256` is computed by the database
 * (trigger) so the evidence does not depend on the client.
 */
export const consentDocument = pgTable(
  'consent_document',
  {
    ...tenantColumns(),
    type: consentTypeEnum('type').notNull(),
    /** Version tag shown to the signer and stored with each consent (`consent.document_version`). */
    version: text('version').notNull(),
    /** BCP 47 tag of the text (`es-AR`, ADR 0019). */
    locale: text('locale').notNull().default('es-AR'),
    title: text('title').notNull(),
    /** Plain text with blank lines between paragraphs. */
    body: text('body').notNull(),
    /**
     * SHA-256 of `body` (UTF-8, hex). Always computed by the guard trigger on
     * insert, whatever the client sends (`sha256` over text is not immutable
     * for a generated column).
     */
    bodySha256: text('body_sha256').notNull().default(''),
    publishedAt: timestamptz('published_at').notNull().defaultNow(),
  },
  (t) => [
    ...tenantConstraints('consent_document', t),
    uniqueIndex('consent_document_version_key').on(t.clubId, t.type, t.version),
    index('consent_document_current_idx').on(t.clubId, t.type, t.publishedAt),
    check(
      'consent_document_version_format',
      sql`${t.version} ~ ${sql.raw(`'${CONSENT_DOCUMENT_VERSION_PATTERN}'`)} and char_length(${t.version}) <= ${sql.raw(String(CONSENT_DOCUMENT_VERSION_MAX_LENGTH))}`,
    ),
    check('consent_document_locale_format', sql`${t.locale} ~ '^[a-z]{2}(-[A-Z]{2})?$'`),
    check(
      'consent_document_text',
      sql`${t.title} = btrim(${t.title}) and ${t.title} <> '' and btrim(${t.body}) <> ''`,
    ),
  ],
);

/**
 * A signed consent (Ley 25.326, B-312, ADR 0043). Rows are evidence: after
 * the insert only the revocation (`revoked_*`, once) changes (trigger
 * `consent_guard`); a new version of the text is a new row. Without a
 * current consent of a type, data of that type is not collected.
 */
export const consent = pgTable(
  'consent',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    type: consentTypeEnum('type').notNull(),
    /** Version of the consent text that was shown (B-312). */
    documentVersion: text('document_version').notNull(),
    /**
     * The text that was signed. `NULL` only for rows recorded before the
     * texts were stored (B-312); the API always sets it, and the guard
     * checks that `type` and `document_version` are the document's.
     */
    documentId: uuid('document_id'),
    signerKind: consentSignerEnum('signer_kind').notNull(),
    /** Legal evidence: the signer's account cannot be deleted while the row exists. */
    signedBy: text('signed_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    signedAt: timestamptz('signed_at').notNull().defaultNow(),
    revokedAt: timestamptz('revoked_at'),
    revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'restrict' }),
  },
  (t) => [
    ...tenantConstraints('consent', t),
    tenantReference('consent', t.clubId, t.playerId, player),
    tenantReference('consent', t.clubId, t.documentId, consentDocument),
    tenantReferenceIndex('consent', t.clubId, t.documentId),
    index('consent_player_idx').on(t.clubId, t.playerId, t.type),
    // One current signature of a text per player and signer kind: signing it again is a
    // conflict, but the adult signs the text their guardian signed (B-311).
    uniqueIndex('consent_current_document_key')
      .on(t.clubId, t.playerId, t.documentId, t.signerKind)
      .where(sql`${t.revokedAt} is null and ${t.documentId} is not null`),
    check(
      'consent_revocation',
      sql`(${t.revokedAt} is null) = (${t.revokedBy} is null) and (${t.revokedAt} is null or ${t.revokedAt} >= ${t.signedAt})`,
    ),
  ],
);

/**
 * Stage history of a player (B-204): automatic assignments and staff pins
 * (`basis = 'manual'`, `reason = 'pinned'`). The domain's `StagePin.untilDate`
 * is inclusive; here `valid_to` is exclusive (`untilDate + 1 day`).
 */
export const playerStage = pgTable(
  'player_stage',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    stage: stageEnum('stage').notNull(),
    basis: stageBasisEnum('basis').notNull(),
    reason: stageReasonEnum('reason').notNull(),
    validFrom: localDate('valid_from').notNull(),
    validTo: localDate('valid_to'),
    /** Offset projected to `valid_from`, when maturation was used. */
    phvOffsetYears: doublePrecision('phv_offset_years'),
    note: text('note'),
  },
  (t) => [
    ...tenantConstraints('player_stage', t),
    tenantReference('player_stage', t.clubId, t.playerId, player),
    index('player_stage_player_idx').on(t.clubId, t.playerId, t.validFrom),
    check('player_stage_manual_is_pinned', sql`(${t.basis} = 'manual') = (${t.reason} = 'pinned')`),
    check(
      'player_stage_phv_offset_finite',
      sql`${t.phvOffsetYears} is null or ${finite(t.phvOffsetYears)}`,
    ),
    validityCheck('player_stage_validity', t.validFrom, t.validTo),
  ],
);
