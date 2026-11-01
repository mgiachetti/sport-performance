import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  apiEndpoints,
  defineEndpoint,
  errorEnvelopeSchema,
  healthSchema,
  type ErrorEnvelope,
} from '@sport-performance/contracts';
import { parseClubId, parseUserId } from '@sport-performance/domain';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AuthContext } from './auth/context.js';
import { fastifyPath, registerEndpoint } from './http/endpoint.js';
import { HttpError } from './http/errors.js';
import { IMPLEMENTED_ENDPOINTS, PENDING_ENDPOINTS } from './routes/index.js';
import { fakeDatabase, recordingReporter, testApp } from './testing/support.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const userId = parseUserId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10');
const clubId = parseClubId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f');

/** Endpoints of a test catalog, to exercise the endpoint helper end to end. */
const echoEndpoint = defineEndpoint({
  method: 'POST',
  path: '/v1/test/echo/{id}',
  summary: 'Echo',
  tags: ['system'],
  auth: 'public',
  params: z.object({ id: z.uuid() }),
  query: z.object({ limit: z.coerce.number().int().min(1).max(10).default(5) }),
  body: z.object({ heightCm: z.number().positive() }),
  response: {
    status: 201,
    description: 'Echo',
    schema: z.object({ id: z.string(), limit: z.number(), heightCm: z.number() }),
  },
  errors: [],
});

const meEndpoint = defineEndpoint({
  method: 'GET',
  path: '/v1/test/me',
  summary: 'Me',
  tags: ['system'],
  auth: 'session',
  response: {
    status: 200,
    description: 'Me',
    schema: z.object({ userId: z.string(), clubId: z.string().nullable() }),
  },
  errors: [],
});

const brokenEndpoint = defineEndpoint({
  method: 'GET',
  path: '/v1/test/broken',
  summary: 'Broken',
  tags: ['system'],
  auth: 'public',
  response: { status: 200, description: 'Broken', schema: z.object({ count: z.number() }) },
  errors: ['not_found'],
});

const emptyEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/v1/test/empty',
  summary: 'Empty',
  tags: ['system'],
  auth: 'public',
  response: { status: 204, description: 'Nothing', schema: undefined },
  errors: [],
});

function registerTestRoutes(app: FastifyInstance): void {
  registerEndpoint(app, echoEndpoint, {
    transaction: false,
    handler: ({ params, query, body }) =>
      Promise.resolve({ id: params.id, limit: query.limit, heightCm: body.heightCm }),
  });
  registerEndpoint(app, meEndpoint, {
    transaction: false,
    handler: (_input, { auth }) =>
      Promise.resolve({ userId: auth.userId, clubId: auth.membership?.clubId ?? null }),
  });
  registerEndpoint(app, brokenEndpoint, {
    transaction: false,
    // Simulates a handler drifting from its contract.
    handler: () => Promise.resolve({ count: 'many' } as unknown as { count: number }),
  });
  registerEndpoint(app, emptyEndpoint, {
    transaction: false,
    handler: () => Promise.resolve(undefined),
  });
  app.get('/v1/test/boom', () => {
    throw new Error('secret internal detail: Key (email)=(someone@example.com)');
  });
  app.get('/v1/test/not-found', () => {
    throw new HttpError('not_found', 'Player not found');
  });
}

