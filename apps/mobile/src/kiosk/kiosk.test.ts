import { createHash } from 'node:crypto';
import {
  createApiClient,
  type KioskRosterEntry,
  type KioskRosterPage,
} from '@sport-performance/contracts';
import { parseLocalDate, parseTimeZone, type LocalDate } from '@sport-performance/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN_KEY } from '../auth/session-store.ts';
import { openLocalDatabase } from '../offline/db/database.ts';
import { createSyncEngine } from '../offline/engine.ts';
import { memorySecureStorage } from '../platform/storage.ts';
import { createFakeApi } from '../test/fake-api.ts';
import {
  COACH_AT_ORC,
  SESSION_TOKEN,
  USER,
  signedInRoutes,
  testServices,
} from '../test/fixtures.ts';
import {
  SESSION_ID,
  T0,
  createFakeSyncServer,
  participationDto,
  upsert,
  uuid,
  wellnessDto,
} from '../test/fake-sync-server.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import { KIOSK_CONFIG_KEY, createKioskController, parseKioskConfig } from './controller.ts';
import { kioskLocalFacts, kioskRpeRequest, kioskWellnessRequest } from './local.ts';
import {
  KIOSK_FREE_ATTEMPTS,
  KIOSK_LOCKOUT_MAX_MS,
  hashKioskPin,
  isWeakKioskPin,
  kioskLockoutMs,
  kioskPinProblem,
} from './pin.ts';
import {
  NO_LOCAL_FACTS,
  hasSomethingLeft,
  kioskDisplayNames,
  kioskPlayers,
  rosterSnapshot,
  rpeKey,
  searchKioskPlayers,
} from './roster.ts';

const sha256Hex = (text: string) =>
  Promise.resolve(createHash('sha256').update(text).digest('hex'));
const TZ = parseTimeZone('America/Argentina/Buenos_Aires');
const SCOPE = { userId: 'u-coach', membershipId: 'a1111111-1111-4111-8111-111111111111' };
// T0 is 2026-11-03 12:00 UTC: 09:00 in Buenos Aires.
const TODAY = parseLocalDate('2026-11-03');

describe('kiosk PIN', () => {
  it('takes 4 to 6 digits, not trivial, confirmed', () => {
    expect(kioskPinProblem('2580', '2580')).toBeNull();
    expect(kioskPinProblem('258013', '258013')).toBeNull();
    expect(kioskPinProblem('', '')).toBe('length');
    expect(kioskPinProblem('258', '258')).toBe('length');
    expect(kioskPinProblem('2580134', '2580134')).toBe('length');
    expect(kioskPinProblem('25a0', '25a0')).toBe('digits');
    expect(kioskPinProblem('2580', '2581')).toBe('mismatch');
    for (const weak of ['0000', '1234', '4321', '987654', '012345']) {
      expect(isWeakKioskPin(weak), weak).toBe(true);
      expect(kioskPinProblem(weak, weak)).toBe('weak');
    }
    expect(isWeakKioskPin('1357')).toBe(false);
  });

  it('hashes with the salt: the same PIN with another salt is another hash', async () => {
    const a = await hashKioskPin('2580', 's1', sha256Hex);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashKioskPin('2580', 's1', sha256Hex)).toBe(a);
    expect(await hashKioskPin('2580', 's2', sha256Hex)).not.toBe(a);
  });

  it('waits after five wrong PINs, doubling up to 15 minutes', () => {
    expect(kioskLockoutMs(KIOSK_FREE_ATTEMPTS - 1)).toBe(0);
    expect(kioskLockoutMs(KIOSK_FREE_ATTEMPTS)).toBe(30_000);
    expect(kioskLockoutMs(KIOSK_FREE_ATTEMPTS + 1)).toBe(60_000);
    expect(kioskLockoutMs(KIOSK_FREE_ATTEMPTS + 30)).toBe(KIOSK_LOCKOUT_MAX_MS);
  });
});

