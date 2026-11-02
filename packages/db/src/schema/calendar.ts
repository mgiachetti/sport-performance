import type { CategoryId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, time, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { localDate, timestamptz } from './columns.js';
import { fixtureStatusEnum, fixtureVenueEnum } from './enums.js';
import { category } from './organization.js';
import { tenantColumns, tenantConstraints, tenantReference } from './tenant.js';

/**
 * The fixture (B-317): the matches a category is scheduled to play. Seasons
 * and testing windows are in `organization.ts` and `testing.ts`; a played
 * match is a `training_session` of kind `match` (B-318) with its
 * participation and load.
 */

/** Longest opponent, competition and location texts. */
export const FIXTURE_TEXT_MAX_LENGTH = 120;
export const FIXTURE_NOTES_MAX_LENGTH = 2000;

function trimmedText(column: AnyPgColumn, max: number) {
  return sql`${column} is null or (${column} = btrim(${column}) and ${column} <> '' and char_length(${column}) <= ${sql.raw(String(max))})`;
}

/**
 * A match of a category. The day (`match_date`) and the kick-off
 * (`kickoff_time`, `NULL` while unconfirmed) are the club's wall clock: the
 * instant is derived with the club's current time zone when read, so it never
 * drifts from what the fixture says. Its sport is the category's. Its season
 * is the one of the sport that contains the day (seasons do not overlap), so
 * it is not stored. Archived instead of deleted.
 */
export const fixture = pgTable(
  'fixture',
  {
    ...tenantColumns(),
    categoryId: uuid('category_id').notNull().$type<CategoryId>(),
    opponent: text('opponent').notNull(),
    venue: fixtureVenueEnum('venue').notNull(),
    competition: text('competition'),
    matchDate: localDate('match_date').notNull(),
    kickoffTime: time('kickoff_time', { precision: 0 }),
    location: text('location'),
    status: fixtureStatusEnum('status').notNull().default('scheduled'),
    notes: text('notes'),
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [
    ...tenantConstraints('fixture', t),
    tenantReference('fixture', t.clubId, t.categoryId, category),
    /** The calendar of a category by day; also the index of the reference. */
    index('fixture_category_date_idx').on(t.clubId, t.categoryId, t.matchDate),
    check('fixture_opponent_format', trimmedText(t.opponent, FIXTURE_TEXT_MAX_LENGTH)),
    check('fixture_competition_format', trimmedText(t.competition, FIXTURE_TEXT_MAX_LENGTH)),
    check('fixture_location_format', trimmedText(t.location, FIXTURE_TEXT_MAX_LENGTH)),
    check('fixture_notes_format', trimmedText(t.notes, FIXTURE_NOTES_MAX_LENGTH)),
    /** Kick-off to the minute (`HH:MM`, `LOCAL_TIME_PATTERN` of the domain). */
    check(
      'fixture_kickoff_minute',
      sql`${t.kickoffTime} is null or extract(second from ${t.kickoffTime}) = 0`,
    ),
  ],
);
