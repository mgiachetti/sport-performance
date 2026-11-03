import type { ApiClient, ConsentDocument } from '@sport-performance/contracts';
import type { PlayerId } from '@sport-performance/domain';
import { queryOptions } from '@tanstack/react-query';
import type { ClubSelection } from '../api/club-selection';
import { MAX_PAGE_LIMIT, clubQueryKey, fetchAllPages } from '../api/queries';

/**
 * Queries of the family area (B-413, ADR 0065). Everything is keyed by the
 * club selection, like every club query, so a guardian of two clubs never
 * sees one club's children in the other.
 */

const withCursor = (cursor: string | undefined) => (cursor === undefined ? {} : { cursor });

/** The guardian's children in the active club, whole (the layout builds the subject from them). */
export function childrenQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'me', 'children'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listMyChildren({ query: { limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } }, { signal }),
      ),
  });
}

export function childPlayerQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'players', playerId, 'profile'),
    queryFn: ({ signal }) => api.getPlayer({ params: { playerId } }, { signal }),
  });
}

export function childConsentsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'players', playerId, 'consents'),
    queryFn: ({ signal }) => api.getPlayerConsents({ params: { playerId } }, { signal }),
  });
}

/** Every signature of the child (current and revoked), newest first. */
export function childConsentHistoryQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  playerId: PlayerId,
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'players', playerId, 'consents', 'history'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listPlayerConsentHistory(
          { params: { playerId }, query: { limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal },
        ),
      ),
  });
}

export function consentDocumentQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  documentId: ConsentDocument['id'],
) {
  return queryOptions({
    queryKey: clubQueryKey(selection, 'consentDocuments', documentId),
    queryFn: ({ signal }) => api.getConsentDocument({ params: { documentId } }, { signal }),
    // A published text never changes (ADR 0043).
    staleTime: Number.POSITIVE_INFINITY,
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
