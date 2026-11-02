import {
  ApiError,
  ApiNetworkError,
  CONTRACT_VERSION,
  createApiClient,
  type AppCompatibility,
  type FetchLike,
} from '@sport-performance/contracts';
import { createTranslator } from '@sport-performance/i18n';
import { describe, expect, it } from 'vitest';
import {
  DISMISSED_STORAGE_KEY,
  NATIVE_APP_VERSION,
  POLICY_STORAGE_KEY,
  appClientHeaders,
  blocksApp,
  createCompatibilityChecker,
  expoVersionConfig,
  isAppUpdateRequired,
  pausesSync,
  runtimeVersionOf,
  updatePrompt,
  type AppBuildInfo,
  type GetAppCompatibility,
  type KeyValueStore,
  type UpdateGate,
} from './index.js';

const build: AppBuildInfo = { platform: 'ios', nativeVersion: '1.1.0', runtimeVersion: '1.1.0' };
const STORE = 'https://apps.apple.com/app/id0000000000';
const translator = createTranslator();

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (key) => Promise.resolve(data.get(key) ?? null),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
  };
}

function answer(overrides: Partial<AppCompatibility>): AppCompatibility {
  return {
    status: 'supported',
    platform: 'ios',
    version: build.nativeVersion,
    minVersion: '1.0.0',
    latestVersion: null,
    storeUrl: STORE,
    api: { contractVersion: CONTRACT_VERSION, serverVersion: 'abc' },
    ...overrides,
  };
}

const online =
  (value: AppCompatibility): GetAppCompatibility =>
  () =>
    Promise.resolve(value);
const offline: GetAppCompatibility = () =>
  Promise.reject(new ApiNetworkError('getAppCompatibility', new Error('offline')));

const updateRequiredError = new ApiError({
  operationId: 'submitWellness',
  status: 426,
  code: 'app_update_required',
  message: 'App 1.1.0 on ios is no longer supported',
});

describe('release versioning', () => {
  it('ties the EAS runtime to the native version', () => {
    expect(expoVersionConfig()).toEqual({
      version: NATIVE_APP_VERSION,
      runtimeVersion: { policy: 'appVersion' },
    });
    expect(runtimeVersionOf('1.4.0')).toBe('1.4.0');
    expect(() => expoVersionConfig('1.4')).toThrow();
  });
});

describe('client headers', () => {
  it('say platform, native version and runtime', () => {
    expect(appClientHeaders(build)).toEqual({
      'x-client-platform': 'ios',
      'x-client-version': '1.1.0',
      'x-client-runtime-version': '1.1.0',
    });
    expect(appClientHeaders({ ...build, runtimeVersion: null })).toEqual({
      'x-client-platform': 'ios',
      'x-client-version': '1.1.0',
    });
  });

  it('refuse a malformed build', () => {
    expect(() => appClientHeaders({ ...build, nativeVersion: '1.1' })).toThrow();
    expect(() => appClientHeaders({ ...build, runtimeVersion: 'no spaces' })).toThrow();
    expect(() =>
      appClientHeaders({ ...build, platform: 'web' as AppBuildInfo['platform'] }),
    ).toThrow();
  });

  it('travel with every call of the typed client', async () => {
    const seen: Record<string, string>[] = [];
    const fetch: FetchLike = (_url, init) => {
      seen.push(init.headers);
      return Promise.resolve({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify(answer({}))),
      });
    };
    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      fetch,
      headers: appClientHeaders(build),
    });
    await client.getAppCompatibility({ query: { platform: 'ios', version: '1.1.0' } });
    expect(seen[0]).toMatchObject({ 'x-client-platform': 'ios', 'x-client-version': '1.1.0' });
  });
});

