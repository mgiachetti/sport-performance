import type { AlertDetailDto, Category, WeeklyPanel } from '@sport-performance/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { fetchAllPages, ROSTER_PAGE_LIMIT } from '../ift/roster.ts';
import type { PushState } from '../notifications/registration.ts';
import { readCacheKey } from '../offline/read-cache.ts';
import { BOARD_PANEL_WEEKS } from '../staff/board.ts';
import { useServices } from './app-context.tsx';
import { useLocalRead, useOfflineRead, type OfflineRead } from './offline-reads.ts';

/**
 * The reads of the staff on the phone (B-510, ADR 0081): API answers kept in
 * the local database (`useOfflineRead`) so they open without signal, and the
 * rows the sync brought (`useLocalRead`).
 */
export const STAFF_READS = {
  panel: 'staff.panel',
  categories: 'staff.categories',
  alert: 'staff.alert',
} as const;

/** The weekly panel of the current week, with the minimum of history (it only reads today). */
export function useStaffPanel(enabled: boolean): OfflineRead<WeeklyPanel> {
  const { api } = useServices();
  return useOfflineRead({
    key: STAFF_READS.panel,
    enabled,
    staleTimeMs: 60_000,
    fetch: (signal) =>
      api.client.getWeeklyPanel({ query: { weeks: BOARD_PANEL_WEEKS } }, { signal }),
  });
}

/** The categories the staff sees (names for the rows and the filter). */
export function useStaffCategories(enabled: boolean): OfflineRead<Category[]> {
  const { api } = useServices();
  return useOfflineRead({
    key: STAFF_READS.categories,
    enabled,
    staleTimeMs: 60 * 60_000,
    fetch: (signal) =>
      fetchAllPages((cursor) =>
        api.client.listCategories(
          {
            query: {
              status: 'active',
              limit: ROSTER_PAGE_LIMIT,
              ...(cursor === undefined ? {} : { cursor }),
            },
          },
          { signal },
        ),
      ),
  });
}

/** One alert with its history; the kept answer is the last alert opened. */
export function useStaffAlert(alertId: string, enabled: boolean): OfflineRead<AlertDetailDto> {
  const { api } = useServices();
  return useOfflineRead({
    key: STAFF_READS.alert,
    params: [alertId],
    enabled,
    staleTimeMs: 30_000,
    fetch: (signal) => api.client.getAlert({ params: { alertId } }, { signal }),
  });
}

/**
 * Players with a wellness row of `day` on the device: the sync keeps pulling
 * after the panel was read, so a check-in that arrived later counts.
 */
export function useWellnessPlayersOn(day: string | null): ReadonlySet<string> {
  const { sync } = useServices();
  const { value } = useLocalRead(
    async (membershipId) => {
      if (day === null) return new Set<string>();
      const rows = await sync.store.list(membershipId, 'wellness', { from: day, to: day });
      return new Set(rows.map((row) => row.data.playerId));
    },
    `wellness:${day ?? ''}`,
  );
  return useMemo(() => value ?? new Set<string>(), [value]);
}

/** The category of a training session the device synced (the summary before training). */
export function useSessionCategory(sessionId: string | null): {
  readonly categoryId: string | null;
  readonly title: string | null;
} | null {
  const { sync } = useServices();
  const { value } = useLocalRead(
    async (membershipId) => {
      if (sessionId === null) return null;
      const row = await sync.store.get(membershipId, 'training_session', { id: sessionId });
      return row === null ? null : { categoryId: row.data.categoryId, title: row.data.title };
    },
    `session:${sessionId ?? ''}`,
  );
  return value ?? null;
}

/** Drops the live answers of the board and of an alert, after a review. */
export function useInvalidateStaffReads(): (membershipId: string, alertId: string) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (membershipId, alertId) => {
      for (const key of [
        readCacheKey(STAFF_READS.panel),
        readCacheKey(STAFF_READS.alert, [alertId]),
      ]) {
        void queryClient.invalidateQueries({ queryKey: ['club', membershipId, 'live', key] });
      }
    },
    [queryClient],
  );
}

/** The push state of this phone (B-510). */
export function usePushState(): PushState {
  const { push } = useServices();
  return useSyncExternalStore(push.subscribe, push.getState, push.getState);
}
