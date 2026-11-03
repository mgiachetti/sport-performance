import type { ApiClient } from '@sport-performance/contracts';
import type { CategoryId, Sex, Sport, Stage } from '@sport-performance/domain';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { ClubSelection } from '../api/club-selection';
import { MAX_PAGE_LIMIT, clubQueryKey, fetchAllPages } from '../api/queries';

/**
 * Queries of the configuration screen (B-409). Every key hangs from
 * `['club', <selection>, 'configuration', …]`, so a write invalidates the
 * whole screen of that club with {@link invalidateConfiguration}.
 */

const withCursor = (cursor: string | undefined) => (cursor === undefined ? {} : { cursor });

function key(selection: ClubSelection | null, ...parts: readonly unknown[]) {
  return clubQueryKey(selection, 'configuration', ...parts);
}

export function invalidateConfiguration(
  queryClient: QueryClient,
  selection: ClubSelection | null,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: key(selection) });
}

/**
 * Active branches (sport + sex) of the club: every member reads them, so
 * the screen knows the club's real branches, not only the ones the role is
 * assigned to.
 */
export function clubBranchesQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: key(selection, 'branches'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listClubBranches(
          { query: { status: 'active', limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal },
        ),
      ),
    staleTime: 5 * 60_000,
  });
}

export function catalogTestsQuery(api: ApiClient, selection: ClubSelection | null, sport: Sport) {
  return queryOptions({
    queryKey: key(selection, 'catalogTests', sport),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listCatalogTests(
          { query: { sport, limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal },
        ),
      ),
    staleTime: 5 * 60_000,
  });
}

export function catalogMetricsQuery(api: ApiClient, selection: ClubSelection | null, sport: Sport) {
  return queryOptions({
    queryKey: key(selection, 'catalogMetrics', sport),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listCatalogMetrics(
          { query: { sport, status: 'active', limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal },
        ),
      ),
    staleTime: 5 * 60_000,
  });
}

export interface BatteryGroup {
  readonly sport: Sport;
  readonly sex: Sex;
  readonly stage: Stage;
  readonly categoryId: CategoryId | null;
}

export function effectiveBatteryQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  group: BatteryGroup,
) {
  return queryOptions({
    queryKey: key(selection, 'battery', 'effective', group),
    queryFn: ({ signal }) =>
      api.getEffectiveBattery(
        {
          query: {
            sport: group.sport,
            sex: group.sex,
            stage: group.stage,
            ...(group.categoryId === null ? {} : { categoryId: group.categoryId }),
          },
        },
        { signal },
      ),
  });
}

export function batteryEntriesQuery(api: ApiClient, selection: ClubSelection | null, sport: Sport) {
  return queryOptions({
    queryKey: key(selection, 'battery', 'entries', sport),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listBatteryEntries(
          {
            query: {
              sport,
              status: 'active',
              sort: 'testCode',
              limit: MAX_PAGE_LIMIT,
              ...withCursor(cursor),
            },
          },
          { signal },
        ),
      ),
  });
}

export type SpeedZoneKind = 'absolute' | 'relative';

export function effectiveZonesQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  options: { kind: SpeedZoneKind; sport: Sport; sex: Sex },
) {
  return queryOptions({
    queryKey: key(selection, 'speedZones', 'effective', options),
    queryFn: ({ signal }) => api.getEffectiveSpeedZones({ query: options }, { signal }),
  });
}

export function zoneConfigsQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  options: { kind: SpeedZoneKind; sport: Sport; sex: Sex },
) {
  return queryOptions({
    queryKey: key(selection, 'speedZones', 'history', options),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listSpeedZoneConfigs(
          {
            query: {
              ...options,
              scope: 'group',
              status: 'all',
              sort: '-validFrom',
              limit: MAX_PAGE_LIMIT,
              ...withCursor(cursor),
            },
          },
          { signal },
        ),
      ),
  });
}

export function alertRulesQuery(api: ApiClient, selection: ClubSelection | null) {
  return queryOptions({
    queryKey: key(selection, 'alertRules'),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listAlertRules(
          { query: { sort: 'code', limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal },
        ),
      ),
  });
}

export function referencesQuery(
  api: ApiClient,
  selection: ClubSelection | null,
  options: { sport: Sport; sex: Sex; status: 'active' | 'archived' },
) {
  return queryOptions({
    queryKey: key(selection, 'references', options),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listReferenceValues(
          {
            query: {
              ...options,
              sort: 'metricCode',
              limit: MAX_PAGE_LIMIT,
              ...withCursor(cursor),
            },
          },
          { signal },
        ),
      ),
  });
}

export function positionsQuery(api: ApiClient, selection: ClubSelection | null, sport: Sport) {
  return queryOptions({
    queryKey: key(selection, 'positions', sport),
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listPositions(
          { query: { sport, limit: MAX_PAGE_LIMIT, ...withCursor(cursor) } },
          { signal },
        ),
      ),
    staleTime: 5 * 60_000,
  });
}
