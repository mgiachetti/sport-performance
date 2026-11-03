import type { ApiClient, AnthroMeasurementInput } from '@sport-performance/contracts';
import type { CategoryId, LocalDate, PlayerId } from '@sport-performance/domain';
import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { ClubSelection } from '../../api/club-selection';
import { MAX_PAGE_LIMIT, clubQueryKey, fetchAllPages } from '../../api/queries';

/** Query keys and factories of the anthropometry screen (B-412), scoped by club. */

/** Root of everything anthropometry: a save invalidates it whole (list and preview). */
export function anthropometryKey(selection: ClubSelection | null) {
  return clubQueryKey(selection, 'anthropometry');
}

/** Active players today in the category, by name: the rows of the sheet. */
export function categoryPlayersQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  categoryId: CategoryId,
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'players', { categoryId, status: 'active' }),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listPlayers(
          {
            query: {
              categoryId,
              status: 'active',
              sort: 'name',
              limit: MAX_PAGE_LIMIT,
              ...(cursor === undefined ? {} : { cursor }),
            },
          },
          { signal },
        ),
      ),
  });
}

type PreviewRow = Pick<
  AnthroMeasurementInput,
  'playerId' | 'heightCm' | 'sittingHeightCm' | 'weightKg' | 'skinfoldsSumMm'
> & {
  measuredOn: LocalDate;
};

/**
 * Maturation of the sheet while typing: keyed by what is sent, the previous
 * answer stays on screen while the next one comes (no flicker per key). It
 * writes nothing, so the API counts it in the read budget.
 */
export function previewQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  rows: readonly PreviewRow[],
) {
  return queryOptions({
    queryKey: [...anthropometryKey(selection), 'preview', rows] as const,
    queryFn: ({ signal }) =>
      api.previewAnthroMeasurements({ body: { measurements: [...rows] } }, { signal }),
    enabled: rows.length > 0,
    placeholderData: keepPreviousData,
    // Only what is sent and the player's data change the answer: a save or the parents'
    // heights invalidate it (`anthropometryKey`); no refetch of the whole squad on a timer.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export const RECENT_PAGE_SIZE = 25;

/** Latest measurements of the category (by the category of the player on each day). */
export function recentMeasurementsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  categoryId: CategoryId,
) {
  return infiniteQueryOptions({
    queryKey: [...anthropometryKey(selection), 'list', { categoryId }] as const,
    queryFn: ({ signal, pageParam }) =>
      api.listAnthroMeasurements(
        {
          query: {
            categoryId,
            sort: '-measuredOn',
            limit: RECENT_PAGE_SIZE,
            ...(pageParam === undefined ? {} : { cursor: pageParam }),
          },
        },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function parentHeightsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'players', playerId, 'parentHeights'),
    queryFn: ({ signal }) => api.getPlayerParentHeights({ params: { playerId } }, { signal }),
  });
}