function envelope(body: string): ErrorEnvelope {
  return errorEnvelopeSchema.parse(JSON.parse(body));
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(options: Parameters<typeof testApp>[0] = {}) {
  const built = await testApp({ register: registerTestRoutes, ...options });
  app = built.app;
  return built;
}

describe('request id', () => {
  it('generates a UUID and returns it in the header and the error envelope', async () => {
    const { app } = await start();
    const response = await app.inject({ method: 'GET', url: '/nope' });
    const id = response.headers['x-request-id'];
    expect(id).toMatch(UUID_PATTERN);
    expect(envelope(response.body).error.requestId).toBe(id);
  });

  it('reuses a safe incoming x-request-id and replaces an unsafe one', async () => {
    const { app } = await start();
    const safe = await app.inject({
      url: '/health/live',
      headers: { 'x-request-id': 'web-1234abcd' },
    });
    expect(safe.headers['x-request-id']).toBe('web-1234abcd');
    const unsafe = await app.inject({
      url: '/health/live',
      headers: { 'x-request-id': 'bad id\nwith "quotes"' },
    });
    expect(unsafe.headers['x-request-id']).toMatch(UUID_PATTERN);
  });

  it('is on every log line of the request', async () => {
    const { app, logs } = await start();
    await app.inject({ url: '/v1/test/not-found', headers: { 'x-request-id': 'trace-0001' } });
    const lines = logs.lines().filter((line) => line.requestId === 'trace-0001');
    expect(lines.map((line) => line.msg)).toEqual([
      'incoming request',
      'request rejected',
      'request completed',
    ]);
  });
});

describe('error envelope', () => {
  it('answers unknown routes with not_found', async () => {
    const { app } = await start();
    const response = await app.inject({ method: 'GET', url: '/v1/nothing?email=a@b.c' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(envelope(response.body).error).toMatchObject({
      code: 'not_found',
      message: 'Route GET /v1/nothing not found',
    });
  });

  it('answers HttpError with its code', async () => {
    const { app } = await start();
    const response = await app.inject({ url: '/v1/test/not-found' });
    expect(response.statusCode).toBe(404);
    expect(envelope(response.body).error).toMatchObject({
      code: 'not_found',
      message: 'Player not found',
    });
  });

  it('hides unexpected errors behind a generic 500, logs and reports them', async () => {
    const reporter = recordingReporter();
    const { app, logs } = await start({ errorReporter: reporter });
    const response = await app.inject({ url: '/v1/test/boom' });
    expect(response.statusCode).toBe(500);
    const { error } = envelope(response.body);
    expect(error).toMatchObject({ code: 'internal_error', message: 'Internal server error' });
    expect(response.body).not.toContain('secret');
    expect(reporter.captured).toHaveLength(1);
    expect(reporter.captured[0]?.context).toEqual({
      requestId: error.requestId,
      method: 'GET',
      route: '/v1/test/boom',
      userId: undefined,
      clubId: undefined,
    });
    const logged = logs.lines().find((line) => line.msg === 'unexpected error');
    expect(logged?.level).toBe('error');
    expect(logged?.requestId).toBe(error.requestId);
  });

  it('does not report client errors', async () => {
    const reporter = recordingReporter();
    const { app } = await start({ errorReporter: reporter });
    await app.inject({ url: '/v1/test/not-found' });
    await app.inject({ url: '/nope' });
    expect(reporter.captured).toEqual([]);
  });

  it('maps Fastify client errors to the envelope', async () => {
    const { app } = await start({
      config: {
        version: 'test',
        trustProxyHops: 0,
        bodyLimitBytes: 1024,
        health: { databaseTimeoutMs: 500 },
      },
    });
    const id = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';
    const badJson = await app.inject({
      method: 'POST',
      url: `/v1/test/echo/${id}`,
      headers: { 'content-type': 'application/json' },
      payload: '{"heightCm":',
    });
    expect(badJson.statusCode).toBe(400);
    expect(envelope(badJson.body).error.code).toBe('bad_request');

    const tooLarge = await app.inject({
      method: 'POST',
      url: `/v1/test/echo/${id}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ heightCm: 1, padding: 'x'.repeat(2048) }),
    });
    expect(tooLarge.statusCode).toBe(400);
    expect(envelope(tooLarge.body).error.code).toBe('bad_request');

    const wrongType = await app.inject({
      method: 'POST',
      url: `/v1/test/echo/${id}`,
      headers: { 'content-type': 'text/csv' },
      payload: 'a,b',
    });
    expect(wrongType.statusCode).toBe(400);
    expect(envelope(wrongType.body).error.code).toBe('bad_request');
  });
});

describe('endpoints from the contract', () => {
  const id = '0192E7A0-5C1A-7B7E-9F3A-2D4C6B8A1E0F';

  it('validates params, query and body and answers the declared status', async () => {
    const { app } = await start();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/test/echo/${id.toLowerCase()}?limit=3`,
      payload: { heightCm: 171.5 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id: id.toLowerCase(), limit: 3, heightCm: 171.5 });
  });

  it('reports every invalid field with its location', async () => {
    const { app } = await start();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/test/echo/not-a-uuid?limit=99',
      payload: { heightCm: -1 },
    });
    expect(response.statusCode).toBe(400);
    const { error } = envelope(response.body);
    expect(error.code).toBe('validation_failed');
    expect(error.details?.map((issue) => issue.path)).toEqual([
      ['params', 'id'],
      ['query', 'limit'],
      ['body', 'heightCm'],
    ]);
  });

  it('answers 204 without a body', async () => {
    const { app } = await start();
    const response = await app.inject({ method: 'DELETE', url: '/v1/test/empty' });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('never sends a response outside the contract', async () => {
    const reporter = recordingReporter();
    const { app, logs } = await start({ errorReporter: reporter });
    const response = await app.inject({ url: '/v1/test/broken' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('many');
    expect(reporter.captured).toHaveLength(1);
    const logged = logs.lines().find((line) => line.msg === 'unexpected error');
    expect(logged?.err).toMatchObject({
      type: 'ResponseContractError',
      issues: [{ path: 'count', code: 'invalid_type' }],
    });
  });

  it('serves or lists as pending every endpoint of the catalog', async () => {
    const { app } = await start();
    const served = [...IMPLEMENTED_ENDPOINTS].sort();
    const pending = Object.keys(PENDING_ENDPOINTS).sort();
    expect([...served, ...pending].sort()).toEqual(Object.keys(apiEndpoints).sort());
    expect(served.filter((key) => pending.includes(key))).toEqual([]);
    for (const key of served) {
      const endpoint = apiEndpoints[key];
      expect(app.hasRoute({ method: endpoint.method, url: fastifyPath(endpoint.path) })).toBe(true);
    }
  });
});

describe('request context hook', () => {
  it('answers session endpoints with unauthenticated when anonymous', async () => {
    const { app } = await start();
    const response = await app.inject({ url: '/v1/test/me' });
    expect(response.statusCode).toBe(401);
    expect(envelope(response.body).error.code).toBe('unauthenticated');
  });

  it('hands the authenticated caller to handlers and to the reporter', async () => {
    const auth: AuthContext = { userId, membership: { clubId, role: 'coach' } };
    const reporter = recordingReporter();
    const { app } = await start({
      authenticate: (request) =>
        Promise.resolve(request.headers.authorization === 'Bearer ok' ? auth : null),
      errorReporter: reporter,
    });
    const me = await app.inject({ url: '/v1/test/me', headers: { authorization: 'Bearer ok' } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ userId, clubId });

    await app.inject({ url: '/v1/test/boom', headers: { authorization: 'Bearer ok' } });
    expect(reporter.captured[0]?.context).toMatchObject({ userId, clubId });
  });

  it('treats a failing authenticate hook as a server error', async () => {
    const { app } = await start({
      authenticate: () => Promise.reject(new Error('session store down')),
    });
    const response = await app.inject({ url: '/health/live' });
    expect(response.statusCode).toBe(500);
    expect(envelope(response.body).error.code).toBe('internal_error');
  });
});

describe('logs', () => {
  it('keep query strings, IPs, credentials and bodies out', async () => {
    const { app, logs } = await start();
    await app.inject({
      method: 'POST',
      url: '/v1/test/echo/not-a-uuid?email=someone%40example.com',
      headers: { authorization: 'Bearer s3cr3t-token', cookie: 'session=s3cr3t-cookie' },
      payload: { heightCm: 'Juan Pérez' },
    });
    const raw = logs.raw();
    for (const forbidden of ['someone', 's3cr3t', 'Juan', '127.0.0.1', 'remoteAddress']) {
      expect(raw).not.toContain(forbidden);
    }
    const incoming = logs.lines().find((line) => line.msg === 'incoming request');
    expect(incoming?.req).toEqual({
      method: 'POST',
      path: '/v1/test/echo/not-a-uuid',
      route: '/v1/test/echo/:id',
    });
  });

  it('are JSON with service, version and ISO time', async () => {
    const { app, logs } = await start();
    await app.inject({ url: '/v1/health' });
    const line = logs.lines()[0];
    expect(line).toMatchObject({ service: 'api', version: 'test', level: 'info' });
    expect(typeof line?.time).toBe('string');
  });
});

describe('health', () => {
  it('live answers without touching the database', async () => {
    const { app } = await start({
      db: fakeDatabase({ ping: () => Promise.reject(new Error('down')) }),
    });
    const response = await app.inject({ url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(healthSchema.parse(response.json())).toMatchObject({
      status: 'ok',
      version: 'test-version',
    });
  });

  it.each(['/health/ready', '/v1/health'])('%s pings the database', async (url) => {
    const timeouts: number[] = [];
    const { app } = await start({
      db: fakeDatabase({
        ping: (timeoutMs) => {
          timeouts.push(timeoutMs);
          return Promise.resolve();
        },
      }),
    });
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(200);
    expect(healthSchema.parse(response.json()).status).toBe('ok');
    expect(timeouts).toEqual([500]);
  });

  it.each(['/health/ready', '/v1/health'])(
    '%s answers 503 when the database is down',
    async (url) => {
      const reporter = recordingReporter();
      const { app } = await start({
        db: fakeDatabase({ ping: () => Promise.reject(new Error('connect ECONNREFUSED')) }),
        errorReporter: reporter,
      });
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(503);
      expect(envelope(response.body).error.code).toBe('service_unavailable');
      expect(reporter.captured).toEqual([]);
    },
  );

  it('answers 503 with Connection: close while draining', async () => {
    const { app } = await start();
    app.lifecycle.draining = true;
    for (const url of ['/health/ready', '/health/live', '/v1/health', '/v1/test/me']) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(503);
      expect(response.headers.connection).toBe('close');
      expect(envelope(response.body).error.code).toBe('service_unavailable');
    }
  });
});

describe('OpenAPI', () => {
  it('serves the committed document of the contract', async () => {
    const { app } = await start();
    const response = await app.inject({ url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    const require = createRequire(import.meta.url);
    const committed: unknown = JSON.parse(
      await readFile(require.resolve('@sport-performance/contracts/openapi.json'), 'utf8'),
    );
    expect(response.json()).toEqual(committed);
  });
});
