import type {
  ApiClient,
  InvitationStatus,
  MemberStatus,
  StaffAssignmentStatusFilter,
} from '@sport-performance/contracts';
import type { MembershipRole, SeasonRolloverDecision, Sport } from '@sport-performance/domain';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { ClubSelection } from '../api/club-selection';
import { MAX_PAGE_LIMIT, clubQueryKey, fetchAllPages } from '../api/queries';

/**
 * Queries of the administration (B-411), all under `['club', <selection>,
 * 'admin', …]`: one invalidation per section refreshes it after a change.
 * Lists that grow with the club (members, invitations, assignments,
 * imports, players of a season change) are paged by cursor ("Ver más");
 * the small catalogs (branches, categories, seasons) are read whole.
 */
export function adminKey(selection: ClubSelection | null, ...parts: readonly unknown[]) {
  return clubQueryKey(selection, 'admin', ...parts);
}

/** Rows per page of the paged lists. */
export const ADMIN_PAGE_SIZE = 50;

const withCursor = (cursor: string | undefined) => (cursor === undefined ? {} : { cursor });

const nextCursor = (page: { nextCursor: string | null }) => page.nextCursor ?? undefined;

export interface MemberFilters {
  readonly role: MembershipRole | null;
  readonly status: MemberStatus | 'all';
  readonly q: string;
}

export function membersQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  filters: MemberFilters,
) {
  return infiniteQueryOptions({
    queryKey: adminKey(selection, 'members', filters),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    queryFn: ({ pageParam, signal }) =>
      api.listMembers(
        {
          query: {
            status: filters.status,
            limit: ADMIN_PAGE_SIZE,
            ...(filters.role === null ? {} : { role: filters.role }),
            ...(filters.q === '' ? {} : { q: filters.q }),
            ...withCursor(pageParam),
          },
        },
        { signal },
      ),
  });
}

/**
 * Up to two active admins of the club: whether one is the only one (the API
 * refuses to end it or change its role, so the club is never left without
 * an admin). Under `members`, so a change in the list reads it again.
 */
export function activeAdminsQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: adminKey(selection, 'members', 'active-admins'),
    queryFn: ({ signal }) =>
      api.listMembers({ query: { role: 'admin', status: 'active', limit: 2 } }, { signal }),
  });
}

/** Roles a staff assignment can be given to (ADR 0025, `assigned` scope). */
export const ASSIGNABLE_ROLES = ['coach', 'sc', 'medical'] as const;

/** Active members of the staff roles that see through assignments, for the assignment form. */
export function assignableMembersQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: adminKey(selection, 'members', 'assignable'),
    queryFn: async ({ signal }) => {
      const lists = await Promise.all(
        ASSIGNABLE_ROLES.map((role) =>
          fetchAllPages((cursor) =>
            api.listMembers(
              {
                query: {
                  role,
                  status: 'active',
                  limit: MAX_PAGE_LIMIT,
                  sort: 'name',
                  ...withCursor(cursor),
                },
              },
              { signal },
            ),
          ),
        ),
      );
      return lists.flat();
    },
  });
}

export function invitationsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  status: InvitationStatus | null,
) {
  return infiniteQueryOptions({
    queryKey: adminKey(selection, 'invitations', status ?? 'all'),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    queryFn: ({ pageParam, signal }) =>
      api.listInvitations(
        {
          query: {
            limit: ADMIN_PAGE_SIZE,
            ...(status === null ? {} : { status }),
            ...withCursor(pageParam),
          },
        },
        { signal },
      ),
  });
}

export function assignmentsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  status: StaffAssignmentStatusFilter,
) {
  return infiniteQueryOptions({
    queryKey: adminKey(selection, 'assignments', status),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    queryFn: ({ pageParam, signal }) =>
      api.listStaffAssignments(
        { query: { status, limit: ADMIN_PAGE_SIZE, ...withCursor(pageParam) } },
        { signal },
      ),
  });
}

/** Every branch of the club, active and archived. */
export function branchesQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: adminKey(selection, 'branches'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listClubBranches(
          { query: { status: 'all', limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal },
        ),
      ),
  });
}

/** Every category of the club, active and archived, in the club's order. */
export function allCategoriesQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: adminKey(selection, 'categories'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listCategories(
          { query: { status: 'all', limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal },
        ),
      ),
  });
}

/** Every position of the club, active and archived, in the club's order (B-801). */
export function allPositionsQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: adminKey(selection, 'positions'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listPositions(
          { query: { status: 'all', limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal },
        ),
      ),
  });
}

/** Active seasons of the club (newest first), with their windows. */
export function seasonsQuery(api: ApiClient, selection: ClubSelection | null, sport: Sport | null) {
  return queryOptions({
    queryKey: adminKey(selection, 'seasons', sport ?? 'all'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listSeasons(
          {
            query: {
              status: 'active',
              sort: '-startsOn',
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

export function rolloversQuery(api: ApiClient, selection: ClubSelection | null, seasonId: string) {
  return queryOptions({
    queryKey: adminKey(selection, 'rollovers', 'season', seasonId),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listSeasonRollovers(
          { params: { seasonId }, query: { limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal },
        ),
      ),
  });
}

export function rolloverQuery(api: ApiClient, selection: ClubSelection | null, rolloverId: string) {
  return queryOptions({
    queryKey: adminKey(selection, 'rollovers', 'one', rolloverId),
    queryFn: ({ signal }) => api.getSeasonRollover({ params: { rolloverId } }, { signal }),
  });
}

export interface RolloverItemFilters {
  /** `pending`: ask for a review and were not reviewed; `all`: every player. */
  readonly view: 'pending' | 'all';
  readonly decision: SeasonRolloverDecision | null;
}

export function rolloverItemsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  rolloverId: string,
  filters: RolloverItemFilters,
) {
  return infiniteQueryOptions({
    queryKey: adminKey(selection, 'rollovers', 'items', rolloverId, filters),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    queryFn: ({ pageParam, signal }) =>
      api.listSeasonRolloverItems(
        {
          params: { rolloverId },
          query: {
            limit: ADMIN_PAGE_SIZE,
            ...(filters.view === 'pending' ? { needsReview: 'true', reviewed: 'false' } : {}),
            ...(filters.decision === null ? {} : { decision: filters.decision }),
            ...withCursor(pageParam),
          },
        },
        { signal },
      ),
  });
}

export function rosterImportsQuery(api: ApiClient, selection: ClubSelection | null) {
  return infiniteQueryOptions({
    queryKey: adminKey(selection, 'rosterImports'),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    queryFn: ({ pageParam, signal }) =>
      api.listRosterImports(
        { query: { limit: ADMIN_PAGE_SIZE, ...withCursor(pageParam) } },
        { signal },
      ),
  });
}
