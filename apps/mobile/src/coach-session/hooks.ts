import type { MembershipSummary } from '@sport-performance/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { SyncScopeRef } from '../offline/engine.ts';
import { useApi, useServices, useSession, useSyncStatus } from '../state/app-context.tsx';
import { CLUB_KEY, coachClubSchema, refreshCoachClub, type CoachClub } from './data.ts';

type MembershipRole = MembershipSummary['role'];

/** Whose data the screen reads: the user and the active membership (`null` without one). */
export function useCoachScope(): (SyncScopeRef & { readonly role: MembershipRole }) | null {
  const state = useSession();
  if (state.status !== 'signedIn' || state.activeMembership === null) return null;
  return {
    membershipId: state.activeMembership.id,
    userId: state.user.id,
    role: state.activeMembership.role,
  };
}

/**
 * A read of the local database, run again whenever the queue or the last
 * sync change (a write queued, a cycle that pulled rows) or `key` does: what
 * the screen shows always includes what was just loaded on the phone.
 */
export function useLocalRead<T>(
  membershipId: string | null,
  key: string,
  load: (membershipId: string) => Promise<T>,
): { readonly value: T | undefined; readonly reload: () => Promise<void> } {
  const { reportError } = useServices();
  const status = useSyncStatus();
  const [state, setState] = useState<{ key: string; value: T } | undefined>(undefined);
  const fullKey = `${membershipId ?? ''}|${key}`;
  const loadRef = useRef(load);
  useEffect(() => {
    // The latest closure, before the read below runs (effects run in order).
    loadRef.current = load;
  });
  useEffect(() => {
    if (membershipId === null) return;
    let active = true;
    loadRef
      .current(membershipId)
      .then((value) => {
        if (active) setState({ key: fullKey, value });
      })
      .catch(reportError);
    return () => {
      active = false;
    };
    // What `load` reads is named by `key` (and the membership).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey, status.pendingCount, status.lastSyncedAt, status.issueCount, reportError]);
  return {
    // Never the value of another membership or key while the new one loads.
    value: state?.key === fullKey ? state.value : undefined,
    /** Reads again now; resolves once the screen has the new value. */
    reload: async () => {
      if (membershipId === null) return;
      const value = await loadRef.current(membershipId);
      setState({ key: fullKey, value });
    },
  };
}

/**
 * The club's time zone and category names: the copy on the phone at once,
 * refreshed from the API when there is signal and kept for next time.
 */
export function useCoachClub(scope: SyncScopeRef | null): CoachClub | null {
  const services = useServices();
  const api = useApi();
  const membershipId = scope?.membershipId ?? null;
  const kept = useLocalRead(membershipId, CLUB_KEY, (id) =>
    services.readCache.get(id, CLUB_KEY, coachClubSchema),
  );
  const live = useQuery({
    queryKey: [membershipId, 'coachSession', 'club'],
    enabled: scope !== null,
    staleTime: 60 * 60_000,
    queryFn: ({ signal }) =>
      scope === null ? null : refreshCoachClub(api, services.readCache, scope, signal),
  });
  return live.data ?? kept.value?.value ?? null;
}
