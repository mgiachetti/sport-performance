import type { ApiClient, EndpointInput, listTrainingSessions } from '@sport-performance/contracts';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { ClubSelection } from '../api/club-selection';
import { MAX_PAGE_LIMIT, clubQueryKey, fetchAllPages } from '../api/queries';

/**
 * Queries of the training screens (B-407), keyed under the club so data of
 * one club never answers another. Every key starts with
 * {@link trainingKey}: a write invalidates the whole subtree.
 */

export type SessionListFilters = Omit<
  NonNullable<EndpointInput<typeof listTrainingSessions>['query']>,
  'cursor' | 'limit'
>;

/** Sessions per page of the list. */
export const SESSION_PAGE_SIZE = 25;

export function trainingKey(selection: ClubSelection | null, ...parts: readonly unknown[]) {
  return clubQueryKey(selection, 'training', ...parts);
}

export function trainingSessionsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  filters: SessionListFilters,
) {
  return infiniteQueryOptions({
    queryKey: trainingKey(selection, 'sessions', filters),
    queryFn: ({ pageParam, signal }) =>
      api.listTrainingSessions(
        {
          query: {
            ...filters,
            limit: SESSION_PAGE_SIZE,
            ...(pageParam === undefined ? {} : { cursor: pageParam }),
          },
        },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function trainingSessionQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  trainingSessionId: string,
) {
  return queryOptions({
    queryKey: trainingKey(selection, 'session', trainingSessionId),
    queryFn: ({ signal }) => api.getTrainingSession({ params: { trainingSessionId } }, { signal }),
  });
}

/** The whole roster of a session (a category: a few dozen players, a handful of pages at most). */
export function sessionRosterQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  trainingSessionId: string,
) {
  return queryOptions({
    queryKey: trainingKey(selection, 'session', trainingSessionId, 'roster'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listTrainingSessionRoster(
          {
            params: { trainingSessionId },
            query: { limit: MAX_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
          },
          { signal },
        ),
      ),
  });
}
