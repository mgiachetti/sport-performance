import type { CategoryId, PlayerId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { localDate, timestamptz } from './columns.js';
import {
  seasonRolloverDecisionEnum,
  seasonRolloverOutcomeEnum,
  seasonRolloverProposalEnum,
  seasonRolloverStatusEnum,
} from './enums.js';
import { category, season } from './organization.js';
import { player, playerCategory } from './players.js';
import {
  tenantColumns,
  tenantConstraints,
  tenantReference,
  tenantReferenceIndex,
} from './tenant.js';

/**
 * A season change (B-316, ADR 0049): the proposal of moving every player of
 * the season's sport to the category of their birth year, reviewed by the
 * administration and applied once, on `effective_on`. At most one draft per
 * season; an applied or cancelled one never changes again (trigger
 * `season_rollover_guard`). RLS: only the administration.
 */
export const seasonRollover = pgTable(
  'season_rollover',
  {
    ...tenantColumns(),
    seasonId: uuid('season_id').notNull(),
    /** Day the new memberships start and the previous ones end (`valid_to`, exclusive). */
    effectiveOn: localDate('effective_on').notNull(),
    /** Year that decided the categories (`seasonRolloverYear`: the year the season starts). */
    seasonYear: smallint('season_year').notNull(),
    status: seasonRolloverStatusEnum('status').notNull().default('draft'),
    appliedAt: timestamptz('applied_at'),
    appliedBy: text('applied_by').references(() => user.id, { onDelete: 'set null' }),
    cancelledAt: timestamptz('cancelled_at'),
    cancelledBy: text('cancelled_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    ...tenantConstraints('season_rollover', t),
    tenantReference('season_rollover', t.clubId, t.seasonId, season),
    index('season_rollover_season_idx').on(t.clubId, t.seasonId, t.createdAt),
    /** One draft per season: two reviews of the same change would contradict each other. */
    uniqueIndex('season_rollover_draft_key')
      .on(t.clubId, t.seasonId)
      .where(sql`${t.status} = 'draft'`),
    check('season_rollover_year', sql`${t.seasonYear} between 1900 and 9999`),
    check(
      'season_rollover_lifecycle',
      sql`(${t.appliedAt} is not null) = (${t.status} = 'applied') and (${t.cancelledAt} is not null) = (${t.status} = 'cancelled') and (${t.appliedBy} is null or ${t.appliedAt} is not null) and (${t.cancelledBy} is null or ${t.cancelledAt} is not null)`,
    ),
  ],
);

/**
 * One player of a season change: what the proposal says (computed when the
 * draft is created), what the administration decided, and what applying
 * did. Rows of a draft only; once the change is applied or cancelled they
 * are its record and never change (trigger `season_rollover_item_guard`).
 */
export const seasonRolloverItem = pgTable(
  'season_rollover_item',
  {
    ...tenantColumns(),
    rolloverId: uuid('rollover_id').notNull(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    /** `season_year − birth year`, when the draft was created. */
    ageInSeasonYear: smallint('age_in_season_year').notNull(),
    /** Age band of that age (`m15`); `NULL` outside every band. */
    ageBandCode: text('age_band_code'),
    proposal: seasonRolloverProposalEnum('proposal').notNull(),
    proposedCategoryId: uuid('proposed_category_id').$type<CategoryId>(),
    /** The proposal is not automatic: it has to be reviewed before applying. */
    needsReview: boolean('needs_review').notNull(),
    decision: seasonRolloverDecisionEnum('decision').notNull(),
    /** Category the player moves to: set exactly when `decision = 'move'`. */
    targetCategoryId: uuid('target_category_id').$type<CategoryId>(),
    reviewedAt: timestamptz('reviewed_at'),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    /** What applying did (`NULL` until then). */
    outcome: seasonRolloverOutcomeEnum('outcome'),
    /** The membership applying opened (`outcome = 'moved'`). */
    membershipId: uuid('membership_id'),
  },
  (t) => [
    ...tenantConstraints('season_rollover_item', t),
    tenantReference('season_rollover_item', t.clubId, t.rolloverId, seasonRollover),
    tenantReference('season_rollover_item', t.clubId, t.playerId, player),
    tenantReference('season_rollover_item', t.clubId, t.proposedCategoryId, category),
    tenantReference('season_rollover_item', t.clubId, t.targetCategoryId, category),
    tenantReference('season_rollover_item', t.clubId, t.membershipId, playerCategory),
    unique('season_rollover_item_player_key').on(t.clubId, t.rolloverId, t.playerId),
    index('season_rollover_item_player_idx').on(t.clubId, t.playerId),
    tenantReferenceIndex('season_rollover_item', t.clubId, t.proposedCategoryId),
    tenantReferenceIndex('season_rollover_item', t.clubId, t.targetCategoryId),
    tenantReferenceIndex('season_rollover_item', t.clubId, t.membershipId),
    check('season_rollover_item_age', sql`${t.ageInSeasonYear} between 0 and 150`),
    check(
      'season_rollover_item_age_band_code_format',
      sql`${t.ageBandCode} is null or ${t.ageBandCode} ~ '^[a-z][a-z0-9_]*$'`,
    ),
    check(
      'season_rollover_item_proposal',
      sql`(${t.proposedCategoryId} is not null) = (${t.proposal} in ('birth_year', 'already_there')) and (${t.ageBandCode} is null) = (${t.proposal} in ('aged_out', 'too_young'))`,
    ),
    check(
      'season_rollover_item_decision',
      sql`(${t.targetCategoryId} is not null) = (${t.decision} = 'move')`,
    ),
    check(
      'season_rollover_item_review',
      sql`${t.reviewedBy} is null or ${t.reviewedAt} is not null`,
    ),
    check(
      'season_rollover_item_outcome',
      sql`(${t.membershipId} is not null) = (${t.outcome} is not distinct from 'moved') and (${t.outcome} is distinct from 'moved' or ${t.decision} = 'move')`,
    ),
  ],
);