describe('kiosk controller', () => {
  function setup(token: { value: string | null } = { value: 'token-1' }) {
    const storage = memorySecureStorage();
    let time = T0;
    let n = 0;
    const errors: unknown[] = [];
    const controller = createKioskController({
      storage,
      sessionToken: () => Promise.resolve(token.value),
      sha256Hex,
      randomUUID: () => `salt-${String((n += 1))}`,
      now: () => time,
      reportError: (error) => errors.push(error),
    });
    return {
      storage,
      controller,
      token,
      errors,
      advance: (ms: number) => {
        time += ms;
      },
    };
  }
  const categories = [{ id: 'cat-m13', name: 'M13' }];

  it('starts, survives a relaunch of the same session and never stores the PIN', async () => {
    const { storage, controller, token } = setup();
    await controller.sync(SCOPE);
    expect(controller.getState().status).toBe('off');
    await controller.start(SCOPE, categories, '2580');
    expect(controller.getState().status).toBe('on');
    const stored = storage.entries.get(KIOSK_CONFIG_KEY) ?? '';
    expect(stored).not.toContain('2580');
    expect(stored).not.toContain('token-1');
    expect(parseKioskConfig(stored)?.categories).toEqual(categories);

    // A relaunch of the app: a new controller over the same storage.
    const relaunched = createKioskController({
      storage,
      sessionToken: () => Promise.resolve(token.value),
      sha256Hex,
      randomUUID: () => 'x',
      now: () => T0,
      reportError: () => undefined,
    });
    expect(relaunched.getState().status).toBe('loading');
    await relaunched.sync(SCOPE);
    expect(relaunched.getState().status).toBe('on');
  });

  it('drops the kiosk of another session, user or membership', async () => {
    const { storage, controller, token } = setup();
    await controller.start(SCOPE, categories, '2580');
    await controller.sync({ ...SCOPE, membershipId: 'other' });
    expect(controller.getState().status).toBe('off');
    expect(storage.entries.has(KIOSK_CONFIG_KEY)).toBe(false);

    await controller.start(SCOPE, categories, '2580');
    token.value = 'token-2';
    await controller.sync(SCOPE);
    expect(controller.getState().status).toBe('off');

    await controller.start(SCOPE, categories, '2580');
    await controller.sync(null);
    expect(controller.getState().status).toBe('off');
  });

  it('leaves with the PIN and locks after repeated wrong ones, across relaunches', async () => {
    const { storage, controller, advance } = setup();
    await controller.start(SCOPE, categories, '2580');
    for (let i = 1; i < KIOSK_FREE_ATTEMPTS; i += 1) {
      expect(await controller.exit('1111')).toEqual({
        ok: false,
        reason: 'wrong',
        lockedUntilMs: null,
      });
    }
    const fifth = await controller.exit('1111');
    expect(fifth).toEqual({ ok: false, reason: 'wrong', lockedUntilMs: T0 + 30_000 });
    // Locked: not even the right PIN until the wait ends.
    expect(await controller.exit('2580')).toEqual({
      ok: false,
      reason: 'locked',
      lockedUntilMs: T0 + 30_000,
    });
    expect(parseKioskConfig(storage.entries.get(KIOSK_CONFIG_KEY) ?? null)?.failedAttempts).toBe(5);
    advance(30_000);
    expect(await controller.exit('2580')).toEqual({ ok: true });
    expect(controller.getState().status).toBe('off');
    expect(storage.entries.has(KIOSK_CONFIG_KEY)).toBe(false);
  });

  it('ignores a stored config it cannot read', async () => {
    const { storage, controller } = setup();
    storage.entries.set(KIOSK_CONFIG_KEY, '{"version":9}');
    await controller.sync(SCOPE);
    expect(controller.getState().status).toBe('off');
    expect(parseKioskConfig('not json')).toBeNull();
  });
});

const WELLNESS_3 = {
  localDate: TODAY,
  stage: 'foundation',
  itemCount: 3,
  items: ['sleep', 'fatigue', 'soreness'],
  submitted: false,
} as const satisfies KioskRosterEntry['wellness'];

function entry(
  id: string,
  firstName: string,
  lastName: string,
  overrides: Partial<KioskRosterEntry> = {},
): KioskRosterEntry {
  return {
    player: { id, firstName, lastName },
    canReport: true,
    wellness: { ...WELLNESS_3, items: [...WELLNESS_3.items] },
    sessions: [],
    ...overrides,
  } as KioskRosterEntry;
}

