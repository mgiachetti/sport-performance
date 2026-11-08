import type { CategoryId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { codeCheck } from './checks.js';
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

/**
 * Season per sport (B-317): the planning year of the sport, for example
 * "2027" from February (V1, pre-season) to November (V4); the competition
 * itself is the fixture. At most a year long. Active seasons of a sport never
 * overlap (exclusion constraint `season_no_overlap`, migration `0013`), so a
 * day of the club belongs to at most one season per sport. Archived instead
 * of deleted.
 */
export const season = pgTable(
  'season',
  {
    ...tenantColumns(),
    sport: sportEnum('sport').notNull(),
    name: text('name').notNull(),
    startsOn: localDate('starts_on').notNull(),
    endsOn: localDate('ends_on').notNull(),
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [
    ...tenantConstraints('season', t),
    unique('season_club_id_sport_name_key').on(t.clubId, t.sport, t.name),
    check('season_span', sql`${t.endsOn} >= ${t.startsOn}`),
    /** `SEASON_MAX_DAYS` of the domain: both ends count. */
    check('season_max_length', sql`${t.endsOn} - ${t.startsOn} < 366`),
    check(
      'season_name_format',
      sql`${t.name} = btrim(${t.name}) and ${t.name} <> '' and char_length(${t.name}) <= 60`,
    ),
  ],
);

/**
 * A program of the club: a sport and its branch (`sex`, ADR 0017), e.g. men's
 * rugby and women's hockey for ORC. Enabling one seeds its configuration
 * (`bootstrapClub`, B-306); disabling archives it (`archived_at`) with its
 * categories, never deletes it. Every category belongs to one (composite
 * foreign key `(club_id, sport, sex)`).
 */
export const clubBranch = pgTable(
  'club_branch',
  {
    ...tenantColumns(),
    sport: sportEnum('sport').notNull(),
    sex: sexEnum('sex').notNull(),
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [
    ...tenantConstraints('club_branch', t),
    unique('club_branch_club_id_sport_sex_key').on(t.clubId, t.sport, t.sex),
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
    /**
     * Whether the category's players may be assigned a pod (B-912, ADR 0106):
     * M19 by default (`DEFAULT_POD_AGE_BAND_CODES`, seeded by the bootstrap);
     * the club turns it on or off per category.
     */
    podsEnabled: boolean('pods_enabled').notNull().default(false),
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [
    ...tenantConstraints('category', t),
    /** Also the index of the reference to the branch (its leading columns). */
    unique('category_club_id_sport_sex_name_key').on(t.clubId, t.sport, t.sex, t.name),
    foreignKey({
      name: 'category_branch_fkey',
      columns: [t.clubId, t.sport, t.sex],
      foreignColumns: [clubBranch.clubId, clubBranch.sport, clubBranch.sex],
    }).onDelete('restrict'),
    codeCheck('category_age_band_code_format', t.ageBandCode),
    check(
      'category_name_format',
      sql`${t.name} = btrim(${t.name}) and ${t.name} <> '' and char_length(${t.name}) <= 60`,
    ),
  ],
);

/**
 * Playing position per sport. The defaults of each sport are seeded (B-306);
 * the club renames them, reorders them, adds its own inside the lines of the
 * sport and archives what it does not use (B-801, ADR 0087). Archived, never
 * deleted: a player keeps an archived position, it is just not offered again.
 */
export const position = pgTable(
  'position',
  {
    ...tenantColumns(),
    sport: sportEnum('sport').notNull(),
    /** Stable code (`hooker`, `fly_half`); the UI text comes from i18n or `label`. */
    code: text('code').notNull(),
    /** Optional club wording, overriding the i18n text. */
    label: text('label'),
    /**
     * Line used to group references and percentiles (`forwards`, `backs`):
     * one of the lines of the sport (`POSITION_LINE_CODES`, checked by the API).
     */
    lineCode: text('line_code'),
    sortOrder: smallint('sort_order').notNull().default(0),
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [
    ...tenantConstraints('position', t),
    unique('position_club_id_sport_code_key').on(t.clubId, t.sport, t.code),
    codeCheck('position_code_format', t.code),
    check(
      'position_line_code_format',
      sql`${t.lineCode} is null or ${t.lineCode} ~ '^[a-z][a-z0-9_]*$'`,
    ),
    check(
      'position_label_format',
      sql`${t.label} is null or (${t.label} = btrim(${t.label}) and ${t.label} <> '' and char_length(${t.label}) <= 40)`,
    ),
  ],
);

/**
 * What each staff member sees (B-314): a coach or S&C to categories, a
 * medical staff member to a whole sport. Exactly one target per row. The
 * application ends an assignment (`valid_to`) instead of deleting it, and
 * never lets two of a membership to the same target overlap (ADR 0034).
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
    /** One open assignment of a membership to a category (B-309: accepting twice adds none). */
    uniqueIndex('staff_assignment_open_category_key')
      .on(t.clubId, t.membershipId, t.categoryId)
      .where(sql`${t.validTo} is null`),
    check('staff_assignment_one_target', sql`num_nonnulls(${t.categoryId}, ${t.sport}) = 1`),
    /**
     * Unlike other validity ranges, an empty one (`valid_to = valid_from`) is
     * allowed: an assignment ended before it started is cancelled, never in
     * force, and its row stays (ADR 0034).
     */
    check('staff_assignment_validity', sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
  ],
);
