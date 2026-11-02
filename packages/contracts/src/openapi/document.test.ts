import { readFile } from 'node:fs/promises';
import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEndpoint, type EndpointCatalog } from '../endpoint.js';
import { apiEndpoints } from '../endpoints/index.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import {
  buildOpenApiDocument,
  serializeOpenApiDocument,
  type OpenApiDocument,
} from './document.js';

async function expectValidOpenApi(document: OpenApiDocument): Promise<void> {
  const validator = new Validator();
  const result = await validator.validate(document as unknown as Record<string, unknown>);
  expect(result.errors).toBeUndefined();
  expect(result.valid).toBe(true);
  expect(validator.version).toBe('3.1');
}

/** Every `$ref` in the document points to an existing component. */
function danglingRefs(document: OpenApiDocument): string[] {
  const refs: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (key === '$ref' && typeof child === 'string') refs.push(child);
        else walk(child);
      }
    }
  };
  walk(document);
  const prefix = '#/components/schemas/';
  return refs.filter(
    (ref) => !ref.startsWith(prefix) || !(ref.slice(prefix.length) in document.components.schemas),
  );
}

describe('buildOpenApiDocument (API catalog)', () => {
  const document = buildOpenApiDocument();

  // Validating the whole catalog takes seconds, more when every package tests at once.
  it('is a valid OpenAPI 3.1 document', { timeout: 30_000 }, async () => {
    await expectValidOpenApi(document);
    expect(danglingRefs(document)).toEqual([]);
  });

  it('matches the committed openapi.json (run `pnpm --filter @sport-performance/contracts openapi`)', async () => {
    const committed = await readFile(new URL('../../openapi.json', import.meta.url), 'utf8');
    expect(JSON.parse(committed)).toEqual(JSON.parse(serializeOpenApiDocument(document)));
  });

  it('describes every endpoint with its operationId', () => {
    const operationIds = Object.values(document.paths).flatMap((item) =>
      Object.values(item).map((operation) => operation.operationId),
    );
    expect(operationIds.sort()).toEqual(Object.keys(apiEndpoints).sort());
  });

  it('shares named schemas as components and uses the error envelope', () => {
    const operation = document.paths['/v1/clubs/{clubSlug}/theme']?.get;
    expect(operation?.responses['200']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ClubTheme',
    });
    expect(operation?.responses['404']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ErrorEnvelope',
    });
    expect(operation?.responses['404']?.description).toContain('not_found');
    expect(operation?.parameters).toEqual([
      expect.objectContaining({ name: 'clubSlug', in: 'path', required: true }),
    ]);
    expect(operation?.security).toEqual([]);
    expect(Object.keys(document.components.schemas)).toEqual(
      expect.arrayContaining([
        'ClubTheme',
        'ClubBrandColors',
        'Health',
        'ErrorEnvelope',
        'ErrorCode',
      ]),
    );
  });

  it('keeps response objects open for additive changes', () => {
    expect(document.components.schemas.ClubTheme).not.toHaveProperty('additionalProperties');
  });

  it('is deterministic', () => {
    expect(serializeOpenApiDocument(buildOpenApiDocument())).toBe(
      serializeOpenApiDocument(document),
    );
  });
});