describe('compatibility checker', () => {
  it('follows the server and keeps the policy on the device', async () => {
    const storage = memoryStore();
    const checker = createCompatibilityChecker({
      build,
      storage,
      getAppCompatibility: online(answer({ status: 'supported' })),
      now: () => new Date('2026-11-02T12:00:00Z'),
    });
    expect(await checker.check()).toEqual({ kind: 'supported' });
    expect(JSON.parse(storage.data.get(POLICY_STORAGE_KEY) ?? '')).toEqual({
      minVersion: '1.0.0',
      latestVersion: null,
      storeUrl: STORE,
      checkedAt: '2026-11-02T12:00:00.000Z',
    });
  });

  it('blocks online when the server requires an update', async () => {
    const checker = createCompatibilityChecker({
      build,
      storage: memoryStore(),
      getAppCompatibility: online(answer({ status: 'update_required', minVersion: '1.2.0' })),
    });
    const gate = await checker.check();
    expect(gate).toEqual({
      kind: 'update_required',
      minVersion: '1.2.0',
      storeUrl: STORE,
      offline: false,
    });
    expect(blocksApp(gate)).toBe(true);
    expect(pausesSync(gate)).toBe(true);
  });

  it('never blocks offline: the last policy pauses sync but the app keeps working', async () => {
    const storage = memoryStore();
    await createCompatibilityChecker({
      build,
      storage,
      getAppCompatibility: online(answer({ status: 'supported', minVersion: '1.2.0' })),
    }).check();
    const gate = await createCompatibilityChecker({
      build,
      storage,
      getAppCompatibility: offline,
    }).check();
    // Decided locally from the cached policy: 1.1.0 < 1.2.0.
    expect(gate).toEqual({
      kind: 'update_required',
      minVersion: '1.2.0',
      storeUrl: STORE,
      offline: true,
    });
    expect(blocksApp(gate)).toBe(false);
    expect(pausesSync(gate)).toBe(true);
  });

  it('is unknown, and does not block, without a cached policy or with a corrupt one', async () => {
    for (const storage of [
      memoryStore(),
      memoryStore({ [POLICY_STORAGE_KEY]: 'not json' }),
      memoryStore({ [POLICY_STORAGE_KEY]: JSON.stringify({ minVersion: '1.2' }) }),
      memoryStore({
        [POLICY_STORAGE_KEY]: JSON.stringify({
          minVersion: '2.0.0',
          latestVersion: '1.0.0',
          storeUrl: null,
          checkedAt: 'x',
        }),
      }),
    ]) {
      const gate = await createCompatibilityChecker({
        build,
        storage,
        getAppCompatibility: offline,
      }).check();
      expect(gate).toEqual({ kind: 'unknown' });
      expect(blocksApp(gate)).toBe(false);
      expect(pausesSync(gate)).toBe(false);
    }
  });

  it('treats server errors like being offline', async () => {
    const storage = memoryStore();
    const checker = createCompatibilityChecker({
      build,
      storage,
      getAppCompatibility: () =>
        Promise.reject(
          new ApiError({
            operationId: 'getAppCompatibility',
            status: 503,
            code: 'service_unavailable',
            message: 'down',
          }),
        ),
    });
    expect(await checker.check()).toEqual({ kind: 'unknown' });
  });

  it('offers a newer version until the user dismisses it', async () => {
    const storage = memoryStore();
    const checker = createCompatibilityChecker({
      build,
      storage,
      getAppCompatibility: online(answer({ status: 'update_available', latestVersion: '1.3.0' })),
    });
    expect(await checker.check()).toEqual({
      kind: 'update_available',
      latestVersion: '1.3.0',
      storeUrl: STORE,
      dismissed: false,
    });
    await checker.dismissUpdateNotice('1.3.0');
    expect(storage.data.get(DISMISSED_STORAGE_KEY)).toBe('1.3.0');
    expect(await checker.check()).toMatchObject({ dismissed: true });
    // A newer release shows the notice again.
    const newer = createCompatibilityChecker({
      build,
      storage,
      getAppCompatibility: online(answer({ status: 'update_available', latestVersion: '1.4.0' })),
    });
    expect(await newer.check()).toMatchObject({ dismissed: false });
  });

  it('turns a 426 of any call into the blocking screen', async () => {
    const checker = createCompatibilityChecker({
      build,
      storage: memoryStore(),
      getAppCompatibility: online(answer({ status: 'update_required', minVersion: '1.2.0' })),
    });
    expect(isAppUpdateRequired(updateRequiredError)).toBe(true);
    expect(await checker.handleApiError(updateRequiredError)).toEqual({
      kind: 'update_required',
      minVersion: '1.2.0',
      storeUrl: STORE,
      offline: false,
    });
  });

  it('trusts the 426 over a stale or unreadable policy', async () => {
    const storage = memoryStore({
      [POLICY_STORAGE_KEY]: JSON.stringify({
        minVersion: '1.0.0',
        latestVersion: null,
        storeUrl: STORE,
        checkedAt: '2026-11-01T00:00:00Z',
      }),
    });
    const checker = createCompatibilityChecker({ build, storage, getAppCompatibility: offline });
    expect(await checker.handleApiError(updateRequiredError)).toEqual({
      kind: 'update_required',
      minVersion: null,
      storeUrl: STORE,
      offline: false,
    });
  });

  it('ignores other errors', async () => {
    const checker = createCompatibilityChecker({
      build,
      storage: memoryStore(),
      getAppCompatibility: offline,
    });
    expect(await checker.handleApiError(new Error('x'))).toBeNull();
    expect(
      await checker.handleApiError(
        new ApiError({ operationId: 'x', status: 404, code: 'not_found', message: 'x' }),
      ),
    ).toBeNull();
  });
});

