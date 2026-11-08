import { ApiError, type ApiClient } from '@sport-performance/contracts';
import type { MessageKey } from '@sport-performance/i18n';
import { queryOptions } from '@tanstack/react-query';
import type { ClubSelection } from '../api/club-selection';
import { MAX_PAGE_LIMIT, clubQueryKey, fetchAllPages } from '../api/queries';

/**
 * Queries of the pods (B-912, ADR 0106), under `['club', <selection>,
 * 'pods', …]`: a change of the fleet or of an assignment invalidates the
 * whole subtree. The fleet of a club is small (a few dozen pods): read whole.
 */
export function podsKey(selection: ClubSelection | null, ...parts: readonly unknown[]) {
  return clubQueryKey(selection, 'pods', ...parts);
}

/** The pods in the fleet (every one but the retired ones), by number. */
export function fleetQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: podsKey(selection, 'fleet'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listPods(
          {
            query: {
              status: 'in_fleet',
              limit: MAX_PAGE_LIMIT,
              ...(cursor === undefined ? {} : { cursor }),
            },
          },
          { signal },
        ),
      ),
  });
}

export function podCategoriesQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: podsKey(selection, 'categories'),
    queryFn: ({ signal }) => api.listPodCategories(undefined, { signal }),
  });
}

export function sessionPodsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  trainingSessionId: string,
) {
  return queryOptions({
    queryKey: podsKey(selection, 'session', trainingSessionId),
    queryFn: ({ signal }) => api.getSessionPods({ params: { trainingSessionId } }, { signal }),
  });
}

/** Conflict details the API gives an assignment (`409`), with their texts. */
const ASSIGNMENT_CONFLICTS = {
  pod_overlap: 'pods.error.pod_overlap',
  player_overlap: 'pods.error.player_overlap',
  pod_not_active: 'pods.error.pod_not_active',
  category_not_enabled: 'pods.error.category_not_enabled',
} as const satisfies Record<string, MessageKey>;

/**
 * The text of a failed assignment write: the conflict it names (overlap,
 * pod not active, category without pods), a missing consent, or a plain
 * conflict (someone changed it). `null` for any other error, which the
 * caller shows with its error envelope.
 */
export function assignmentErrorKey(error: unknown): MessageKey | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'consent_required') return 'pods.error.consent_required';
  if (error.code !== 'conflict') return null;
  for (const issue of error.details) {
    if (Object.hasOwn(ASSIGNMENT_CONFLICTS, issue.code)) {
      return ASSIGNMENT_CONFLICTS[issue.code as keyof typeof ASSIGNMENT_CONFLICTS];
    }
  }
  return 'pods.error.conflict';
}

/** Whether the API asked for the reason of a correction (`validation_failed` on `changeReason`). */
export function isReasonError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code === 'validation_failed' &&
    error.details.some((issue) => issue.path[0] === 'body' && issue.path[1] === 'changeReason')
  );
}
