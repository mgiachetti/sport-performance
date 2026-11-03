import type { ApiClient } from '@sport-performance/contracts';
import type { CategoryId, LocalDate, Sport } from '@sport-performance/domain';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { ClubSelection } from '../api/club-selection';
import { MAX_PAGE_LIMIT, clubQueryKey, fetchAllPages } from '../api/queries';

/** Query factories of the test day screens (B-405), keyed by the club selection (ADR 0057). */

export const TEST_DAYS_PAGE_SIZE = 20;

export interface TestDaysFilter {
  readonly sport: Sport | null;
  readonly categoryId: CategoryId | null;
}

/**
 * Days from today on (`upcoming`, soonest first) or before today (`past`,
 * latest first), of the sport and category of the layout, by cursor.
 */
export function testDaysQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  filter: TestDaysFilter,
  when: 'upcoming' | 'past',
  today: LocalDate,
  yesterday: LocalDate,
) {
  return infiniteQueryOptions({
    queryKey: clubQueryKey(selection, 'testSessions', when, today, filter.sport, filter.categoryId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.listTestSessions(
        {
          query: {
            limit: TEST_DAYS_PAGE_SIZE,
            ...(when === 'upcoming'
              ? { from: today, sort: 'scheduledOn' }
              : { to: yesterday, sort: '-scheduledOn' }),
            ...(filter.sport === null ? {} : { sport: filter.sport }),
            ...(filter.categoryId === null ? {} : { categoryId: filter.categoryId }),
            ...(pageParam === undefined ? {} : { cursor: pageParam }),
          },
        },
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** The sheet of a day: stations, roster, stage rules and previous results. */
export function testDaySheetQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  testSessionId: string,
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'testSessions', testSessionId, 'sheet'),
    queryFn: ({ signal }) => api.getTestSessionSheet({ params: { testSessionId } }, { signal }),
  });
}

/** Every result recorded on the day (a day is a few hundred at most). */
export function testDayResultsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  testSessionId: string,
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'testSessions', testSessionId, 'results'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listTestResults(
          {
            query: {
              testSessionId,
              limit: MAX_PAGE_LIMIT,
              sort: 'createdAt',
              ...(cursor === undefined ? {} : { cursor }),
            },
          },
          { signal },
        ),
      ),
  });
}

/** Every test day query (lists, sheets, results), to refresh after a write. */
export function testDaysKey(selection: ClubSelection | null) {
  return clubQueryKey(selection, 'testSessions');
}

/** Seasons of the club (every status), for the label of each day's window. */
export function seasonsQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'seasons', 'all'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listSeasons(
          {
            query: {
              status: 'all',
              limit: MAX_PAGE_LIMIT,
              ...(cursor === undefined ? {} : { cursor }),
            },
          },
          { signal },
        ),
      ),
    staleTime: 5 * 60_000,
  });
}

/** Search params of a test day: the station shown (`?station=cmj`), so a link opens it. */
export interface TestDaySearch {
  readonly station?: string | undefined;
}

export function parseTestDaySearch(search: Readonly<Record<string, unknown>>): TestDaySearch {
  const station = search.station;
  return typeof station === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(station) ? { station } : {};
}