describe('buildOpenApiDocument (generic features)', () => {
  const Player = z
    .strictObject({
      id: z.uuid(),
      name: z.string(),
      heightCm: z.number().positive(),
      active: z.boolean().default(true),
    })
    .meta({ id: 'TestPlayer' });

  const catalog = {
    listPlayers: defineEndpoint({
      method: 'GET',
      path: '/v1/clubs/{clubId}/players',
      summary: 'List players',
      tags: ['clubs'],
      auth: 'session',
      params: z.strictObject({ clubId: z.uuid() }),
      query: pageQuerySchema.extend({ search: z.string().optional() }),
      response: { status: 200, description: 'Page', schema: pageOf(Player) },
      errors: ['forbidden'],
    }),
    createPlayer: defineEndpoint({
      method: 'POST',
      path: '/v1/clubs/{clubId}/players',
      summary: 'Create player',
      tags: ['clubs'],
      auth: 'session',
      params: z.strictObject({ clubId: z.uuid() }),
      body: Player,
      response: { status: 201, description: 'Created', schema: Player },
      errors: ['conflict'],
    }),
    deletePlayer: defineEndpoint({
      method: 'DELETE',
      path: '/v1/players/{playerId}',
      summary: 'Delete player',
      tags: ['clubs'],
      auth: 'session',
      deprecated: true,
      params: z.strictObject({ playerId: z.uuid() }),
      response: { status: 204, description: 'Deleted', schema: undefined },
      errors: ['not_found'],
    }),
  } satisfies EndpointCatalog;

  const document = buildOpenApiDocument(catalog, { title: 'Test', version: '9.9.9' });

  it('is valid and has no dangling refs', async () => {
    await expectValidOpenApi(document);
    expect(danglingRefs(document)).toEqual([]);
    expect(document.info).toMatchObject({ title: 'Test', version: '9.9.9' });
  });

  it('groups methods under the same path', () => {
    expect(Object.keys(document.paths['/v1/clubs/{clubId}/players'] ?? {})).toEqual([
      'get',
      'post',
    ]);
  });

  it('documents query params with required flags and defaults', () => {
    const parameters = document.paths['/v1/clubs/{clubId}/players']?.get?.parameters ?? [];
    expect(
      parameters.map(({ name, in: location, required }) => [name, location, required]),
    ).toEqual([
      ['clubId', 'path', true],
      ['cursor', 'query', false],
      ['limit', 'query', false],
      ['search', 'query', false],
    ]);
    expect(parameters.find((parameter) => parameter.name === 'limit')?.schema).toMatchObject({
      type: 'integer',
      default: 50,
      maximum: 100,
    });
  });

  it('splits a component whose input and output differ', () => {
    const post = document.paths['/v1/clubs/{clubId}/players']?.post;
    expect(post?.requestBody?.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/TestPlayerInput',
    });
    expect(post?.responses['201']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/TestPlayer',
    });
    expect(document.components.schemas.TestPlayer?.required).toContain('active');
    expect(document.components.schemas.TestPlayerInput?.required).not.toContain('active');
  });

  it('marks session endpoints, implicit errors, 204 and deprecation', () => {
    const del = document.paths['/v1/players/{playerId}']?.delete;
    expect(del?.security).toEqual([{ sessionCookie: [] }, { bearerToken: [] }]);
    expect(del?.deprecated).toBe(true);
    expect(del?.responses['204']).toEqual({ description: 'Deleted' });
    expect(Object.keys(del?.responses ?? {})).toEqual(['204', '400', '401', '404', '429', '500']);
    expect(del?.responses['429']?.headers?.['Retry-After']?.schema).toEqual({
      type: 'integer',
      minimum: 1,
    });
    expect(del?.responses['404']?.headers).toBeUndefined();
    expect(Object.keys(document.components.securitySchemes)).toEqual([
      'sessionCookie',
      'bearerToken',
    ]);
  });

  it('documents the membership header and forbidden on club endpoints', () => {
    const clubCatalog = {
      listThings: defineEndpoint({
        method: 'GET',
        path: '/v1/things',
        summary: 'Club things',
        tags: ['clubs'],
        auth: 'club',
        response: { status: 200, description: 'Things', schema: z.object({ n: z.int() }) },
        errors: [],
      }),
    } satisfies EndpointCatalog;
    const get = buildOpenApiDocument(clubCatalog).paths['/v1/things']?.get;
    expect(get?.parameters?.map((p) => [p.name, p.in, p.required])).toEqual([
      ['x-membership-id', 'header', false],
    ]);
    expect(Object.keys(get?.responses ?? {})).toEqual(['200', '401', '403', '429', '500']);
    expect(get?.security).toEqual([{ sessionCookie: [] }, { bearerToken: [] }]);
  });

  it('rejects two different schemas with the same id', () => {
    const a = z.object({ a: z.string() }).meta({ id: 'Clash' });
    const b = z.object({ b: z.string() }).meta({ id: 'Clash' });
    const base = {
      method: 'GET',
      summary: 's',
      tags: ['clubs'],
      auth: 'public',
      errors: [],
    } as const;
    expect(() =>
      buildOpenApiDocument({
        one: defineEndpoint({
          ...base,
          path: '/v1/a',
          response: { status: 200, description: 'd', schema: a },
        }),
        two: defineEndpoint({
          ...base,
          path: '/v1/b',
          response: { status: 200, description: 'd', schema: b },
        }),
      }),
    ).toThrow(/Clash/);
  });

  it('rejects duplicate routes', () => {
    const base = {
      method: 'GET',
      path: '/v1/a',
      summary: 's',
      tags: ['clubs'],
      auth: 'public',
      errors: [],
      response: { status: 200, description: 'd', schema: z.object({}) },
    } as const;
    expect(() =>
      buildOpenApiDocument({ one: defineEndpoint(base), two: defineEndpoint(base) }),
    ).toThrow(/Duplicate route/);
  });

  it('refuses schemas that JSON Schema cannot represent', () => {
    const endpoint = defineEndpoint({
      method: 'GET',
      path: '/v1/a',
      summary: 's',
      tags: ['clubs'],
      auth: 'public',
      errors: [],
      response: { status: 200, description: 'd', schema: z.object({ at: z.date() }) },
    });
    expect(() => buildOpenApiDocument({ endpoint })).toThrow();
  });
});
