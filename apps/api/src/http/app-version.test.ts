import {
  CONTRACT_VERSION,
  appCompatibilitySchema,
  defineEndpoint,
  errorEnvelopeSchema,
} from '@sport-performance/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { BuildAppOptions } from '../app.js';
import type { MobileAppConfig } from '../config/env.js';
import { offlineAuthModule, TEST_WEB_ORIGIN } from '../testing/identity.js';
import { testApp, testConfig } from '../testing/support.js';
import { registerEndpoint } from './endpoint.js';

const ping = defineEndpoint({
  method: 'GET',
  path: '/v1/test/ping',
  summary: 'Ping',
  tags: ['system'],
  auth: 'public',
  response: { status: 200, description: 'Pong', schema: z.object({ pong: z.literal(true) }) },
  errors: [],
});

const mobileApp: MobileAppConfig = {
  ios: {
    minVersion: '1.2.0',
    latestVersion: '1.4.0',
    storeUrl: 'https://apps.apple.com/app/id0000000000',
  },
  android: { minVersion: '1.1.0', latestVersion: null, storeUrl: null },
};

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function start(options: Partial<BuildAppOptions> = {}) {
  let authenticated = 0;
  const { app } = await testApp({
    config: { ...testConfig, mobileApp },
    authenticate: () => {
      authenticated += 1;
      return Promise.resolve(null);
    },
    register: (instance) => {
      registerEndpoint(instance, ping, {
        transaction: false,
        handler: () => Promise.resolve({ pong: true as const }),
      });
    },
    ...options,
  });
  apps.push(app);
  return { app, authenticated: () => authenticated };
}

const appHeaders = (platform: string, version: string, runtimeVersion = version) => ({
  'x-client-platform': platform,
  'x-client-version': version,
  'x-client-runtime-version': runtimeVersion,
});

function errorOf(body: string) {
  return errorEnvelopeSchema.parse(JSON.parse(body)).error;
}

