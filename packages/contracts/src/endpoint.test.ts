import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  API_TAGS,
  defineEndpoint,
  endpointErrorCodes,
  pathParamNames,
  type EndpointDefinition,
  type EndpointInput,
  type EndpointOutput,
  type PathParamNames,
} from './endpoint.js';
import { apiEndpoints, type ClubTheme, type Health } from './endpoints/index.js';
import { pageOf, pageQuerySchema } from './primitives/pagination.js';

const item = z.object({ id: z.uuid(), name: z.string() });

const listItems = defineEndpoint({
  method: 'GET',
  path: '/v1/clubs/{clubId}/items',
  summary: 'List',
  tags: ['clubs'],
  auth: 'session',
  params: z.object({ clubId: z.uuid() }),
  query: pageQuerySchema,
  response: { status: 200, description: 'Page', schema: pageOf(item) },
  errors: ['forbidden'],
});

const deleteItem = defineEndpoint({
  method: 'DELETE',
  path: '/v1/items/{itemId}',
  summary: 'Delete',
  tags: ['clubs'],
  auth: 'session',
  params: z.object({ itemId: z.uuid() }),
  response: { status: 204, description: 'Deleted', schema: undefined },
  errors: ['not_found'],
});

describe('defineEndpoint', () => {
  it('extracts path placeholders', () => {
    expect(pathParamNames('/v1/clubs/{clubId}/players/{playerId}')).toEqual(['clubId', 'playerId']);
    expect(pathParamNames('/v1/health')).toEqual([]);
    expectTypeOf<PathParamNames<'/v1/a/{x}/b/{y}'>>().toEqualTypeOf<'x' | 'y'>();
  });

  it('rejects params that do not match the path', () => {
    const define = defineEndpoint as (endpoint: unknown) => unknown;
    const base = {
      method: 'GET',
      summary: 's',
      tags: ['clubs'],
      auth: 'public',
      response: { status: 200, description: 'd', schema: z.object({}) },
      errors: [],
    };
    expect(() => define({ ...base, path: '/v1/clubs/{clubId}' })).toThrow(/do not match/);
    expect(() =>
      define({ ...base, path: '/v1/clubs/{clubId}', params: z.object({ id: z.string() }) }),
    ).toThrow(/do not match/);
    expect(() =>
      define({ ...base, path: '/v1/clubs', params: z.object({ id: z.string() }) }),
    ).toThrow(/do not match/);
  });

  it('rejects mismatched params at compile time', () => {
    expect(() =>
      defineEndpoint({
        method: 'GET',
        path: '/v1/clubs/{clubId}',
        summary: 's',
        tags: ['clubs'],
        auth: 'public',
        // @ts-expect-error -- `id` is not the `{clubId}` placeholder
        params: z.object({ id: z.string() }),
        response: { status: 200, description: 'd', schema: z.object({}) },
        errors: [],
      }),
    ).toThrow(/do not match/);
  });

  it('enforces the 204 / schema rule', () => {
    const define = defineEndpoint as (endpoint: unknown) => unknown;
    const base = {
      method: 'POST',
      path: '/v1/x',
      summary: 's',
      tags: ['clubs'],
      auth: 'public',
      errors: [],
    };
    expect(() =>
      define({ ...base, response: { status: 204, description: 'd', schema: z.object({}) } }),
    ).toThrow(/204/);
    expect(() =>
      define({ ...base, response: { status: 200, description: 'd', schema: undefined } }),
    ).toThrow(/required/);
  });

  it('adds implicit error codes', () => {
    expect(endpointErrorCodes(listItems).sort()).toEqual(
      ['forbidden', 'internal_error', 'unauthenticated', 'validation_failed'].sort(),
    );
    expect(endpointErrorCodes(apiEndpoints.getHealth).sort()).toEqual(
      ['internal_error', 'service_unavailable'].sort(),
    );
    expect(endpointErrorCodes(deleteItem).sort()).toEqual(
      ['internal_error', 'not_found', 'unauthenticated', 'validation_failed'].sort(),
    );
  });

  it('infers inputs and outputs', () => {
    expectTypeOf<EndpointInput<typeof listItems>>().toEqualTypeOf<
      { params: { clubId: string } } & {
        query?: { cursor?: string | undefined; limit?: number | undefined };
      }
    >();
    expectTypeOf<EndpointOutput<typeof listItems>>().toEqualTypeOf<{
      items: { id: string; name: string }[];
      nextCursor: string | null;
    }>();
    expectTypeOf<EndpointOutput<typeof deleteItem>>().toEqualTypeOf<undefined>();
    expectTypeOf<EndpointOutput<typeof apiEndpoints.getHealth>>().toEqualTypeOf<Health>();
    expectTypeOf<EndpointOutput<typeof apiEndpoints.getClubTheme>>().toEqualTypeOf<ClubTheme>();
  });
});

describe('endpoint catalog', () => {
  const entries: [string, EndpointDefinition][] = Object.entries(apiEndpoints);

  it('uses camelCase operationIds and versioned paths', () => {
    for (const [operationId, endpoint] of entries) {
      expect(operationId).toMatch(/^[a-z][a-zA-Z0-9]*$/);
      expect(endpoint.path).toMatch(/^\/v\d+\//);
    }
  });

  it('has unique routes', () => {
    const routes = entries.map(([, endpoint]) => `${endpoint.method} ${endpoint.path}`);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('declares params matching every path and known tags', () => {
    for (const [, endpoint] of entries) {
      expect(Object.keys(endpoint.params?.shape ?? {}).sort()).toEqual(
        pathParamNames(endpoint.path).sort(),
      );
      for (const tag of endpoint.tags) expect(Object.keys(API_TAGS)).toContain(tag);
    }
  });
});
