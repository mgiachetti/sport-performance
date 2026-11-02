import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { defineEndpoint } from '@sport-performance/contracts';
import { parseUserId } from '@sport-performance/domain';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MAX_PARAM_LENGTH, type BuildAppOptions } from '../app.js';
import type { AuthContext } from '../auth/context.js';
import { createMemoryRateLimiter, type RateLimiter } from '../auth/rate-limit.js';
import { registerEndpoint } from '../http/endpoint.js';
import { offlineAuthModule, TEST_WEB_ORIGIN } from '../testing/identity.js';
import { testApp, testAuthContext, testConfig } from '../testing/support.js';
import { HSTS_VALUE, SECURITY_HEADERS } from './headers.js';
import { DEFAULT_ROUTE_CLASS_LIMITS, endpointRouteClass } from './rate-limit.js';

const ANA = parseUserId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e01');
const BETO = parseUserId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e02');

const createThing = defineEndpoint({
  method: 'POST',
  path: '/v1/test/things',
  summary: 'Create',
  tags: ['system'],
  auth: 'session',
  body: z.strictObject({
    name: z.string().max(100),
    tags: z.array(z.strictObject({ label: z.string() })).default([]),
  }),
  response: { status: 201, description: 'Created', schema: z.object({ name: z.string() }) },
  errors: [],
});

const listThings = defineEndpoint({
  method: 'GET',
  path: '/v1/test/things/{thingId}',
  summary: 'Read',
  tags: ['system'],
  auth: 'session',
  params: z.strictObject({ thingId: z.string() }),
  query: z.strictObject({ limit: z.coerce.number().int().default(5) }),
  response: { status: 200, description: 'Ok', schema: z.object({ id: z.string() }) },
  errors: [],
});

const publicPost = defineEndpoint({
  method: 'POST',
  path: '/v1/test/public',
  summary: 'Public post',
  tags: ['system'],
  auth: 'public',
  body: z.strictObject({ token: z.string().max(100_000) }),
  response: { status: 202, description: 'Ok', schema: z.object({ ok: z.boolean() }) },
  errors: [],
});

function registerTestRoutes(app: FastifyInstance): void {
  registerEndpoint(app, createThing, {
    transaction: false,
    handler: ({ body }) => Promise.resolve({ name: body.name }),
  });
  registerEndpoint(app, listThings, {
    transaction: false,
    handler: ({ params }) => Promise.resolve({ id: params.thingId }),
  });
  registerEndpoint(app, publicPost, {
    transaction: false,
    handler: () => Promise.resolve({ ok: true }),
  });
  app.get('/v1/test/banner', (_request, reply) =>
    reply.header('x-powered-by', 'Express').header('server', 'nginx/1.0').send({ ok: true }),
  );
}

/** Caller from a header, so one test drives several users from the same IP. */
function headerAuthenticate(request: {
  headers: Record<string, unknown>;
}): Promise<AuthContext | null> {
  const user = request.headers['x-test-user'];
  if (user === 'ana') return Promise.resolve(testAuthContext(ANA));
  if (user === 'beto') return Promise.resolve(testAuthContext(BETO));
  return Promise.resolve(null);
}

let current: FastifyInstance | undefined;

async function start(options: Partial<BuildAppOptions> = {}) {
  const started = await testApp({
    register: registerTestRoutes,
    authenticate: headerAuthenticate,
    rateLimitStore: createMemoryRateLimiter('test-secret'),
    ...options,
  });
  current = started.app;
  return started;
}

afterEach(async () => {
  await current?.close();
  current = undefined;
});

interface Envelope {
  error: { code: string; details?: { path: (string | number)[]; code: string }[] };
}

