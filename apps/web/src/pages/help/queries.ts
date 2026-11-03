import type { ApiClient } from '@sport-performance/contracts';
import type { Sport } from '@sport-performance/domain';
import { queryOptions } from '@tanstack/react-query';
import type { ClubSelection } from '../../api/club-selection';
import { MAX_PAGE_LIMIT, clubQueryKey, fetchAllPages } from '../../api/queries';

/**
 * Queries of the help section (B-415). Protocols change rarely (a new
 * version is a decision of the club), so they stay fresh for a while; signed
 * download URLs live minutes (ADR 0044), so they are refetched before then.
 */

const withCursor = (cursor: string | undefined) => (cursor === undefined ? {} : { cursor });

/** The protocol versions in force today in the club, of a sport (or every sport). */
export function testDefinitionsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  sport: Sport | null,
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'testDefinitions', 'current', sport ?? 'all'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listTestDefinitions(
          {
            query: {
              limit: MAX_PAGE_LIMIT,
              ...(sport === null ? {} : { sport }),
              ...withCursor(cursor),
            },
          },
          { signal },
        ),
      ),
    staleTime: 10 * 60_000,
  });
}

export function testDefinitionQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  testDefinitionId: string,
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'testDefinitions', 'one', testDefinitionId),
    queryFn: ({ signal }) => api.getTestDefinition({ params: { testDefinitionId } }, { signal }),
    staleTime: 10 * 60_000,
  });
}

/** Key of every media list of a protocol version (invalidated after a change). */
export function protocolMediaKey(selection: ClubSelection | null, testDefinitionId: string) {
  return clubQueryKey(selection, 'testDefinitions', 'media', testDefinitionId);
}

export function protocolMediaQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  testDefinitionId: string,
) {
  return queryOptions({
    queryKey: protocolMediaKey(selection, testDefinitionId),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listProtocolMedia(
          {
            params: { testDefinitionId },
            query: { status: 'active', limit: MAX_PAGE_LIMIT, ...withCursor(cursor) },
          },
          { signal },
        ),
      ),
  });
}

/**
 * A signed download URL (minutes of life). Not refetched in the background,
 * which would restart a playing video: the viewer asks again when the
 * browser fails to load an expired one.
 */
export function fileDownloadQuery(api: ApiClient, selection: ClubSelection | null, fileId: string) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'files', 'download', fileId),
    queryFn: ({ signal }) => api.getFileDownload({ params: { fileId } }, { signal }),
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });
}
