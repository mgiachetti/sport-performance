import {
  createApiClient,
  type ClubModuleSettings,
  type SyncChange,
} from '@sport-performance/contracts';
import {
  DEFAULT_CLUB_MODULES,
  SYNC_COLLECTIONS,
  type ClubModules,
  type SyncCollection,
} from '@sport-performance/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../offline/db/database.ts';
import { createSyncEngine } from '../offline/engine.ts';
import { createReadCache } from '../offline/read-cache.ts';
import { createFakeApi } from '../test/fake-api.ts';
import { T0, createFakeSyncServer, upsert, uuid, wellnessDto } from '../test/fake-sync-server.ts';
import { programDto } from '../test/gym-fixtures.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import {
  CLUB_MODULES_READ,
  effectiveClubModules,
  keptClubModules,
  MODULE_SYNC_COLLECTIONS,
  pulledCollections,
} from './modules.ts';

const SCOPE = { membershipId: 'a1111111-1111-4111-8111-111111111111', userId: 'u1' };
const OTHER_CLUB = { membershipId: 'a2222222-2222-4222-8222-222222222222', userId: 'u1' };
const GYM_OFF: ClubModules = { ...DEFAULT_CLUB_MODULES, gym: false };

const settings = (modules: ClubModules): ClubModuleSettings => ({
  modules,
  version: '1793586338688123',
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('club modules on the phone', () => {
  it('pulls every collection but the gym ones when the gym is off', () => {
    expect(pulledCollections(DEFAULT_CLUB_MODULES)).toEqual([...SYNC_COLLECTIONS]);
    expect(pulledCollections(GYM_OFF)).toEqual(
      SYNC_COLLECTIONS.filter((c) => c !== 'gym_program' && c !== 'gym_set'),
    );
    expect(MODULE_SYNC_COLLECTIONS.gym).toEqual(['gym_program', 'gym_set']);
  });

  it('acts on the defaults of the domain until the phone read the modules', () => {
    expect(effectiveClubModules(null)).toBe(DEFAULT_CLUB_MODULES);
    expect(effectiveClubModules(undefined)).toBe(DEFAULT_CLUB_MODULES);
    expect(effectiveClubModules(GYM_OFF)).toBe(GYM_OFF);
  });
});

async function setup(options: { readable?: readonly SyncCollection[] } = {}) {
  const api = createFakeApi();
  const server = createFakeSyncServer(api, options);
  const client = createApiClient({ baseUrl: api.baseUrl, fetch: api.fetch });
  const database = await openLocalDatabase(nodeSqliteDriver());
  const cache = createReadCache(database, { activeScope: () => SCOPE, now: () => T0 });
  // As `services.ts` wires it.
  const engine = createSyncEngine({
    database,
    api: client,
    randomUUID: uuid,
    now: () => T0,
    random: () => 0.5,
    setTimer: () => 0,
    clearTimer: () => undefined,
    collections: async (scope) =>
      pulledCollections(effectiveClubModules(await keptClubModules(cache, scope.membershipId))),
  });
  cleanups.push(() => {
    engine.dispose();
  });
  await engine.setScope(SCOPE);
  return { server, engine, cache };
}

const program = (): SyncChange =>
  ({
    collection: 'gym_program',
    op: 'upsert',
    id: uuid(),
    clientUuid: null,
    data: programDto(),
  }) as SyncChange;

describe('the sync with the gym module', () => {
  it('keeps the modules by membership, checked with the contract', async () => {
    const { cache } = await setup();
    expect(await keptClubModules(cache, SCOPE.membershipId)).toBeNull();
    await cache.put(SCOPE, CLUB_MODULES_READ, settings(GYM_OFF));
    expect(await keptClubModules(cache, SCOPE.membershipId)).toEqual(GYM_OFF);
    expect(await keptClubModules(cache, OTHER_CLUB.membershipId)).toBeNull();
    // A document an older build wrote that no longer parses is a miss.
    await cache.put(SCOPE, CLUB_MODULES_READ, { modules: { gym: 'no' } });
    expect(await keptClubModules(cache, SCOPE.membershipId)).toBeNull();
  });

  it('stops pulling the gym when the club turns it off, drops it, and brings it back', async () => {
    const { server, engine, cache } = await setup();
    server.publish(program(), upsert('wellness', wellnessDto()));

    await engine.syncNow();
    expect(server.pulls.at(-1)?.collections?.split(',')).toContain('gym_program');
    expect(await engine.store.list(SCOPE.membershipId, 'gym_program')).toHaveLength(1);

    await cache.put(SCOPE, CLUB_MODULES_READ, settings(GYM_OFF));
    await engine.syncNow();
    const asked = server.pulls.at(-1)?.collections?.split(',') ?? [];
    expect(asked).not.toContain('gym_program');
    expect(asked).not.toContain('gym_set');
    expect(asked).toContain('wellness');
    // Another view: the server starts over and the phone forgets the gym it kept.
    expect(await engine.store.list(SCOPE.membershipId, 'gym_program')).toEqual([]);
    expect(await engine.store.list(SCOPE.membershipId, 'wellness')).toHaveLength(1);

    // Off, a new program never reaches the phone.
    server.publish(program());
    await engine.syncNow();
    expect(await engine.store.list(SCOPE.membershipId, 'gym_program')).toEqual([]);

    await cache.put(SCOPE, CLUB_MODULES_READ, settings(DEFAULT_CLUB_MODULES));
    await engine.syncNow();
    expect(await engine.store.list(SCOPE.membershipId, 'gym_program')).toHaveLength(2);
    expect(await engine.store.list(SCOPE.membershipId, 'wellness')).toHaveLength(1);
  });

  it('does not start over each cycle when the role reads fewer collections than it asks', async () => {
    const { server, engine } = await setup({ readable: ['wellness', 'gym_program', 'gym_set'] });
    server.publish(upsert('wellness', wellnessDto()));
    await engine.syncNow();
    const first = server.pulls.at(-1)?.cursor;
    await engine.syncNow();
    await engine.syncNow();
    const [, second, third] = server.pulls.map((p) => p.cursor);
    expect(first).toBeNull();
    expect(second).not.toBeNull();
    expect(third).toBe(second);
  });
});
