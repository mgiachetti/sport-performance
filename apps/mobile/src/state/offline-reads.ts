import { ApiContractError } from '@sport-performance/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { readCacheKey } from '../offline/read-cache.ts';
import { useServices, useSession, useSyncStatus } from './app-context.tsx';

/** A read the screen shows: the API's answer, or the last one the phone kept. */
export interface OfflineRead<T> {
  readonly value: T | undefined;
  /** When the shown value was fetched (epoch ms); `null` before any. */
  readonly fetchedAt: number | null;
  /** The value is the kept one: the API did not answer (yet, or at all). */
  readonly fromCache: boolean;
  readonly loading: boolean;
  /** The API failed and there is nothing kept to show. */
  readonly error: unknown;
  readonly refetch: () => void;
}

interface Scope {
  readonly membershipId: string;
  readonly userId: string;
}

function useScope(): Scope | null {
  const state = useSession();
  if (state.status !== 'signedIn' || state.activeMembership === null) return null;
  return { membershipId: state.activeMembership.id, userId: state.user.id };
}

/**
 * An API read that must also work without signal (ADR 0071): the last
 * answer kept in the local database is shown at once, the API is asked in
 * the background and its answer replaces it and is kept for next time. Both
 * queries, and the kept answer, are keyed by the read and its parameters
 * (`readCacheKey`) and by the membership, so another range or another club
 * never answers this one.
 */
export function useOfflineRead<T>(options: {
  /** The read (`PLAYER_READS`). */
  readonly key: string;
  /** Its parameters (the club days of a range): another value is another read. */
  readonly params?: readonly unknown[];
  readonly fetch: (signal: AbortSignal) => Promise<T>;
  readonly enabled?: boolean;
  readonly staleTimeMs?: number;
}): OfflineRead<T> {
  const services = useServices();
  const scope = useScope();
  const enabled = scope !== null && (options.enabled ?? true);
  const membershipId = scope?.membershipId ?? null;
  const key = readCacheKey(options.key, options.params);
  const kept = useQuery({
    queryKey: ['club', membershipId, 'kept', key],
    queryFn: () => (scope === null ? null : services.readCache.get<T>(scope.membershipId, key)),
    enabled,
    staleTime: Infinity,
  });
  const live = useQuery({
    queryKey: ['club', membershipId, 'live', key],
    queryFn: async ({ signal }) => {
      const value = await options.fetch(signal);
      const fetchedAt = Date.now();
      if (scope !== null) {
        await services.readCache.put(scope, key, value, fetchedAt).catch(services.reportError);
      }
      return { value, fetchedAt };
    },
    enabled,
    staleTime: options.staleTimeMs ?? 60_000,
  });
  const contractError = live.error instanceof ApiContractError ? live.error : null;
  useEffect(() => {
    // An off-contract answer is a bug: reported, the kept value (if any) stays.
    if (contractError !== null) services.reportError(contractError);
  }, [contractError, services]);

  const { refetch: refetchLive } = live;
  const refetch = useCallback(() => {
    void refetchLive();
  }, [refetchLive]);

  const cached = kept.data ?? null;
  const value = live.data?.value ?? cached?.value;
  return {
    value,
    fetchedAt: live.data?.fetchedAt ?? cached?.fetchedAt ?? null,
    fromCache: live.data === undefined && cached !== null,
    loading: value === undefined && (live.isPending || kept.isPending) && enabled,
    error: value === undefined && live.isError ? live.error : null,
    refetch,
  };
}

/**
 * Reads of the local database, run again whenever the queue or the last
 * sync change (a write queued, a cycle that pulled rows): what the screen
 * shows always includes what the player just loaded.
 */
export function useLocalRead<T>(
  load: (membershipId: string) => Promise<T>,
  /** What the read depends on besides the membership (the player, the sessions). */
  key: string,
): { readonly value: T | undefined; readonly reload: () => void } {
  const { reportError } = useServices();
  const scope = useScope();
  const status = useSyncStatus();
  const [value, setValue] = useState<T | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const membershipId = scope?.membershipId ?? null;
  useEffect(() => {
    if (membershipId === null) return;
    let active = true;
    load(membershipId)
      .then((next) => {
        if (active) setValue(next);
      })
      .catch(reportError);
    return () => {
      active = false;
    };
    // `load` is a new closure on each render; what it reads is named by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    membershipId,
    status.pendingCount,
    status.lastSyncedAt,
    status.issueCount,
    tick,
    reportError,
    key,
  ]);
  return {
    value,
    reload: () => {
      setTick((n) => n + 1);
    },
  };
}
