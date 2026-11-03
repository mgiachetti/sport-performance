import { describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../state/session-controller.ts';
import { COACH_AT_ORC, USER } from '../test/fixtures.ts';
import { runBackgroundSync } from './background.ts';
import type { SyncEngine, SyncScopeRef, SyncStatus } from './engine.ts';
import { syncRetryDelayMs } from './backoff.ts';
import { bindSyncToSession } from './session-binding.ts';
import { FOREGROUND_SYNC_INTERVAL_MS, startSyncTriggers } from './triggers.ts';

function fakeEngine() {
  const listeners = new Set<() => void>();
  let status: SyncStatus = {
    membershipId: null,
    phase: 'idle',
    pause: null,
    pendingCount: 0,
    issueCount: 0,
    lastSyncedAt: null,
    nextAttemptAt: null,
  };
  const calls: string[] = [];
  const requestSync = vi.fn();
  const syncNow = vi.fn(() => Promise.resolve({ status: 'synced', pushed: 0, pulled: 0 } as const));
  const engine = {
    getStatus: () => status,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestSync,
    setScope: vi.fn((scope: SyncScopeRef | null) => {
      calls.push(`scope:${scope?.membershipId ?? 'none'}`);
      status = { ...status, membershipId: scope?.membershipId ?? null };
      for (const listener of listeners) listener();
      return Promise.resolve();
    }),
    wipe: vi.fn(() => {
      calls.push('wipe');
      return Promise.resolve();
    }),
    syncNow,
  };
  return { engine: engine as unknown as SyncEngine, calls, requestSync, syncNow };
}

function fakeSession(initial: SessionState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: SessionState) {
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

const signedIn: SessionState = {
  status: 'signedIn',
  user: USER,
  email: USER.email,
  memberships: [COACH_AT_ORC],
  activeMembership: COACH_AT_ORC,
  clubNotice: null,
  offline: false,
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('sync and the session', () => {
  it('follows the active membership and wipes only on a sign-out on purpose', async () => {
    const { engine, calls } = fakeEngine();
    const session = fakeSession({ status: 'starting' });
    bindSyncToSession(engine, session, () => undefined);
    session.set(signedIn);
    await flush();
    session.set({ ...signedIn, activeMembership: null });
    session.set({ status: 'signedOut', notice: 'sessionExpired' });
    await flush();
    expect(calls).toEqual([`scope:${COACH_AT_ORC.id}`, 'scope:none', 'scope:none']);

    session.set(signedIn);
    session.set({ status: 'signedOut', notice: null });
    await flush();
    expect(calls.slice(-3)).toEqual([`scope:${COACH_AT_ORC.id}`, 'scope:none', 'wipe']);
  });

  it('does not wipe on a launch without a session', async () => {
    const { engine, calls } = fakeEngine();
    const session = fakeSession({ status: 'starting' });
    bindSyncToSession(engine, session, () => undefined);
    session.set({ status: 'signedOut', notice: null });
    await flush();
    expect(calls).toEqual(['scope:none']);
  });
});

describe('sync triggers', () => {
  it('syncs now on the foreground and when the network comes back, and periodically', () => {
    const { engine, requestSync } = fakeEngine();
    const sources: { active?: (value: boolean) => void; connectivity?: (value: boolean) => void } =
      {};
    const intervals: { task: () => void; ms: number; cleared: boolean }[] = [];
    const stop = startSyncTriggers(engine, {
      onAppActive: (listener) => {
        sources.active = listener;
        return () => undefined;
      },
      onConnectivity: (listener) => {
        sources.connectivity = listener;
        return () => undefined;
      },
      setInterval: (task, ms) => {
        intervals.push({ task, ms, cleared: false });
        return intervals.length - 1;
      },
      clearInterval: (handle) => {
        const entry = intervals[handle as number];
        if (entry !== undefined) entry.cleared = true;
      },
    });
    expect(intervals.map((i) => i.ms)).toEqual([FOREGROUND_SYNC_INTERVAL_MS]);
    intervals[0]?.task();
    expect(requestSync).toHaveBeenLastCalledWith();

    sources.connectivity?.(true);
    expect(requestSync).toHaveBeenCalledTimes(1);
    sources.connectivity?.(false);
    sources.connectivity?.(true);
    expect(requestSync).toHaveBeenLastCalledWith({ force: true });

    sources.active?.(false);
    expect(intervals[0]?.cleared).toBe(true);
    sources.active?.(true);
    expect(requestSync).toHaveBeenLastCalledWith({ force: true });
    expect(intervals).toHaveLength(2);
    stop();
    expect(intervals[1]?.cleared).toBe(true);
  });
});

describe('background sync', () => {
  it('waits for the session and the scope, then runs one cycle', async () => {
    const { engine, syncNow } = fakeEngine();
    const session = fakeSession({ status: 'starting' });
    bindSyncToSession(engine, session, () => undefined);
    const run = runBackgroundSync({ session, sync: engine }, 1_000);
    session.set(signedIn);
    expect(await run).toBe(true);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a session', async () => {
    const { engine, syncNow } = fakeEngine();
    const session = fakeSession({ status: 'signedOut', notice: null });
    expect(await runBackgroundSync({ session, sync: engine }, 1_000)).toBe(false);
    expect(syncNow).not.toHaveBeenCalled();
  });
});

describe('backoff', () => {
  it('doubles from 2 s to 5 min with half of it random', () => {
    expect(syncRetryDelayMs(1, () => 0)).toBe(1_000);
    expect(syncRetryDelayMs(1, () => 1)).toBe(2_000);
    expect(syncRetryDelayMs(3, () => 1)).toBe(8_000);
    expect(syncRetryDelayMs(30, () => 1)).toBe(300_000);
  });

  it('never retries before a Retry-After, capped at 15 min', () => {
    expect(syncRetryDelayMs(1, () => 0, 30)).toBe(30_000);
    expect(syncRetryDelayMs(1, () => 0, 86_400)).toBe(900_000);
  });
});