describe('security headers', () => {
  it('are on successes, errors, 404s and validation failures', async () => {
    const { app } = await start();
    const responses = await Promise.all([
      app.inject({ url: '/health/live' }),
      app.inject({ url: '/nope' }),
      app.inject({ url: '/v1/test/things/x' }),
      app.inject({ method: 'POST', url: '/v1/test/public', payload: { nope: 1 } }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 404, 401, 400]);
    for (const response of responses) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(response.headers[name]).toBe(value);
      }
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['strict-transport-security']).toBeUndefined();
    }
    expect(SECURITY_HEADERS['content-security-policy']).toContain("default-src 'none'");
    expect(SECURITY_HEADERS['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('adds HSTS in production', async () => {
    const { app } = await start({ config: { ...testConfig, securityHeaders: { hsts: true } } });
    const response = await app.inject({ url: '/health/live' });
    expect(response.headers['strict-transport-security']).toBe(HSTS_VALUE);
  });

  it('never advertises the stack', async () => {
    const { app } = await start();
    const response = await app.inject({ url: '/v1/test/banner' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers.server).toBeUndefined();
  });

  it('lets cacheable routes set their own Cache-Control', async () => {
    const { app } = await start();
    const response = await app.inject({ url: '/openapi.json' });
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('CORS', () => {
  it('answers preflights of the web origins only, with credentials and the security headers', async () => {
    const { app } = await start({ auth: offlineAuthModule() });
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/v1/me',
      headers: {
        origin: TEST_WEB_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-membership-id',
      },
    });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers.vary).toContain('Origin');
    expect(allowed.headers['x-frame-options']).toBe('DENY');

    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/v1/me',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'GET' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    const simple = await app.inject({
      url: '/health/live',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(simple.headers['access-control-allow-origin']).toBeUndefined();
    const nullOrigin = await app.inject({ url: '/health/live', headers: { origin: 'null' } });
    expect(nullOrigin.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('strict validation and size limits', () => {
  it('rejects unknown keys in body, nested objects and query', async () => {
    const { app } = await start();
    const headers = { 'x-test-user': 'ana' };
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/test/things',
      headers,
      payload: { name: 'cono', tags: [{ label: 'a' }] },
    });
    expect(ok.statusCode).toBe(201);

    const extra = await app.inject({
      method: 'POST',
      url: '/v1/test/things',
      headers,
      payload: { name: 'cono', role: 'admin' },
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json<Envelope>().error).toMatchObject({
      code: 'validation_failed',
      details: [{ path: ['body'], code: 'unrecognized_keys' }],
    });

    const nested = await app.inject({
      method: 'POST',
      url: '/v1/test/things',
      headers,
      payload: { name: 'cono', tags: [{ label: 'a', clubId: 'x' }] },
    });
    expect(nested.json<Envelope>().error.details?.[0]?.path).toEqual(['body', 'tags', 0]);

    const query = await app.inject({ url: '/v1/test/things/x?limit=2&debug=1', headers });
    expect(query.statusCode).toBe(400);
    expect(query.json<Envelope>().error.details?.[0]).toMatchObject({
      path: ['query'],
      code: 'unrecognized_keys',
    });
  });

  it('refuses prototype pollution in JSON bodies', async () => {
    const { app } = await start();
    for (const payload of [
      '{"name":"x","__proto__":{"admin":true}}',
      '{"name":"x","constructor":{"prototype":{"admin":true}}}',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/test/things',
        headers: { 'x-test-user': 'ana', 'content-type': 'application/json' },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<Envelope>().error.code).toBe('bad_request');
    }
  });

  it('caps bodies of public endpoints that change state far below the global limit', async () => {
    const { app } = await start();
    expect(endpointRouteClass(publicPost)).toBe('auth');
    const small = await app.inject({
      method: 'POST',
      url: '/v1/test/public',
      payload: { token: 'x'.repeat(1000) },
    });
    expect(small.statusCode).toBe(202);
    const large = await app.inject({
      method: 'POST',
      url: '/v1/test/public',
      payload: { token: 'x'.repeat(20_000) },
    });
    expect(large.statusCode).toBe(413);
    expect(large.json<Envelope>().error.code).toBe('payload_too_large');
    // The same size is fine where the global limit applies.
    const session = await app.inject({
      method: 'POST',
      url: '/v1/test/things',
      headers: { 'x-test-user': 'ana' },
      payload: { name: 'x', tags: Array.from({ length: 500 }, () => ({ label: 'x'.repeat(30) })) },
    });
    expect(session.statusCode).toBe(201);
  });

  it('does not route path params longer than the limit', async () => {
    const { app } = await start();
    const headers = { 'x-test-user': 'ana' };
    const fits = await app.inject({
      url: `/v1/test/things/${'a'.repeat(MAX_PARAM_LENGTH)}`,
      headers,
    });
    expect(fits.statusCode).toBe(200);
    const tooLong = await app.inject({
      url: `/v1/test/things/${'a'.repeat(MAX_PARAM_LENGTH + 1)}`,
      headers,
    });
    expect(tooLong.statusCode).toBe(404);
    expect(tooLong.json<Envelope>().error.code).toBe('not_found');
    expect(tooLong.body).not.toContain('aaaa');
    expect(tooLong.headers['x-content-type-options']).toBe('nosniff');
    expect(tooLong.headers['x-request-id']).toBeDefined();
    const malformed = await app.inject({ url: '/v1/test/things/%E0%A4%A', headers });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json<Envelope>().error.code).toBe('bad_request');
    expect(malformed.headers['content-security-policy']).toBeDefined();
  });
});

describe('general rate limits', () => {
  const tight = {
    public: { perIp: { name: 't_public_ip', max: 2, windowS: 60 } },
    read: {
      perIp: { name: 't_read_ip', max: 100, windowS: 60 },
      perUser: { name: 't_read_user', max: 2, windowS: 60 },
    },
    write: {
      perIp: { name: 't_write_ip', max: 100, windowS: 60 },
      perUser: { name: 't_write_user', max: 1, windowS: 60 },
    },
  };

  it('limits anonymous requests per IP with 429, Retry-After and the envelope', async () => {
    const { app } = await start({ routeClassLimits: tight });
    const ip = (remoteAddress: string) => ({ url: '/openapi.json', remoteAddress });
    expect((await app.inject(ip('10.0.0.1'))).statusCode).toBe(200);
    // 404s count too: scanners are limited like any other caller.
    expect((await app.inject({ url: '/nope', remoteAddress: '10.0.0.1' })).statusCode).toBe(404);
    const limited = await app.inject(ip('10.0.0.1'));
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.json<Envelope>().error.code).toBe('rate_limited');
    expect(limited.headers['x-content-type-options']).toBe('nosniff');
    expect((await app.inject(ip('10.0.0.2'))).statusCode).toBe(200);
  });

  it('limits each user on their own, with separate budgets for reads and writes', async () => {
    const { app } = await start({ routeClassLimits: tight });
    const read = (user: string) =>
      app.inject({ url: '/v1/test/things/x', headers: { 'x-test-user': user } });
    const write = (user: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/test/things',
        headers: { 'x-test-user': user },
        payload: { name: 'x' },
      });
    expect((await read('ana')).statusCode).toBe(200);
    expect((await read('ana')).statusCode).toBe(200);
    expect((await read('ana')).statusCode).toBe(429);
    expect((await read('beto')).statusCode).toBe(200);
    expect((await write('ana')).statusCode).toBe(201);
    expect((await write('ana')).statusCode).toBe(429);
  });

  it('never limits the probes or CORS preflights', async () => {
    const { app } = await start({
      routeClassLimits: { public: { perIp: { name: 't_ip', max: 1, windowS: 60 } } },
    });
    for (let i = 0; i < 5; i += 1) {
      expect((await app.inject({ url: '/health/live' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'OPTIONS', url: '/v1/test/public' })).statusCode).not.toBe(
        429,
      );
    }
  });

  it('lets requests through and logs when the store fails or is slow', async () => {
    const failing: RateLimiter = {
      hit: () => Promise.reject(new Error('connection refused')),
      prune: () => Promise.resolve(0),
    };
    const { app, logs } = await start({ rateLimitStore: failing });
    expect((await app.inject({ url: '/openapi.json' })).statusCode).toBe(200);
    expect(logs.lines().some((line) => line.msg?.includes('rate limit store unavailable'))).toBe(
      true,
    );

    await app.close();
    const slow: RateLimiter = {
      hit: () => new Promise(() => undefined),
      prune: () => Promise.resolve(0),
    };
    const restarted = await start({
      rateLimitStore: slow,
      config: { ...testConfig, rateLimit: { enabled: true, timeoutMs: 50 } },
    });
    expect((await restarted.app.inject({ url: '/openapi.json' })).statusCode).toBe(200);
  });

  it('is off when disabled', async () => {
    const { app } = await start({
      routeClassLimits: { public: { perIp: { name: 't_ip', max: 1, windowS: 60 } } },
      config: { ...testConfig, rateLimit: { enabled: false, timeoutMs: 500 } },
    });
    for (let i = 0; i < 3; i += 1) {
      expect((await app.inject({ url: '/openapi.json' })).statusCode).toBe(200);
    }
  });

  it('defines a class for every kind of route, with per-user limits under per-IP ones', () => {
    for (const [name, limits] of Object.entries(DEFAULT_ROUTE_CLASS_LIMITS)) {
      if (name === 'exempt') {
        expect(limits).toEqual({});
        continue;
      }
      const { perIp, perUser } = limits as { perIp: { max: number }; perUser?: { max: number } };
      expect(perIp.max).toBeGreaterThan(0);
      if (perUser !== undefined) expect(perUser.max).toBeLessThan(perIp.max);
    }
    expect(endpointRouteClass({ auth: 'public', method: 'GET' })).toBe('public');
    expect(endpointRouteClass({ auth: 'public', method: 'POST' })).toBe('auth');
    expect(endpointRouteClass({ auth: 'club', method: 'GET' })).toBe('read');
    expect(endpointRouteClass({ auth: 'session', method: 'DELETE' })).toBe('write');
  });
});

describe('HTTP server limits', () => {
  it('configures the timeouts and the connection limit of the Node server', async () => {
    const { app } = await start({
      config: {
        ...testConfig,
        http: {
          requestTimeoutMs: 20_000,
          headersTimeoutMs: 5000,
          keepAliveTimeoutMs: 61_000,
          connectionTimeoutMs: 45_000,
          maxConnections: 321,
          maxHeaderSizeBytes: 8192,
        },
      },
    });
    expect(app.server.requestTimeout).toBe(20_000);
    expect(app.server.headersTimeout).toBe(5000);
    expect(app.server.keepAliveTimeout).toBe(61_000);
    expect(app.server.timeout).toBe(45_000);
    expect(app.server.maxConnections).toBe(321);
  });

  it('refuses headers over the size limit with 431', async () => {
    const { app } = await start({
      config: { ...testConfig, http: { ...testConfig.http, maxHeaderSizeBytes: 4096 } },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const status = (headerBytes: number) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            path: '/health/live',
            headers: { 'x-big': 'x'.repeat(headerBytes) },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
    expect(await status(100)).toBe(200);
    expect(await status(8000)).toBe(431);
  });
});
