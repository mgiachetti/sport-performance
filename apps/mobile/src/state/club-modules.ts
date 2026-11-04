import type { ClubModules } from '@sport-performance/domain';
import { useEffect, useRef } from 'react';
import { CLUB_MODULES_READ, effectiveClubModules, pulledCollections } from '../clubs/modules.ts';
import { useServices } from './app-context.tsx';
import { useOfflineRead } from './offline-reads.ts';

/**
 * The active modules of the club the app acts in (issue #215): the API's
 * answer, or the one the phone kept, or the defaults before any. When what
 * the sync should pull changes (the club turned the gym off or on), a
 * cycle runs at once: the engine reads the kept modules
 * (`clubs/modules.ts`) and the server starts the cursor over.
 */
export function useClubModules(): ClubModules {
  const services = useServices();
  const read = useOfflineRead({
    key: CLUB_MODULES_READ,
    fetch: (signal) => services.api.client.getClubModules(undefined, { signal }),
    staleTimeMs: 5 * 60_000,
  });
  const modules = effectiveClubModules(read.value?.modules);
  const pulled = pulledCollections(modules).join(',');
  // What the engine pulled with last: the kept modules (or the defaults) until an answer.
  const previous = useRef(pulled);
  const { sync } = services;
  const live = read.value !== undefined && !read.fromCache;
  useEffect(() => {
    if (previous.current === pulled) return;
    previous.current = pulled;
    // The engine reads the kept answer, which the live one already replaced.
    if (live) sync.requestSync();
  }, [pulled, live, sync]);
  return modules;
}
