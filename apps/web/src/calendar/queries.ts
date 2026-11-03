import type { ApiClient, ArchiveStatus } from '@sport-performance/contracts';
import type { CategoryId, DateSpan, Sport } from '@sport-performance/domain';
import { queryOptions } from '@tanstack/react-query';
import type { ClubSelection } from '../api/club-selection';
import { MAX_PAGE_LIMIT, clubQueryKey, fetchAllPages } from '../api/queries';

/**
 * Queries of the season calendar (B-406), all under `['club', <selection>,
 * 'calendar', …]` so one invalidation refreshes the screen after a change.
 * A month shows at most six weeks, so every list is read whole.
 */
export function calendarKey(selection: ClubSelection | null, ...parts: readonly unknown[]) {
  return clubQueryKey(selection, 'calendar', ...parts);
}

const withCursor = (cursor: string | undefined) => (cursor === undefined ? {} : { cursor });

/** `GET /v1/calendar` of one category: windows, test days and matches of the range. */
export function categoryCalendarQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  categoryId: CategoryId,
  range: DateSpan,
) {
  return queryOptions({
    queryKey: calendarKey(selection, 'category', categoryId, range.startsOn, range.endsOn),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.getCategoryCalendar(
          {
            query: {
              categoryId,
              from: range.startsOn,
              to: range.endsOn,
              limit: MAX_PAGE_LIMIT,
              ...withCursor(cursor),
            },
          },
          { signal },
        ),
      ),
  });
}

/** Seasons (with their windows) of a sport, or of every sport. */
export function seasonsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  sport: Sport | null,
  status: ArchiveStatus,
) {
  return queryOptions({
    queryKey: calendarKey(selection, 'seasons', sport ?? 'all', status),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listSeasons(
          {
            query: {
              status,
              sort: 'startsOn',
              limit: MAX_PAGE_LIMIT,
              ...(sport === null ? {} : { sport }),
              ...withCursor(cursor),
            },
          },
          { signal },
        ),
      ),
  });
}

/** Test days of a sport (or all the user sees) in the range; the API scopes them by assignment. */
export function testSessionsInRangeQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  sport: Sport | null,
  range: DateSpan,
) {
  return queryOptions({
    queryKey: calendarKey(selection, 'testSessions', sport ?? 'all', range.startsOn, range.endsOn),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listTestSessions(
          {
            query: {
              from: range.startsOn,
              to: range.endsOn,
              limit: MAX_PAGE_LIMIT,
              ...(sport === null ? {} : { sport }),
              ...withCursor(cursor),
            },
          },
          { signal },
        ),
      ),
  });
}

/** Active matches of a sport (or all the user sees) in the range. */
export function fixturesInRangeQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  sport: Sport | null,
  range: DateSpan,
) {
  return queryOptions({
    queryKey: calendarKey(selection, 'fixtures', sport ?? 'all', range.startsOn, range.endsOn),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listFixtures(
          {
            query: {
              from: range.startsOn,
              to: range.endsOn,
              status: 'active',
              limit: MAX_PAGE_LIMIT,
              ...(sport === null ? {} : { sport }),
              ...withCursor(cursor),
            },
          },
          { signal },
        ),
      ),
  });
}
