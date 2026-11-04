import type { ApiClient, EndpointInput, listGymPrograms } from '@sport-performance/contracts';
import type { PlayerId } from '@sport-performance/domain';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { ClubSelection } from '../api/club-selection';
import { MAX_PAGE_LIMIT, clubQueryKey, fetchAllPages } from '../api/queries';

/**
 * Queries of the gym screens (B-607), keyed under the club. Every key starts
 * with {@link gymKey}: a write invalidates the whole subtree.
 */

export type GymProgramFilters = Omit<
  NonNullable<EndpointInput<typeof listGymPrograms>['query']>,
  'cursor' | 'limit'
>;

export const GYM_PROGRAM_PAGE_SIZE = 25;
/** Sets of the player shown in the profile (newest first). */
export const GYM_SET_PAGE_SIZE = 50;

export function gymKey(selection: ClubSelection | null, ...parts: readonly unknown[]) {
  return clubQueryKey(selection, 'gym', ...parts);
}

export function gymProgramsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  filters: GymProgramFilters,
) {
  return infiniteQueryOptions({
    queryKey: gymKey(selection, 'programs', filters),
    queryFn: ({ pageParam, signal }) =>
      api.listGymPrograms(
        {
          query: {
            ...filters,
            limit: GYM_PROGRAM_PAGE_SIZE,
            ...(pageParam === undefined ? {} : { cursor: pageParam }),
          },
        },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function gymProgramQuery(api: ApiClient, selection: ClubSelection | null, id: string) {
  return queryOptions({
    queryKey: gymKey(selection, 'program', id),
    queryFn: ({ signal }) => api.getGymProgram({ params: { gymProgramId: id } }, { signal }),
  });
}

export function playerGymSummaryQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: gymKey(selection, 'player', playerId, 'summary'),
    queryFn: ({ signal }) =>
      api.getPlayerGymSummary({ params: { playerId }, query: {} }, { signal }),
  });
}

export function playerGymSetsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: gymKey(selection, 'player', playerId, 'sets'),
    queryFn: ({ signal }) =>
      api.listGymSets({ query: { playerId, limit: GYM_SET_PAGE_SIZE } }, { signal }),
  });
}

/** The players of a category, for a program of one player (a squad: a few pages at most). */
export function categoryPlayersQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  categoryId: string,
) {
  return queryOptions({
    queryKey: gymKey(selection, 'category-players', categoryId),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listPlayers(
          {
            query: {
              categoryId,
              limit: MAX_PAGE_LIMIT,
              ...(cursor === undefined ? {} : { cursor }),
            },
          },
          { signal },
        ),
      ),
    enabled: categoryId !== '',
  });
}