describe('app version check', () => {
  it('answers 426 app_update_required to an app below the minimum, before authenticating', async () => {
    const { app, authenticated } = await start();
    const response = await app.inject({
      url: '/v1/test/ping',
      headers: appHeaders('ios', '1.1.9'),
    });
    expect(response.statusCode).toBe(426);
    const error = errorOf(response.body);
    expect(error.code).toBe('app_update_required');
    expect(error.message).toContain('1.2.0');
    expect(error.requestId).toBe(response.headers['x-request-id']);
    expect(response.headers['x-api-version']).toBe(CONTRACT_VERSION);
    expect(authenticated()).toBe(0);
  });

  it('uses the policy of the platform', async () => {
    const { app } = await start();
    const android = await app.inject({
      url: '/v1/test/ping',
      headers: appHeaders('android', '1.1.5'),
    });
    expect(android.statusCode).toBe(200);
    const oldAndroid = await app.inject({
      url: '/v1/test/ping',
      headers: appHeaders('android', '1.0.9'),
    });
    expect(oldAndroid.statusCode).toBe(426);
  });

  it('serves supported apps, apps with a newer version available, and newer builds', async () => {
    const { app, authenticated } = await start();
    for (const version of ['1.2.0', '1.3.9', '1.4.0', '2.0.0']) {
      const response = await app.inject({
        url: '/v1/test/ping',
        headers: appHeaders('ios', version),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ pong: true });
    }
    expect(authenticated()).toBe(4);
  });

  it('does not check requests without client headers (the web, monitors)', async () => {
    const { app } = await start();
    const response = await app.inject({ url: '/v1/test/ping' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-api-version']).toBe(CONTRACT_VERSION);
  });

  it('accepts an app that does not send its runtime version', async () => {
    const { app } = await start();
    const response = await app.inject({
      url: '/v1/test/ping',
      headers: { 'x-client-platform': 'ios', 'x-client-version': '1.2.0' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects malformed or incomplete client headers with 400 validation_failed', async () => {
    const { app } = await start();
    const cases: [Record<string, string>, string[]][] = [
      [{ 'x-client-platform': 'web', 'x-client-version': '1.2.0' }, ['x-client-platform']],
      [{ 'x-client-platform': 'ios', 'x-client-version': '1.2' }, ['x-client-version']],
      [{ 'x-client-platform': 'ios' }, ['x-client-version']],
      [{ 'x-client-version': '1.2.0' }, ['x-client-platform']],
      [{ 'x-client-runtime-version': '1.2.0' }, ['x-client-platform', 'x-client-version']],
      [appHeaders('ios', '1.2.0', 'not valid!'), ['x-client-runtime-version']],
    ];
    for (const [headers, paths] of cases) {
      const response = await app.inject({ url: '/v1/test/ping', headers });
      expect(response.statusCode).toBe(400);
      const error = errorOf(response.body);
      expect(error.code).toBe('validation_failed');
      expect(error.details?.map((issue) => issue.path)).toEqual(
        paths.map((name) => ['headers', name]),
      );
    }
  });

  it('checks unknown routes too: an outdated app calling a removed route is told to update', async () => {
    const { app } = await start();
    const outdated = await app.inject({ url: '/v1/removed', headers: appHeaders('ios', '1.0.0') });
    expect(outdated.statusCode).toBe(426);
    const current = await app.inject({ url: '/v1/removed', headers: appHeaders('ios', '1.2.0') });
    expect(current.statusCode).toBe(404);
    expect(current.headers['x-api-version']).toBe(CONTRACT_VERSION);
  });

  it('lets any app version reach the health probes, the OpenAPI and the compatibility check', async () => {
    const { app } = await start();
    const headers = appHeaders('ios', '0.1.0');
    for (const url of [
      '/health/live',
      '/health/ready',
      '/v1/health',
      '/openapi.json',
      '/v1/app/compatibility?platform=ios&version=0.1.0',
    ]) {
      const response = await app.inject({ url, headers });
      expect(response.statusCode, url).toBe(200);
    }
    // Not even malformed headers get in the way there.
    const malformed = await app.inject({
      url: '/v1/health',
      headers: { 'x-client-platform': 'windows' },
    });
    expect(malformed.statusCode).toBe(200);
  });

  it('lets the web send the client headers cross-origin and read the API version', async () => {
    const { app } = await start({ auth: offlineAuthModule() });
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/test/ping',
      headers: {
        origin: TEST_WEB_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers':
          'x-client-platform,x-client-version,x-client-runtime-version',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-headers']).toContain('x-client-version');
    expect(preflight.headers['access-control-allow-headers']).toContain('x-client-runtime-version');
    const simple = await app.inject({ url: '/v1/test/ping', headers: { origin: TEST_WEB_ORIGIN } });
    expect(simple.headers['access-control-expose-headers']).toContain('x-api-version');
  });
});

describe('GET /v1/app/compatibility', () => {
  async function check(platform: string, version: string) {
    const { app } = await start();
    return app.inject({ url: `/v1/app/compatibility?platform=${platform}&version=${version}` });
  }

  it('requires an update below the minimum, with the store link', async () => {
    const response = await check('ios', '1.0.0');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(appCompatibilitySchema.parse(response.json())).toEqual({
      status: 'update_required',
      platform: 'ios',
      version: '1.0.0',
      minVersion: '1.2.0',
      latestVersion: '1.4.0',
      storeUrl: 'https://apps.apple.com/app/id0000000000',
      api: { contractVersion: CONTRACT_VERSION, serverVersion: testConfig.version },
    });
  });

  it('offers an update between the minimum and the latest', async () => {
    const response = await check('ios', '1.3.0');
    expect(response.json()).toMatchObject({ status: 'update_available', latestVersion: '1.4.0' });
  });

  it('is supported at the latest, and without an announced latest', async () => {
    expect((await check('ios', '1.4.0')).json()).toMatchObject({ status: 'supported' });
    expect((await check('android', '1.1.0')).json()).toMatchObject({
      status: 'supported',
      latestVersion: null,
      storeUrl: null,
    });
  });

  it('validates the query', async () => {
    for (const query of [
      'platform=web&version=1.0.0',
      'platform=ios&version=1.0',
      'platform=ios',
      'platform=ios&version=1.0.0&extra=1',
    ]) {
      const { app } = await start();
      const response = await app.inject({ url: `/v1/app/compatibility?${query}` });
      expect(response.statusCode, query).toBe(400);
      expect(errorOf(response.body).code).toBe('validation_failed');
    }
  });
});
