import type { CategoryId, PlayerId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  pgTable,
  text,
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
  sexEnum,
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
    positionId: uuid('position_id'),
    dominantSide: dominantSideEnum('dominant_side'),
    /** Parents' heights for Khamis-Roche (B-203), with their origin (B-315). */
    motherHeightCm: doublePrecision('mother_height_cm'),
    motherHeightSource: heightSourceEnum('mother_height_source'),
    fatherHeightCm: doublePrecision('father_height_cm'),
    fatherHeightSource: heightSourceEnum('father_height_source'),
    /** Club days the player joined and left (B-315). */
    joinedOn: localDate('joined_on').notNull(),
    leftOn: localDate('left_on'),
  },
  (t) => [
    ...tenantConstraints('player', t),
    tenantReference('player', t.clubId, t.positionId, position),
    tenantReferenceIndex('player', t.clubId, t.positionId),
    uniqueIndex('player_club_id_user_id_key')
      .on(t.clubId, t.userId)
      .where(sql`${t.userId} is not null`),
    index('player_name_idx').on(t.clubId, t.lastName, t.firstName),
    check(
      'player_mother_height',
      sql`(${t.motherHeightCm} is null) = (${t.motherHeightSource} is null) and (${t.motherHeightCm} is null or (${finite(t.motherHeightCm)} and ${t.motherHeightCm} > 0))`,
    ),
    check(
      'player_father_height',
      sql`(${t.fatherHeightCm} is null) = (${t.fatherHeightSource} is null) and (${t.fatherHeightCm} is null or (${finite(t.fatherHeightCm)} and ${t.fatherHeightCm} > 0))`,
    ),
    check('player_membership_period', sql`${t.leftOn} is null or ${t.leftOn} >= ${t.joinedOn}`),
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
  },
  (t) => [
    ...tenantConstraints('guardian', t),
    tenantReference('guardian', t.clubId, t.playerId, player),
    uniqueIndex('guardian_active_key')
      .on(t.clubId, t.playerId, t.userId)
      .where(sql`${t.validTo} is null`),
    index('guardian_user_id_idx').on(t.userId),
    validityCheck('guardian_validity', t.validFrom, t.validTo),
  ],
);

/**
 * A signed consent (Ley 25.326, B-312). Rows are evidence: revoking sets
 * `revoked_*`, a new version of the text is a new row. Without a current
 * consent of a type, data of that type is not collected.
 */
export const consent = pgTable(
  'consent',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    type: consentTypeEnum('type').notNull(),
    /** Version of the consent text that was shown (B-312). */
    documentVersion: text('document_version').notNull(),
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
    index('consent_player_idx').on(t.clubId, t.playerId, t.type),
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
