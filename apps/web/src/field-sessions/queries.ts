import type { ApiClient, FieldSessionListItem, Page } from '@sport-performance/contracts';
import type { CategoryId, Sport } from '@sport-performance/domain';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { ClubSelection } from '../api/club-selection';
import { clubQueryKey } from '../api/queries';

/** Queries of the field session view (B-408), keyed by the club selection (ADR 0057). */

export interface FieldSessionFilters {
  readonly sport: Sport | null;
  readonly categoryId: CategoryId | null;
  readonly kind: 'training' | 'match' | null;
}

export const FIELD_SESSIONS_PAGE_SIZE = 25;

export function fieldSessionsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  filters: FieldSessionFilters,
) {
  return infiniteQueryOptions({
    queryKey: clubQueryKey(selection, 'fieldSessions', 'list', filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<Page<FieldSessionListItem>> =>
      api.listFieldSessions(
        {
          query: {
            limit: FIELD_SESSIONS_PAGE_SIZE,
            ...(pageParam === undefined ? {} : { cursor: pageParam }),
            ...(filters.sport === null ? {} : { sport: filters.sport }),
            ...(filters.categoryId === null ? {} : { categoryId: filters.categoryId }),
            ...(filters.kind === null ? {} : { kind: filters.kind }),
          },
        },
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function fieldSessionQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  trainingSessionId: string,
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'fieldSessions', 'detail', trainingSessionId),
    queryFn: ({ signal }) =>
      api.getTrainingSessionFieldMetrics({ params: { trainingSessionId } }, { signal }),
  });
}

/** Active modules of the club (B-322): the view says so when `gps` is off. */
export function clubModulesQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'configuration', 'modules'),
    queryFn: ({ signal }) => api.getClubModules(undefined, { signal }),
    staleTime: 5 * 60_000,
  });
}
