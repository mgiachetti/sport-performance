import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, unique, uuid } from 'drizzle-orm/pg-core';
import { localDate } from './columns.js';
import { membershipRoleEnum, usageClientEnum, usageSurfaceEnum } from './enums.js';
import { membership } from './organization.js';
import { tenantColumns, tenantConstraints, tenantReference } from './tenant.js';

/**
 * Usage metrics (B-707, ADR 0093): first-party instrumentation of adoption,
 * without third-party SDKs. The outcomes (wellness, RPE, test days) are
 * counted from their own tables; these two tables only hold the use of the
 * surfaces the API serves.
 */

/**
 * One member's use of one surface on one club day: written only by
 * `app.record_usage(surface, client)` (`SECURITY DEFINER`, the API calls it
 * when it serves the surface), which takes the membership and the role from
 * the validated context and the day from the club's time zone. Nothing about
 * what was read, the IP or the device (only the audit columns of every club
 * table: first and last use of the day). Read only by the
 * administration (the API answers aggregates). After the retention the
 * worker folds whole weeks into {@link usageWeekly} and deletes the rows;
 * they also go with the membership (`ON DELETE CASCADE`, account deletion).
 */
export const usageActivity = pgTable(
  'usage_activity',
  {
    ...tenantColumns(),
    membershipId: uuid('membership_id').notNull(),
    /** Validated role of the membership when it was used. */
    role: membershipRoleEnum('role').notNull(),
    /** Club day of the use (the club's time zone). */
    localDate: localDate('local_date').notNull(),
    surface: usageSurfaceEnum('surface').notNull(),
    client: usageClientEnum('client').notNull(),
    /** Times the surface was served that day (requests, not time spent). */
    eventsN: integer('events_n').notNull().default(1),
  },
  (t) => [
    ...tenantConstraints('usage_activity', t),
    tenantReference('usage_activity', t.clubId, t.membershipId, membership).onDelete('cascade'),
    unique('usage_activity_member_day_key').on(
      t.clubId,
      t.membershipId,
      t.localDate,
      t.surface,
      t.client,
    ),
    index('usage_activity_local_date_idx').on(t.clubId, t.localDate),
    check('usage_activity_events_n', sql`${t.eventsN} >= 1`),
  ],
);

/**
 * Weekly counts of use, without members (B-707): what the worker keeps of a
 * week of {@link usageActivity} once its retention ended. One row per ISO week
 * (Monday, club day), surface, client and role; written only by the worker.
 */
export const usageWeekly = pgTable(
  'usage_weekly',
  {
    ...tenantColumns(),
    /** Monday of the ISO week (club day). */
    weekStart: localDate('week_start').notNull(),
    surface: usageSurfaceEnum('surface').notNull(),
    client: usageClientEnum('client').notNull(),
    role: membershipRoleEnum('role').notNull(),
    /** Distinct memberships that used the surface that week. */
    activeMembersN: integer('active_members_n').notNull(),
    /** Sum over those members of the days they used it (1 to 7 each). */
    memberDaysN: integer('member_days_n').notNull(),
    /** Times the surface was served that week. */
    eventsN: integer('events_n').notNull(),
  },
  (t) => [
    ...tenantConstraints('usage_weekly', t),
    unique('usage_weekly_week_key').on(t.clubId, t.weekStart, t.surface, t.client, t.role),
    check('usage_weekly_monday', sql`extract(isodow from ${t.weekStart}) = 1`),
    check(
      'usage_weekly_counts',
      sql`${t.activeMembersN} >= 1 and ${t.memberDaysN} between ${t.activeMembersN} and 7 * ${t.activeMembersN} and ${t.eventsN} >= ${t.memberDaysN}`,
    ),
  ],
);
