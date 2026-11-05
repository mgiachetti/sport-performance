import { randomUUID } from 'node:crypto';
import { addDays, compareLocalDates, type LocalDate } from '@sport-performance/domain';
import {
  activePlayers,
  demoDataset,
  mailboxMark,
  readRunState,
  stackEndpoints,
  waitForSignInCode,
} from '@sport-performance/e2e/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createMobileApi } from '../src/api/client.ts';
import { createSessionStore } from '../src/auth/session-store.ts';
import { openLocalDatabase } from '../src/offline/db/database.ts';
import { createSyncEngine } from '../src/offline/engine.ts';
import { memorySecureStorage } from '../src/platform/storage.ts';
import { createSessionController } from '../src/state/session-controller.ts';
import { nodeSqliteDriver, temporaryDatabaseFile } from '../src/test/node-sqlite.ts';

/**
 * The app's own client, session controller and offline sync engine (ADR
 * 0015, 0050, 0069) against the real API of the end-to-end stack (ADR 0096),
 * on real SQLite (`node:sqlite`, the same migrations as `expo-sqlite`). What
 * runs in CI without a device; the native UI is Maestro's, out of CI.
 */
const endpoints = stackEndpoints();
const state = readRunState(endpoints.runDir);
const dataset = demoDataset(state);
const cleanups: (() => void)[] = [];
afterAll(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * A player with their own account (M17/M19) and a club day still free for a
 * wellness entry: one per player and day (`conflict` otherwise), today or
 * yesterday (the offline queue's window).
 */
function playerWithFreeDay(): { email: string; localDate: LocalDate } {
  const today = dataset.asOf;
  const days = [today, addDays(today, -1)];
  for (const player of activePlayers(dataset, (c) => ['m17', 'm19'].includes(c.ageBandCode))) {
    if (player.userId === null) continue;
    const user = dataset.users.find((u) => u.id === player.userId);
    if (user === undefined) continue;
    const taken = dataset.wellness.filter((w) => w.playerId === player.id);
    const free = days.find((day) => !taken.some((w) => compareLocalDates(w.localDate, day) === 0));
    if (free !== undefined) return { email: user.email, localDate: free };
  }
  throw new Error('No demo player with an account has a free day for wellness.');
}

describe('mobile app against the real API', () => {
  it('signs in by code, queues wellness offline and syncs it when the network is back', async () => {
    const { email, localDate } = playerWithFreeDay();

    // The device: secure storage, the network (that can drop) and the local database.
    let online = true;
    const network: typeof fetch = (input, init) =>
      online ? fetch(input, init) : Promise.reject(new TypeError('Network request failed'));
    const sessionStore = createSessionStore({
      storage: memorySecureStorage(),
      randomUUID: () => randomUUID(),
    });
    const mobile = createMobileApi({
      baseUrl: endpoints.apiUrl,
      build: { platform: 'android', nativeVersion: '1.0.0', runtimeVersion: null },
      locale: 'es-AR',
      credentials: {
        getToken: () => sessionStore.getToken(),
        getMembershipId: () => sessionStore.getMembershipId(),
      },
      fetch: network,
    });
    const file = temporaryDatabaseFile();
    cleanups.push(file.remove);
    const database = await openLocalDatabase(nodeSqliteDriver(file.path));
    cleanups.push(() => void database.close());

    // Sign-in as the app does it: email code, bearer session, the club picked.
    const session = createSessionController({ api: mobile.client, store: sessionStore });
    await session.start();
    const mark = await mailboxMark(endpoints.runDir);
    await session.requestCode(email);
    await session.verifyCode(email, await waitForSignInCode(endpoints.runDir, email, mark));
    const signedIn = session.getState();
    if (signedIn.status !== 'signedIn') throw new Error(`Not signed in: ${signedIn.status}`);
    const membership = signedIn.activeMembership;
    expect(membership?.role).toBe('player');
    if (membership === null) return;

    const engine = createSyncEngine({
      database,
      api: mobile.client,
      randomUUID: () => randomUUID(),
    });
    cleanups.push(() => {
      engine.dispose();
    });
    await engine.setScope({ membershipId: membership.id, userId: signedIn.user.id });
    // The first sync brings what the player sees (their sessions, earlier wellness).
    expect(await engine.syncNow()).toMatchObject({ status: 'synced' });

    // No network: the entry waits in the queue.
    online = false;
    const clientUuid = randomUUID();
    await engine.enqueue('wellness.submit', {
      body: {
        clientUuid,
        localDate,
        scores: { sleep: 4, fatigue: 3, soreness: 4, stress: 2, mood: 5 },
      },
    });
    expect(await engine.syncNow()).toEqual({ status: 'failed', phase: 'offline' });
    expect(engine.getStatus()).toMatchObject({ phase: 'offline', pendingCount: 1 });

    // Network back: pushed by `/v1/sync/push`, and its row comes back by `/v1/sync/changes`.
    online = true;
    const synced = async () => {
      expect((await engine.syncNow()).status).toBe('synced');
      return engine.store.get(membership.id, 'wellness', { clientUuid });
    };
    await expect.poll(synced, { timeout: 30_000 }).toMatchObject({ clientUuid, pending: false });
    expect(engine.getStatus()).toMatchObject({ phase: 'idle', pendingCount: 0, issueCount: 0 });

    // The API has it, for the player, on that club day.
    const listed = await mobile.client.listWellness({ query: { from: localDate, to: localDate } });
    expect(listed.items.map((w) => w.localDate)).toContain(localDate);

    await session.signOut();
    expect(session.getState().status).toBe('signedOut');
  });
});
