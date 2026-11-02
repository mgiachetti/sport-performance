import { parseClubId } from '@sport-performance/domain';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { defineEndpoint, type EndpointCatalog } from '../endpoint.js';
import type { ClubTheme, Health } from '../endpoints/index.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import {
  createApiClient,
  parseRetryAfter,
  type FetchLike,
  type FetchRequestInit,
} from './client.js';
import { ApiContractError, ApiError, ApiNetworkError } from './errors.js';

interface Recorded {
  url: string;
  init: FetchRequestInit;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(text),
  };
}

function mockFetch(...responses: ReturnType<typeof jsonResponse>[]) {
  const calls: Recorded[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected request');
    return Promise.resolve(next);
  };
  return { fetch, calls };
}

const theme: ClubTheme = {
  clubId: parseClubId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f'),
  slug: 'orc',
  name: 'Olivos Rugby Club',
  shortName: 'ORC',
  logoUrl: null,
  colors: {
    primary: '#F1882A',
    onPrimary: '#050505',
    secondary: '#050505',
    onSecondary: '#F3EEE7',
  },
  updatedAt: '2026-11-01T12:00:00.000Z',
};

describe('createApiClient (API catalog)', () => {
  it('calls getHealth without input and returns the typed payload', async () => {
    const health: Health = { status: 'ok', version: '1.0.0', time: '2026-11-01T12:00:00.000Z' };
    const { fetch, calls } = mockFetch(jsonResponse(200, health));
    const api = createApiClient({ baseUrl: 'https://api.example.com/', fetch });

    const result = await api.getHealth();

    expectTypeOf(result).toEqualTypeOf<Health>();
    expect(result).toEqual(health);
    expect(calls).toEqual([
      {
        url: 'https://api.example.com/v1/health',
        init: { method: 'GET', headers: { accept: 'application/json' } },
      },
    ]);
  });

  it('fills path params, merges headers and passes credentials and signal', async () => {
    const { fetch, calls } = mockFetch(jsonResponse(200, { ...theme, extra: true }));
    const controller = new AbortController();
    const api = createApiClient({
      baseUrl: 'https://api.example.com',
      fetch,
      credentials: 'include',
      headers: () => Promise.resolve({ 'accept-language': 'es-AR', authorization: 'Bearer t' }),
    });

    const result = await api.getClubTheme(
      { params: { clubSlug: 'orc' } },
      { signal: controller.signal, headers: { authorization: 'Bearer override' } },
    );

    expect(result).toEqual(theme);
    expect(calls[0]?.url).toBe('https://api.example.com/v1/clubs/orc/theme');
    expect(calls[0]?.init).toEqual({
      method: 'GET',
      headers: {
        accept: 'application/json',
        'accept-language': 'es-AR',
        authorization: 'Bearer override',
      },
      credentials: 'include',
      signal: controller.signal,
    });
  });

  it('validates input before sending', async () => {
    const { fetch, calls } = mockFetch();
    const api = createApiClient({ baseUrl: 'https://api.example.com', fetch });

    const error = await api
      .getClubTheme({ params: { clubSlug: 'Not A Slug' } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiContractError);
    expect(error).toMatchObject({ side: 'request', operationId: 'getClubTheme' });
    expect((error as ApiContractError).issues[0]?.path).toEqual(['params', 'clubSlug']);
    expect(calls).toHaveLength(0);
  });

  it('throws ApiError with the envelope on error responses', async () => {
    const { fetch } = mockFetch(
      jsonResponse(404, {
        error: { code: 'not_found', message: 'Club not found', requestId: 'req-1' },
      }),
    );
    const api = createApiClient({ baseUrl: 'https://api.example.com', fetch });

    const error = await api.getClubTheme({ params: { clubSlug: 'nope' } }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'Club not found',
      requestId: 'req-1',
      details: [],
      operationId: 'getClubTheme',
    });
  });

  it('keeps unknown error codes and falls back to the request id header', async () => {
    const { fetch } = mockFetch(
      jsonResponse(
        403,
        { error: { code: 'consent_required', message: 'm' } },
        { 'x-request-id': 'req-2' },
      ),
    );
    const api = createApiClient({ baseUrl: 'https://api.example.com', fetch });

    await expect(api.getHealth()).rejects.toMatchObject({
      code: 'consent_required',
      requestId: 'req-2',
    });
  });

  it('exposes Retry-After of a rate-limited answer', async () => {
    const { fetch } = mockFetch(
      jsonResponse(
        429,
        { error: { code: 'rate_limited', message: 'Too many requests' } },
        { 'retry-after': '42' },
      ),
      jsonResponse(429, { error: { code: 'rate_limited', message: 'Burnt code' } }),
    );
    const api = createApiClient({ baseUrl: 'https://api.example.com', fetch });

    await expect(api.getHealth()).rejects.toMatchObject({ code: 'rate_limited', retryAfterS: 42 });
    await expect(api.getHealth()).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterS: undefined,
    });
  });

  it('parses both forms of Retry-After', () => {
    const now = () => Date.parse('2026-11-01T12:00:00.000Z');
    expect(parseRetryAfter('120', now)).toBe(120);
    expect(parseRetryAfter(' 7 ', now)).toBe(7);
    expect(parseRetryAfter('Sun, 01 Nov 2026 12:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('Sun, 01 Nov 2026 11:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it('derives a code from the status when there is no envelope', async () => {
    const { fetch } = mockFetch(jsonResponse(502, '<html>Bad gateway</html>'));
    const api = createApiClient({ baseUrl: 'https://api.example.com', fetch });

    const error = await api.getHealth().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: 'service_unavailable' });
  });

  it('wraps network failures', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const api = createApiClient({
      baseUrl: 'https://api.example.com',
      fetch: () => Promise.reject(abort),
    });

    const error = await api.getHealth().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiNetworkError);
    expect((error as ApiNetworkError).aborted).toBe(true);
    expect((error as ApiNetworkError).cause).toBe(abort);
  });

  it('rejects off-contract and non-JSON responses', async () => {
    const { fetch } = mockFetch(
      jsonResponse(200, { status: 'ok', version: '1' }),
      jsonResponse(200, 'not json'),
    );
    const api = createApiClient({ baseUrl: 'https://api.example.com', fetch });

    const offContract = await api.getHealth().catch((e: unknown) => e);
    expect(offContract).toBeInstanceOf(ApiContractError);
    expect(offContract).toMatchObject({ side: 'response', status: 200 });
    expect((offContract as ApiContractError).issues[0]?.path).toEqual(['time']);

    await expect(api.getHealth()).rejects.toMatchObject({ side: 'response', message: /not JSON/ });
  });

  it('can skip response validation', async () => {
    const { fetch } = mockFetch(jsonResponse(200, { status: 'ok' }));
    const api = createApiClient({
      baseUrl: 'https://api.example.com',
      fetch,
      validateResponses: false,
    });

    await expect(api.getHealth()).resolves.toEqual({ status: 'ok' });
  });

  it('uses the global fetch by default', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok', version: '1', time: '2026-11-01T00:00:00Z' })),
      );
    try {
      const api = createApiClient({ baseUrl: 'https://api.example.com' });
      await expect(api.getHealth()).resolves.toMatchObject({ status: 'ok' });
      expect(spy).toHaveBeenCalledWith(
        'https://api.example.com/v1/health',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe('createApiClient (custom catalog)', () => {
  const item = z.strictObject({ id: z.uuid(), name: z.string() });
  const catalog = {
    listItems: defineEndpoint({
      method: 'GET',
      path: '/v1/clubs/{clubId}/items',
      summary: 'List',
      tags: ['clubs'],
      auth: 'session',
      params: z.strictObject({ clubId: z.string() }),
      query: pageQuerySchema.extend({ tag: z.array(z.string()).optional() }),
      response: { status: 200, description: 'Page', schema: pageOf(item) },
      errors: [],
    }),
    createItem: defineEndpoint({
      method: 'POST',
      path: '/v1/items',
      summary: 'Create',
      tags: ['clubs'],
      auth: 'session',
      body: item.omit({ id: true }),
      response: { status: 201, description: 'Created', schema: item },
      errors: [],
    }),
    deleteItem: defineEndpoint({
      method: 'DELETE',
      path: '/v1/items/{itemId}',
      summary: 'Delete',
      tags: ['clubs'],
      auth: 'session',
      params: z.strictObject({ itemId: z.uuid() }),
      response: { status: 204, description: 'Deleted', schema: undefined },
      errors: [],
    }),
  } satisfies EndpointCatalog;
  const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  it('encodes path params and query (defaults, arrays, optional)', async () => {
    const { fetch, calls } = mockFetch(jsonResponse(200, { items: [], nextCursor: null }));
    const api = createApiClient({ baseUrl: 'https://api.example.com/base', fetch }, catalog);

    await api.listItems({
      params: { clubId: 'a/b c' },
      query: { tag: ['x y', 'z&'], cursor: 'c1' },
    });

    expect(calls[0]?.url).toBe(
      'https://api.example.com/base/v1/clubs/a%2Fb%20c/items?cursor=c1&limit=50&tag=x+y&tag=z%26',
    );
  });

  it('sends JSON bodies', async () => {
    const { fetch, calls } = mockFetch(jsonResponse(201, { id, name: 'Cono' }));
    const api = createApiClient({ baseUrl: 'https://api.example.com', fetch }, catalog);

    const created = await api.createItem({ body: { name: 'Cono' } });

    expectTypeOf(created).toEqualTypeOf<{ id: string; name: string }>();
    expect(created).toEqual({ id, name: 'Cono' });
    expect(calls[0]?.init).toEqual({
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"name":"Cono"}',
    });
  });

  it('resolves 204 to undefined', async () => {
    const { fetch } = mockFetch(jsonResponse(204, ''));
    const api = createApiClient({ baseUrl: 'https://api.example.com', fetch }, catalog);

    expectTypeOf(api.deleteItem).returns.resolves.toEqualTypeOf<undefined>();
    await expect(api.deleteItem({ params: { itemId: id } })).resolves.toBeUndefined();
  });

  it('requires input when the endpoint has required parts', async () => {
    const api = createApiClient(
      { baseUrl: 'https://api.example.com', fetch: mockFetch().fetch },
      catalog,
    );
    // @ts-expect-error -- params are required
    await expect(api.deleteItem()).rejects.toBeInstanceOf(ApiContractError);
    // @ts-expect-error -- body is required
    await expect(api.createItem({})).rejects.toMatchObject({
      side: 'request',
      issues: [{ path: ['body'] }],
    });
  });
});
