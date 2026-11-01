import { buildOpenApiDocument, type OpenApiDocument } from '@sport-performance/contracts/openapi';
import type { FastifyInstance } from 'fastify';

export const OPENAPI_PATH = '/openapi.json';

/**
 * Serves the OpenAPI document of the contract (ADR 0020). It is built once
 * from the same catalog the routes come from, so it always describes the
 * running API; the committed `openapi.json` of the contracts is identical
 * (a test of the contracts package checks it).
 */
export function registerOpenApiRoute(app: FastifyInstance): OpenApiDocument {
  const document = buildOpenApiDocument();
  const body = JSON.stringify(document);
  app.get(OPENAPI_PATH, (_request, reply) =>
    reply
      .type('application/json; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .send(body),
  );
  return document;
}