function session(id: string, opensAt: number, closesAt: number, state = 'pending') {
  return {
    session: {
      id,
      sport: 'rugby',
      kind: 'training',
      categoryId: 'cat-m13',
      title: 'Entrenamiento',
      startsAt: new Date(opensAt).toISOString(),
      localDate: TODAY,
      plannedDurationMin: 80,
      archivedAt: null,
    },
    rpeWindow: {
      opensAt: new Date(opensAt).toISOString(),
      closesAt: new Date(closesAt).toISOString(),
    },
    state,
  } as KioskRosterEntry['sessions'][number];
}

function page(items: KioskRosterEntry[], today: LocalDate = TODAY): KioskRosterPage {
  return { items, nextCursor: null, today, timeZone: TZ };
}

describe('kiosk roster', () => {
  const HOUR = 3_600_000;

  it('shortens names unless two players would share one', () => {
    const names = kioskDisplayNames([
      { id: '1', firstName: 'Juan', lastName: 'Pérez' },
      { id: '2', firstName: 'Juan', lastName: 'Paz' },
      { id: '3', firstName: 'Ana', lastName: 'Acosta' },
    ]);
    expect(names.get('1')).toBe('Juan Pérez');
    expect(names.get('2')).toBe('Juan Paz');
    expect(names.get('3')).toBe('Ana A.');
  });

  it('merges categories, sorts by name and says what is left now', () => {
    const open = session('s-open', T0 - HOUR, T0 + 10 * HOUR);
    const later = session('s-later', T0 + HOUR, T0 + 20 * HOUR);
    const reported = session('s-done', T0 - 2 * HOUR, T0 + 10 * HOUR, 'reported');
    const m13 = rosterSnapshot(
      'cat-m13',
      [
        page([
          entry('p-zoe', 'Zoe', 'Zárate', { sessions: [open, later, reported] }),
          entry('p-ana', 'Ana', 'Acosta', {
            wellness: { ...WELLNESS_3, submitted: true },
          }),
        ]),
      ],
      T0,
    );
    const m14 = rosterSnapshot('cat-m14', [page([entry('p-zoe', 'Zoe', 'Zárate')])], T0);
    const players = kioskPlayers([m13, m14], NO_LOCAL_FACTS, T0);
    expect(players.map((p) => p.id)).toEqual(['p-ana', 'p-zoe']);
    const [ana, zoe] = players;
    expect(ana?.wellness).toBeNull();
    expect(ana?.wellnessDone).toBe(true);
    expect(ana !== undefined && hasSomethingLeft(ana)).toBe(false);
    expect(zoe?.categoryIds).toEqual(['cat-m13', 'cat-m14']);
    expect(zoe?.wellness?.itemCount).toBe(3);
    // Only the session whose window is open and has no RPE yet.
    expect(zoe?.rpe.map((s) => s.sessionId)).toEqual(['s-open']);
  });

  it('counts what this kiosk queued or the sync pulled, at once', () => {
    const open = session('s-open', T0 - HOUR, T0 + 10 * HOUR);
    const snapshot = rosterSnapshot(
      'cat-m13',
      [page([entry('p1', 'Juan', 'Pérez', { sessions: [open] })])],
      T0,
    );
    const players = kioskPlayers(
      [snapshot],
      {
        wellnessDone: new Set(['p1']),
        rpeDone: new Set([rpeKey('s-open', 'p1')]),
        notTakingPart: new Set(),
      },
      T0,
    );
    expect(players[0]?.wellness).toBeNull();
    expect(players[0]?.rpe).toEqual([]);
  });

  it('a roster kept from yesterday no longer says today’s check-in was done', () => {
    const yesterday = rosterSnapshot(
      'cat-m13',
      [
        page(
          [
            entry('p1', 'Juan', 'Pérez', {
              wellness: { ...WELLNESS_3, localDate: parseLocalDate('2026-11-02'), submitted: true },
            }),
          ],
          parseLocalDate('2026-11-02'),
        ),
      ],
      T0 - 24 * HOUR,
    );
    const [juan] = kioskPlayers([yesterday], NO_LOCAL_FACTS, T0);
    expect(juan?.wellnessDone).toBe(false);
    expect(juan?.wellness?.items).toEqual(['sleep', 'fatigue', 'soreness']);
  });

  it('finds a player by the start of any name, without accents', () => {
    const snapshot = rosterSnapshot(
      'cat-m13',
      [
        page([
          entry('p1', 'Tomás', 'Gómez'),
          entry('p2', 'Ana', 'Acosta'),
          entry('p3', 'Juan', 'Martín Gómez'),
        ]),
      ],
      T0,
    );
    const players = kioskPlayers([snapshot], NO_LOCAL_FACTS, T0);
    expect(searchKioskPlayers(players, 'gom').map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(searchKioskPlayers(players, 'tomas g').map((p) => p.id)).toEqual(['p1']);
    expect(searchKioskPlayers(players, '  ')).toHaveLength(3);
  });
});

describe('kiosk on the local database', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  async function setup() {
    const api = createFakeApi();
    const server = createFakeSyncServer(api);
    const client = createApiClient({ baseUrl: api.baseUrl, fetch: api.fetch });
    const engine = createSyncEngine({
      database: await openLocalDatabase(nodeSqliteDriver()),
      api: client,
      randomUUID: uuid,
      now: () => T0,
      random: () => 0.5,
      setTimer: () => 0,
      clearTimer: () => undefined,
      reportError: () => undefined,
    });
    await engine.setScope(SCOPE);
    cleanups.push(() => {
      engine.dispose();
    });
    return { engine, server };
  }

  const P1 = 'b1111111-1111-4111-8111-111111111111';
  const P2 = 'b2222222-2222-4222-8222-222222222222';

  it('queues for the named player and counts it before and after it syncs', async () => {
    const { engine, server } = await setup();
    await engine.enqueue(
      'wellness.submit',
      kioskWellnessRequest({
        playerId: P1,
        today: TODAY,
        scores: { sleep: 4, fatigue: 3, soreness: 2 },
        clientUuid: uuid(),
      }),
    );
    await engine.enqueue(
      'rpe.submit',
      kioskRpeRequest({ playerId: P2, sessionId: SESSION_ID, rpe: 6, clientUuid: uuid() }),
    );
    const before = await kioskLocalFacts(engine.store, SCOPE.membershipId, TODAY, [SESSION_ID]);
    expect([...before.wellnessDone]).toEqual([P1]);
    expect([...before.rpeDone]).toEqual([rpeKey(SESSION_ID, P2)]);

    await engine.syncNow();
    const [wellnessPush, rpePush] = server.pushes[0] ?? [];
    expect(wellnessPush?.body).toMatchObject({ playerId: P1, localDate: TODAY });
    expect(rpePush?.body).toMatchObject({ playerId: P2, rpe: 6 });

    // What another device loaded, as the pull brings it.
    server.publish(
      upsert(
        'wellness',
        wellnessDto({ playerId: P2, localDate: TODAY, channel: 'player_account' }),
      ),
      upsert('participation', participationDto({ playerId: P1, status: 'absent', minutes: null })),
    );
    await engine.syncNow();
    const after = await kioskLocalFacts(engine.store, SCOPE.membershipId, TODAY, [SESSION_ID]);
    expect(after.wellnessDone.has(P2)).toBe(true);
    expect(after.notTakingPart.has(rpeKey(SESSION_ID, P1))).toBe(true);
  });
});

