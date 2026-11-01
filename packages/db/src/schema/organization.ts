import type { CategoryId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { codeCheck, validityCheck } from './checks.js';
import { localDate, timestamptz } from './columns.js';
import { membershipRoleEnum, sexEnum, sportEnum, stageEnum } from './enums.js';
import { tenantColumns, tenantConstraints, tenantReference } from './tenant.js';

/**
 * Club structure: memberships and staff assignments (ADR 0007), seasons,
 * categories and positions per sport (ADR 0017).
 *
 * Date ranges follow two conventions, named so they cannot be mixed up:
 * calendar spans (`starts_on` / `ends_on`, both inclusive) for seasons and
 * windows, and validity ranges (`valid_from` inclusive / `valid_to`
 * exclusive, `NULL` = open) for assignments, histories and configuration.
 */

/**
 * A user's role in a club. One row per role: the same person may be `coach`
 * and `parent` in the same club, and pick the role with the club selector.
 * Leaving a club closes the membership (`ended_at`), it is never deleted by
 * the application. Deleting the user account (B-329) does cascade to its
 * memberships and guardian links (ADR 0023).
 */
export const membership = pgTable(
  'membership',
  {
    ...tenantColumns(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull(),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    endedAt: timestamptz('ended_at'),
    invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    ...tenantConstraints('membership', t),
    uniqueIndex('membership_active_role_key')
      .on(t.clubId, t.userId, t.role)
      .where(sql`${t.endedAt} is null`),
    /** The club selector looks memberships up by user, across clubs. */
    index('membership_user_id_idx').on(t.userId),
    check('membership_period', sql`${t.endedAt} is null or ${t.endedAt} > ${t.startedAt}`),
  ],
);

/** Season per sport (B-317), for example "2027" from March to October. */
export const season = pgTable(
  'season',
  {
    ...tenantColumns(),
    sport: sportEnum('sport').notNull(),
    name: text('name').notNull(),
    startsOn: localDate('starts_on').notNull(),
    endsOn: localDate('ends_on').notNull(),
  },
  (t) => [
    ...tenantConstraints('season', t),
    unique('season_club_id_sport_name_key').on(t.clubId, t.sport, t.name),
    check('season_span', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

/**
 * A club category ("M15 rugby"), with its sport and branch (`sex`, ADR
 * 0017). Every category maps to a domain age band (`age_band_code`, `m15`)
 * so history stays comparable across clubs and sports.
 */
export const category = pgTable(
  'category',
  {
    ...tenantColumns(),
    id: uuid('id').primaryKey().defaultRandom().$type<CategoryId>(),
    sport: sportEnum('sport').notNull(),
    sex: sexEnum('sex').notNull(),
    ageBandCode: text('age_band_code').notNull(),
    name: text('name').notNull(),
    /** Stage of the category before maturation (`AgeBand.defaultStage`, B-204). */
    defaultStage: stageEnum('default_stage').notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [
    ...tenantConstraints('category', t),
    unique('category_club_id_sport_sex_name_key').on(t.clubId, t.sport, t.sex, t.name),
    codeCheck('category_age_band_code_format', t.ageBandCode),
  ],
);

/** Playing position per sport (rugby positions are seeded in B-306; hockey in M8). */
export const position = pgTable(
  'position',
  {
    ...tenantColumns(),
    sport: sportEnum('sport').notNull(),
    /** Stable code (`hooker`, `fly_half`); the UI text comes from i18n or `label`. */
    code: text('code').notNull(),
    /** Optional club wording, overriding the i18n text. */
    label: text('label'),
    /** Line used to group references and percentiles (`forwards`, `backs`). */
    lineCode: text('line_code'),
    sortOrder: smallint('sort_order').notNull().default(0),
  },
  (t) => [
    ...tenantConstraints('position', t),
    unique('position_club_id_sport_code_key').on(t.clubId, t.sport, t.code),
    codeCheck('position_code_format', t.code),
    check(
      'position_line_code_format',
      sql`${t.lineCode} is null or ${t.lineCode} ~ '^[a-z][a-z0-9_]*$'`,
    ),
  ],
);

/**
 * What each staff member sees (B-314): a coach or S&C to categories, a
 * medical staff member to a whole sport. Exactly one target per row.
 */
export const staffAssignment = pgTable(
  'staff_assignment',
  {
    ...tenantColumns(),
    membershipId: uuid('membership_id').notNull(),
    categoryId: uuid('category_id').$type<CategoryId>(),
    sport: sportEnum('sport'),
    /** No default: `current_date` is the server's day, not the club's. */
    validFrom: localDate('valid_from').notNull(),
    validTo: localDate('valid_to'),
  },
  (t) => [
    ...tenantConstraints('staff_assignment', t),
    tenantReference('staff_assignment', t.clubId, t.membershipId, membership).onDelete('cascade'),
    tenantReference('staff_assignment', t.clubId, t.categoryId, category),
    index('staff_assignment_membership_idx').on(t.clubId, t.membershipId),
    index('staff_assignment_category_idx').on(t.clubId, t.categoryId),
    check('staff_assignment_one_target', sql`num_nonnulls(${t.categoryId}, ${t.sport}) = 1`),
    validityCheck('staff_assignment_validity', t.validFrom, t.validTo),
  ],
);
