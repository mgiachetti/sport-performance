import {
  CALENDAR_RANGE_MAX_DAYS,
  getCategoryCalendar,
  type CalendarEvent,
} from '@sport-performance/contracts';
import { fixture, season, testSession, testWindow } from '@sport-performance/db/schema';
import { can, spanDays, type LocalDate } from '@sport-performance/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { registerEndpoint } from '../../http/endpoint.js';
import { keysetPage, type KeysetSpec } from '../../http/pagination.js';
import { registerFixtureRoutes } from './fixtures.js';
import { registerSeasonRoutes } from './seasons.js';
import {
  fixtureDto,
  invalid,
  readCategoryFacts,
  selectFixtures,
  testSessionColumns,
  testSessionDto,
  testWindowColumns,
  testWindowDto,
} from './shared.js';
import { registerTestSessionRoutes } from './test-sessions.js';

/**
 * The calendar (B-317): seasons and windows, scheduled test days, the
 * fixture, and the calendar of a category over a date range.
 */
export function registerCalendarRoutes(app: FastifyInstance): void {
  registerSeasonRoutes(app);
  registerTestSessionRoutes(app);
  registerFixtureRoutes(app);
  registerCategoryCalendarRoute(app);
}

type EventType = CalendarEvent['type'];

interface EventKey {
  type: EventType;
  id: string;
  date: LocalDate;
}

const EVENT_KEYS: KeysetSpec<EventKey, 'date'> = {
  fields: { date: { column: sql`e.date`, type: 'text', value: (row) => row.date } },
  id: { column: sql`e.id`, value: (row) => row.id },
};

/**
 * `GET /v1/calendar`: the windows of the sport's active seasons that cross
 * the range, and the category's test days and (active) matches in it, as one
 * list by day. The keys come from one `UNION ALL` (so the cursor pages over
 * all of them); each page is then read with the columns of each resource.
 */
function registerCategoryCalendarRoute(app: FastifyInstance): void {
  registerEndpoint(app, getCategoryCalendar, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      if (query.to < query.from) invalid(['query', 'to'], '`to` is before `from`');
      if (spanDays({ startsOn: query.from, endsOn: query.to }) > CALENDAR_RANGE_MAX_DAYS) {
        invalid(['query', 'to'], `The range spans at most ${String(CALENDAR_RANGE_MAX_DAYS)} days`);
      }
      const target = await readCategoryFacts(db, clubId, query.categoryId);
      const facts = { category: { id: target.id, sport: target.sport } };
      await permissions.authorize('category', 'read', facts);
      const subject = await permissions.subject();
      const sees = {
        test_window: can(subject, 'read', { kind: 'season', clubId }),
        test_session: can(subject, 'read', { kind: 'test_session', clubId, ...facts }),
        fixture: can(subject, 'read', { kind: 'training_session', clubId, ...facts }),
      } satisfies Record<EventType, boolean>;

      const plan = keysetPage(EVENT_KEYS, query, {
        categoryId: query.categoryId,
        from: query.from,
        to: query.to,
      });
      const from = sql`${query.from}::date`;
      const to = sql`${query.to}::date`;
      const parts = [
        sees.test_window
          ? sql`select 'test_window'::text as type, ${testWindow.id} as id, ${testWindow.startsOn}::text as date
              from ${testWindow} join ${season}
                on ${season.clubId} = ${testWindow.clubId} and ${season.id} = ${testWindow.seasonId}
             where ${testWindow.clubId} = ${clubId} and ${season.sport} = ${target.sport}
               and ${testWindow.archivedAt} is null and ${season.archivedAt} is null
               and ${testWindow.startsOn} <= ${to} and ${testWindow.endsOn} >= ${from}`
          : undefined,
        sees.test_session
          ? sql`select 'test_session'::text, ${testSession.id}, ${testSession.scheduledOn}::text
              from ${testSession}
             where ${testSession.clubId} = ${clubId} and ${testSession.categoryId} = ${target.id}
               and ${testSession.scheduledOn} between ${from} and ${to}`
          : undefined,
        sees.fixture
          ? sql`select 'fixture'::text, ${fixture.id}, ${fixture.matchDate}::text
              from ${fixture}
             where ${fixture.clubId} = ${clubId} and ${fixture.categoryId} = ${target.id}
               and ${fixture.archivedAt} is null
               and ${fixture.matchDate} between ${from} and ${to}`
          : undefined,
      ].filter((part) => part !== undefined);
      if (parts.length === 0) return { items: [], nextCursor: null };

      const { rows } = await db.execute<{ type: EventType; id: string; date: LocalDate }>(
        sql`select e.type, e.id, e.date from (${sql.join(parts, sql` union all `)}) as e
             ${plan.where === undefined ? sql`` : sql`where ${plan.where}`}
             order by ${sql.join(plan.orderBy, sql`, `)} limit ${plan.limit}`,
      );
      const page = plan.page(rows, (row) => row);
      const ids = (type: EventType) => page.items.filter((e) => e.type === type).map((e) => e.id);

      const windowIds = ids('test_window');
      const windows =
        windowIds.length === 0
          ? []
          : await db
              .select({ ...testWindowColumns, seasonName: season.name })
              .from(testWindow)
              .innerJoin(
                season,
                and(eq(season.clubId, testWindow.clubId), eq(season.id, testWindow.seasonId)),
              )
              .where(and(eq(testWindow.clubId, clubId), inArray(testWindow.id, windowIds)));
      const sessionIds = ids('test_session');
      const sessions =
        sessionIds.length === 0
          ? []
          : await db
              .select(testSessionColumns)
              .from(testSession)
              .where(and(eq(testSession.clubId, clubId), inArray(testSession.id, sessionIds)));
      const fixtureIds = ids('fixture');
      const matches =
        fixtureIds.length === 0
          ? []
          : await selectFixtures(
              db,
              and(eq(fixture.clubId, clubId), inArray(fixture.id, fixtureIds)),
            );

      const items = page.items.map((event): CalendarEvent => {
        switch (event.type) {
          case 'test_window': {
            const row = windows.find((w) => w.id === event.id);
            if (row === undefined) throw new Error('calendar: a window of the page vanished');
            const testWindow = testWindowDto(row);
            return {
              type: 'test_window',
              date: row.startsOn,
              endDate: row.endsOn,
              season: { id: testWindow.seasonId, name: row.seasonName },
              testWindow,
            };
          }
          case 'test_session': {
            const row = sessions.find((s) => s.id === event.id);
            if (row === undefined) throw new Error('calendar: a test day of the page vanished');
            return {
              type: 'test_session',
              date: row.scheduledOn,
              endDate: row.scheduledOn,
              testSession: testSessionDto(row),
            };
          }
          case 'fixture': {
            const row = matches.find((m) => m.id === event.id);
            if (row === undefined) throw new Error('calendar: a match of the page vanished');
            return { type: 'fixture', date: row.date, endDate: row.date, fixture: fixtureDto(row) };
          }
        }
      });
      return { items, nextCursor: page.nextCursor };
    },
  });
}
