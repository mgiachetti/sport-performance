import type { ApiClient } from '@sport-performance/contracts';
import type { ClubId } from '@sport-performance/domain';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { MAX_PAGE_LIMIT, fetchAllPages } from '../api/queries';
import { clubSupportHeaders, registryHeaders } from './console-reason';

/**
 * Queries of the superadmin console (ADR 0066), under their own root
 * `['console', …]`: they do not depend on the club selection, and a sign-out
 * (`queryClient.clear()`) drops them with the rest. The reason is not part
 * of the key: it only travels for the audit.
 */
export const CONSOLE_PAGE_SIZE = 25;

const withCursor = (cursor: string | undefined) => (cursor === undefined ? {} : { cursor });

export const consoleKeys = {
  all: ['console'] as const,
  clubs: (q: string) => ['console', 'clubs', q] as const,
  club: (clubId: ClubId) => ['console', 'club', clubId] as const,
  supportAccess: (filters: SupportAccessFilters) => ['console', 'supportAccess', filters] as const,
};

export interface SupportAccessFilters {
  readonly clubId?: ClubId | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export function consoleClubsQuery(api: ApiClient, reason: string, q: string) {
  return infiniteQueryOptions({
    queryKey: consoleKeys.clubs(q),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api.listClubs(
        {
          query: {
            limit: CONSOLE_PAGE_SIZE,
            ...(q === '' ? {} : { q }),
            ...withCursor(pageParam),
          },
        },
        { signal, headers: registryHeaders(reason) },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function consoleClubProfileQuery(api: ApiClient, reason: string, clubId: ClubId) {
  return queryOptions({
    queryKey: [...consoleKeys.club(clubId), 'profile'] as const,
    queryFn: ({ signal }) =>
      api.getClub(undefined, { signal, headers: clubSupportHeaders(clubId, reason) }),
  });
}

export function consoleClubBranchesQuery(api: ApiClient, reason: string, clubId: ClubId) {
  return queryOptions({
    queryKey: [...consoleKeys.club(clubId), 'branches'] as const,
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listClubBranches(
          { query: { status: 'all', limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal, headers: clubSupportHeaders(clubId, reason) },
        ),
      ),
  });
}

export function consoleClubModulesQuery(api: ApiClient, reason: string, clubId: ClubId) {
  return queryOptions({
    queryKey: [...consoleKeys.club(clubId), 'modules'] as const,
    queryFn: ({ signal }) =>
      api.getClubModules(undefined, { signal, headers: clubSupportHeaders(clubId, reason) }),
  });
}

export function consoleClubInvitationsQuery(api: ApiClient, reason: string, clubId: ClubId) {
  return queryOptions({
    queryKey: [...consoleKeys.club(clubId), 'invitations', 'pending'] as const,
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listInvitations(
          { query: { status: 'pending', limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal, headers: clubSupportHeaders(clubId, reason) },
        ),
      ),
  });
}

export function consoleSupportAccessQuery(
  api: ApiClient,
  reason: string,
  filters: SupportAccessFilters,
) {
  return infiniteQueryOptions({
    queryKey: consoleKeys.supportAccess(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api.listSupportAccess(
        {
          query: {
            limit: CONSOLE_PAGE_SIZE,
            ...(filters.clubId === undefined ? {} : { clubId: filters.clubId }),
            ...(filters.from === undefined ? {} : { from: filters.from }),
            ...(filters.to === undefined ? {} : { to: filters.to }),
            ...withCursor(pageParam),
          },
        },
        { signal, headers: registryHeaders(reason) },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // Always fresh: the log grows with every request of the console itself.
    staleTime: 0,
  });
}
