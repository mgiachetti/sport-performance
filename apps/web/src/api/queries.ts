import type { ApiClient, Page } from '@sport-performance/contracts';
import {
  queryOptions,
  type QueryClient,
  type QueryFunction,
  type QueryKey,
  type SkipToken,
} from '@tanstack/react-query';
import { selectionKey, type ClubSelection } from './club-selection';

/**
 * Query keys (ADR 0057). Three roots, so one call clears what must go:
 *
 * - `['session', …]`: the signed-in user (`me`, memberships);
 * - `['public', …]`: no personal data (the club theme);
 * - `['club', <selection>, …]`: everything of the club the request acts in,
 *   keyed by the selection so data of one club never answers another.
 *
 * Screens declare their queries with {@link clubQueryKey} and a factory like
 * the ones below, next to the screen.
 */
export function clubQueryKey(selection: ClubSelection | null, ...parts: readonly unknown[]) {
  return ['club', selectionKey(selection), ...parts] as const;
}

/**
 * Cached data if there is any (however old), else fetch: what route
 * `beforeLoad`/`loader` need so navigating stays instant. Observers on the
 * screen refetch stale data in the background.
 */
export function ensureQuery<TQueryFnData, TQueryKey extends QueryKey>(
  client: QueryClient,
  options: {
    queryKey: TQueryKey;
    queryFn?: QueryFunction<TQueryFnData, TQueryKey> | SkipToken | undefined;
  },
): Promise<TQueryFnData> {
  const { queryKey, queryFn } = options;
  if (queryFn === undefined) throw new Error('ensureQuery needs a queryFn');
  return client.query({ queryKey, queryFn, staleTime: 'static' });
}

/** Largest page the API serves (ADR 0032). */
export const MAX_PAGE_LIMIT = 100;

/**
 * Follows `nextCursor` until the end, for the small catalogs the shell needs
 * whole (categories, assignments). `maxPages` bounds a runaway cursor.
 */
export async function fetchAllPages<Item>(
  fetchPage: (cursor: string | undefined) => Promise<Page<Item>>,
  maxPages = 20,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (result.nextCursor === null) return items;
    cursor = result.nextCursor;
  }
  throw new Error(`More than ${String(maxPages)} pages: refusing to load the whole list`);
}

const withCursor = (cursor: string | undefined) => (cursor === undefined ? {} : { cursor });

export function meQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: ['session', 'me', selectionKey(selection)] as const,
    queryFn: ({ signal }) => api.getMe(undefined, { signal }),
  });
}

export function membershipsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: ['session', 'memberships'] as const,
    queryFn: ({ signal }) => api.listMyMemberships(undefined, { signal }),
  });
}

export function clubThemeQuery(api: ApiClient, clubSlug: string) {
  return queryOptions({
    queryKey: ['public', 'clubTheme', clubSlug] as const,
    queryFn: ({ signal }) => api.getClubTheme({ params: { clubSlug } }, { signal }),
    staleTime: 5 * 60_000,
  });
}

export function clubProfileQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'profile'),
    queryFn: ({ signal }) => api.getClub(undefined, { signal }),
  });
}

/**
 * Current assignments of the acting membership: what a coach, S&C or medical
 * staff sees. Roles not scoped by assignments (`scoped: false`) get an empty
 * list without asking the API.
 */
export function myAssignmentsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  scoped: boolean,
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'me', 'staffAssignments', scoped ? 'current' : 'unscoped'),
    queryFn: ({ signal }) =>
      scoped
        ? fetchAllPages((cursor) =>
            api.listMyStaffAssignments(
              { query: { status: 'current', limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
              { signal },
            ),
          )
        : Promise.resolve([]),
  });
}

/** Active categories the acting role sees (the API scopes them by assignment). */
export function categoriesQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'categories', 'active'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listCategories(
          { query: { status: 'active', limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal },
        ),
      ),
  });
}

/** Registry of clubs for the superadmin's support mode (needs the reason header). */
export function supportClubsQuery(
  api: ApiClient,
  reasonHeaders: Record<string, string>,
  q: string,
) {
  return queryOptions({
    queryKey: ['session', 'supportClubs', q] as const,
    queryFn: ({ signal }) =>
      api.listClubs(
        { query: { limit: 25, ...(q === '' ? {} : { q }) } },
        { signal, headers: reasonHeaders },
      ),
    staleTime: 0,
  });
}