describe('update prompt', () => {
  const required: UpdateGate = {
    kind: 'update_required',
    minVersion: '1.2.0',
    storeUrl: STORE,
    offline: false,
  };

  it('is the blocking "actualizá la app" screen online', () => {
    expect(updatePrompt(required, '1.1.0', translator)).toEqual({
      presentation: 'screen',
      title: 'Actualizá la app',
      body: 'La versión 1.1.0 ya no funciona con el servidor. Instalá la 1.2.0 o una más nueva para seguir.',
      action: { label: 'Actualizar', url: STORE },
      note: 'Sincronización en pausa hasta que actualices la app. Lo que cargues queda guardado en el teléfono.',
      dismissLabel: null,
    });
  });

  it('says where to find the app without a store link, and works without the minimum', () => {
    const prompt = updatePrompt(
      { ...required, minVersion: null, storeUrl: null },
      '1.1.0',
      translator,
    );
    expect(prompt).toMatchObject({
      presentation: 'screen',
      body: 'Esta versión de la app ya no es compatible. Actualizala para seguir.',
      action: null,
      note: 'Buscá la app en la tienda de tu teléfono y actualizala.',
    });
  });

  it('is a banner offline, so the staff keeps loading data', () => {
    expect(updatePrompt({ ...required, offline: true }, '1.1.0', translator)).toMatchObject({
      presentation: 'banner',
      title: 'Actualizá la app',
      action: { label: 'Actualizar', url: STORE },
      dismissLabel: null,
    });
  });

  it('is a dismissible banner for a newer version', () => {
    const gate: UpdateGate = {
      kind: 'update_available',
      latestVersion: '1.3.0',
      storeUrl: STORE,
      dismissed: false,
    };
    expect(updatePrompt(gate, '1.1.0', translator)).toEqual({
      presentation: 'banner',
      title: 'Hay una versión nueva',
      body: 'La versión 1.3.0 ya está en la tienda.',
      action: { label: 'Actualizar', url: STORE },
      note: null,
      dismissLabel: 'Más tarde',
    });
    expect(updatePrompt({ ...gate, dismissed: true }, '1.1.0', translator)).toBeNull();
  });

  it('shows nothing when supported or unknown', () => {
    expect(updatePrompt({ kind: 'supported' }, '1.1.0', translator)).toBeNull();
    expect(updatePrompt({ kind: 'unknown' }, '1.1.0', translator)).toBeNull();
  });
});
