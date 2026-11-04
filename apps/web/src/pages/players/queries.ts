import type { ApiClient } from '@sport-performance/contracts';
import type { CategoryId, PlayerId, Sport } from '@sport-performance/domain';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { ClubSelection } from '../../api/club-selection';
import { MAX_PAGE_LIMIT, clubQueryKey, fetchAllPages } from '../../api/queries';

/**
 * Queries of the roster and the player profile (B-404), keyed by club and
 * player. Each block of the profile has its own query, so one that fails or
 * is denied does not take the others down.
 */

export const PLAYERS_PAGE_SIZE = 50;
/** Alerts shown in the profile's history (newest first). */
export const PROFILE_ALERTS_LIMIT = 20;

const withCursor = (cursor: string | undefined) => (cursor === undefined ? {} : { cursor });

export function playersQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  filter: { sport: Sport | null; categoryId: CategoryId | null; q: string },
) {
  return infiniteQueryOptions({
    queryKey: clubQueryKey(selection, 'players', 'list', filter),
    queryFn: ({ pageParam, signal }) =>
      api.listPlayers(
        {
          query: {
            limit: PLAYERS_PAGE_SIZE,
            ...withCursor(pageParam),
            ...(filter.sport === null ? {} : { sport: filter.sport }),
            ...(filter.categoryId === null ? {} : { categoryId: filter.categoryId }),
            ...(filter.q === '' ? {} : { q: filter.q }),
          },
        },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function playerQuery(api: ApiClient, selection: ClubSelection | null, playerId: PlayerId) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'players', playerId),
    queryFn: ({ signal }) => api.getPlayer({ params: { playerId } }, { signal }),
  });
}

/** Positions of the club (a small catalog), archived too: a player keeps an archived one. */
export function positionsQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'positions'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listPositions(
          { query: { status: 'all', limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal },
        ),
      ),
    staleTime: 10 * 60_000,
  });
}

const profileKey = (selection: ClubSelection | null, playerId: PlayerId, part: string) =>
  clubQueryKey(selection, 'players', playerId, 'profile', part);

export function dailyMonitoringQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: profileKey(selection, playerId, 'dailyMonitoring'),
    queryFn: ({ signal }) => api.getPlayerDailyMonitoring({ params: { playerId } }, { signal }),
  });
}

export function maturationQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: profileKey(selection, playerId, 'maturation'),
    queryFn: ({ signal }) => api.getPlayerMaturation({ params: { playerId } }, { signal }),
  });
}

export function availabilityQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: profileKey(selection, playerId, 'availability'),
    queryFn: ({ signal }) => api.getPlayerAvailability({ params: { playerId } }, { signal }),
  });
}

export function percentilesQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: profileKey(selection, playerId, 'percentiles'),
    queryFn: ({ signal }) => api.getPlayerPercentiles({ params: { playerId } }, { signal }),
  });
}

export function evolutionQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: profileKey(selection, playerId, 'evolution'),
    queryFn: ({ signal }) => api.getPlayerTestEvolution({ params: { playerId } }, { signal }),
  });
}

export function firstTeamReferencesQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: profileKey(selection, playerId, 'firstTeamReferences'),
    queryFn: ({ signal }) => api.getPlayerFirstTeamReferences({ params: { playerId } }, { signal }),
  });
}

export function playerAlertsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: profileKey(selection, playerId, 'alerts'),
    queryFn: ({ signal }) =>
      api.listAlerts(
        { query: { playerId, state: 'all', limit: PROFILE_ALERTS_LIMIT, sort: '-raisedOn' } },
        { signal },
      ),
  });
}
