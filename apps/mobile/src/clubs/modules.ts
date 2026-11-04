import { clubModuleSettingsSchema } from '@sport-performance/contracts';
import {
  DEFAULT_CLUB_MODULES,
  SYNC_COLLECTIONS,
  type ClubModule,
  type ClubModules,
  type SyncCollection,
} from '@sport-performance/domain';
import type { ReadCache } from '../offline/read-cache.ts';

/**
 * The club's active modules on the phone (B-322, issue #215): read from
 * `GET /v1/configuration/modules` (every member reads it), kept in the read
 * cache of the membership (ADR 0074) so the app knows them without signal.
 * Never read: the domain's defaults, the same ones the server answers for a
 * club that never changed them.
 */

/** Read-cache key of the modules (`useOfflineRead`). */
export const CLUB_MODULES_READ = 'club.modules';

/**
 * The sync collections that belong to a module: with it off, the app stops
 * pulling them (and drops what it kept). A module goes here once the app's
 * screens hide with it; the gym (B-607) is the first.
 */
export const MODULE_SYNC_COLLECTIONS: Readonly<
  Partial<Record<ClubModule, readonly SyncCollection[]>>
> = {
  gym: ['gym_program', 'gym_set'],
};

/** The modules the app acts on: the kept ones, else the defaults. */
export function effectiveClubModules(kept: ClubModules | null | undefined): ClubModules {
  return kept ?? DEFAULT_CLUB_MODULES;
}

/** The collections to pull with these modules: every one but those of a module that is off. */
export function pulledCollections(modules: ClubModules): SyncCollection[] {
  const off = new Set<SyncCollection>();
  for (const [module, collections] of Object.entries(MODULE_SYNC_COLLECTIONS) as [
    ClubModule,
    readonly SyncCollection[],
  ][]) {
    if (!modules[module]) for (const collection of collections) off.add(collection);
  }
  return SYNC_COLLECTIONS.filter((collection) => !off.has(collection));
}

/** The modules the phone kept for a membership; `null` if it never read them (or an older build wrote them). */
export async function keptClubModules(
  cache: Pick<ReadCache, 'get'>,
  membershipId: string,
): Promise<ClubModules | null> {
  const kept = await cache.get(membershipId, CLUB_MODULES_READ, clubModuleSettingsSchema);
  return kept?.value.modules ?? null;
}