describe('kiosk in the app services', () => {
  it('follows the session: kept on a relaunch, gone after signing out', async () => {
    const first = testServices({ secure: { [SESSION_TOKEN_KEY]: SESSION_TOKEN } });
    signedInRoutes(first.api, [COACH_AT_ORC]);
    await first.services.session.start();
    await vi.waitFor(() => {
      expect(first.services.kiosk.getState().status).toBe('off');
    });
    await first.services.kiosk.start(
      { userId: USER.id, membershipId: COACH_AT_ORC.id },
      [{ id: 'cat-m13', name: 'M13' }],
      '2580',
    );
    const stored = Object.fromEntries(first.secure.entries);
    first.services.dispose();

    // The app killed and opened again: the kiosk is back before anything else shows.
    const second = testServices({ secure: stored });
    signedInRoutes(second.api, [COACH_AT_ORC]);
    expect(second.services.kiosk.getState().status).toBe('loading');
    await second.services.session.start();
    await vi.waitFor(() => {
      expect(second.services.kiosk.getState().status).toBe('on');
    });
    second.api.on('POST /v1/auth/sign-out', { status: 204 });
    await second.services.session.signOut();
    await vi.waitFor(() => {
      expect(second.services.kiosk.getState().status).toBe('off');
    });
    expect(second.secure.entries.has(KIOSK_CONFIG_KEY)).toBe(false);
    second.services.dispose();
  });
});
