import { z } from 'zod';
import {
  API_TAGS,
  endpointErrorCodes,
  type EndpointCatalog,
  type EndpointDefinition,
  type HttpMethod,
} from '../endpoint.js';
import { apiEndpoints } from '../endpoints/index.js';
import { ERROR_STATUS, errorEnvelopeSchema, type ErrorCode } from '../primitives/errors.js';

export type JsonSchema = Record<string, unknown>;

type Io = 'input' | 'output';

/** Semver of the contract; bump minor on additive changes, major together with the `/vN` prefix. */
export const CONTRACT_VERSION = '0.1.0';

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  description?: string;
  schema: JsonSchema;
}

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  deprecated?: boolean;
  security: Record<string, string[]>[];
  parameters?: OpenApiParameter[];
  requestBody?: { required: true; content: { 'application/json': { schema: JsonSchema } } };
  responses: Record<
    string,
    { description: string; content?: Record<string, { schema: JsonSchema }> }
  >;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string };
  tags: { name: string; description: string }[];
  paths: Record<string, Partial<Record<Lowercase<HttpMethod>, OpenApiOperation>>>;
  components: {
    schemas: Record<string, JsonSchema>;
    securitySchemes: Record<string, JsonSchema>;
  };
}

export interface BuildOpenApiOptions {
  title?: string;
  version?: string;
  description?: string;
}

/** Converted schemas are plain JSON with deterministic key order. */
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const COMPONENT_PREFIX = '#/components/schemas/';
const LOCAL_DEF_PREFIX = '#/$defs/';
const METHOD_ORDER: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Response objects are open for extension: adding a field is not a breaking
 * change and clients ignore unknown fields. zod marks non-strict objects as
 * `additionalProperties: false` in output mode; drop that so the document
 * says what the API promises.
 */
function keepObjectsOpen(ctx: {
  zodSchema: z.core.$ZodTypes;
  jsonSchema: z.core.JSONSchema.BaseSchema;
}) {
  const def = ctx.zodSchema._zod.def;
  if (
    def.type === 'object' &&
    def.catchall === undefined &&
    ctx.jsonSchema.additionalProperties === false
  ) {
    delete ctx.jsonSchema.additionalProperties;
  }
}

/** A converted schema whose `#/$defs/<id>` refs are resolved once every schema is known. */
interface Pending {
  io: Io;
  json: JsonSchema;
}

/**
 * Collects JSON Schemas of every request and response part. Schemas with a
 * zod `id` (`.meta({ id })`) become shared components. A schema used for both
 * requests and responses whose input and output forms differ (e.g. a field
 * with a default) gets a separate `<Id>Input` component.
 */
class SchemaCollector {
  readonly #defs: Record<Io, Map<string, JsonSchema>> = { input: new Map(), output: new Map() };

  convert(schema: z.ZodType, io: Io): Pending {
    const converted = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io,
      unrepresentable: 'throw',
      cycles: 'ref',
      reused: 'inline',
      override: keepObjectsOpen,
    }) as JsonSchema;
    const { $defs, ...root } = converted;
    delete root.$schema;
    for (const [id, def] of Object.entries(($defs ?? {}) as Record<string, JsonSchema>)) {
      const known = this.#defs[io].get(id);
      if (known !== undefined && !jsonEqual(known, def)) {
        throw new Error(`Two different schemas share the id "${id}"`);
      }
      this.#defs[io].set(id, def);
    }
    return { io, json: root };
  }

  /** Resolves component names and returns the finished `components.schemas`. */
  finish(): { schemas: Record<string, JsonSchema>; resolve: (pending: Pending) => JsonSchema } {
    const names: Record<Io, Map<string, string>> = { input: new Map(), output: new Map() };
    for (const id of this.#defs.output.keys()) names.output.set(id, id);
    for (const id of this.#defs.input.keys()) names.input.set(id, id);

    const resolved = (io: Io, id: string): JsonSchema =>
      rewriteRefs(this.#defs[io].get(id) ?? {}, names[io]);

    // An input def shares the output component only when both resolve to the
    // same JSON. Renaming one can make its parents differ, so iterate to a fixpoint.
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of this.#defs.input.keys()) {
        if (names.input.get(id) !== id || !this.#defs.output.has(id)) continue;
        if (!jsonEqual(resolved('input', id), resolved('output', id))) {
          const renamed = `${id}Input`;
          if (this.#defs.output.has(renamed)) throw new Error(`Component name clash: ${renamed}`);
          names.input.set(id, renamed);
          changed = true;
        }
      }
    }

    const schemas: Record<string, JsonSchema> = {};
    for (const io of ['output', 'input'] as const) {
      for (const [id, name] of names[io]) schemas[name] = resolved(io, id);
    }
    return {
      schemas: sortKeys(schemas),
      resolve: (pending) => rewriteRefs(pending.json, names[pending.io]),
    };
  }
}

function rewriteRefs(value: JsonSchema, names: ReadonlyMap<string, string>): JsonSchema {
  return rewrite(value, names) as JsonSchema;
}

function rewrite(value: unknown, names: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => rewrite(item, names));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && typeof child === 'string' && child.startsWith(LOCAL_DEF_PREFIX)) {
      const id = child.slice(LOCAL_DEF_PREFIX.length);
      out[key] = COMPONENT_PREFIX + (names.get(id) ?? id);
    } else {
      out[key] = rewrite(child, names);
    }
  }
  return out;
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

interface PendingParameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  description?: string;
  schema: Pending;
}

function collectParameters(
  collector: SchemaCollector,
  schema: z.ZodObject,
  location: 'path' | 'query',
): PendingParameter[] {
  const required = new Set(
    (collector.convert(schema, 'input').json.required as string[] | undefined) ?? [],
  );
  return Object.entries(schema.shape as Record<string, z.ZodType>).map(([name, field]) => {
    const pending = collector.convert(field, 'input');
    const { description, ...rest } = pending.json;
    const parameter: PendingParameter = {
      name,
      in: location,
      required: location === 'path' || required.has(name),
      schema: { io: 'input', json: rest },
    };
    if (typeof description === 'string') parameter.description = description;
    return parameter;
  });
}

function errorDescription(codes: readonly ErrorCode[]): string {
  return codes.map((code) => `\`${code}\``).join(', ');
}

/**
 * Builds the OpenAPI 3.1 document of the API from the endpoint catalog.
 * Deterministic: the same catalog always yields the same document.
 */
export function buildOpenApiDocument(
  endpoints: EndpointCatalog = apiEndpoints,
  options: BuildOpenApiOptions = {},
): OpenApiDocument {
  const collector = new SchemaCollector();
  const envelope = collector.convert(errorEnvelopeSchema, 'output');

  const operations = Object.entries(endpoints).map(([operationId, endpoint]) => ({
    operationId,
    endpoint,
    parameters: [
      ...(endpoint.params ? collectParameters(collector, endpoint.params, 'path') : []),
      ...(endpoint.query ? collectParameters(collector, endpoint.query, 'query') : []),
    ],
    body: endpoint.body ? collector.convert(endpoint.body, 'input') : undefined,
    response: endpoint.response.schema
      ? collector.convert(endpoint.response.schema, 'output')
      : undefined,
  }));

  const { schemas, resolve } = collector.finish();
  const envelopeRef = resolve(envelope);

  const seen = new Set<string>();
  const paths: OpenApiDocument['paths'] = {};
  const sorted = [...operations].sort(
    (a, b) =>
      a.endpoint.path.localeCompare(b.endpoint.path, 'en') ||
      METHOD_ORDER.indexOf(a.endpoint.method) - METHOD_ORDER.indexOf(b.endpoint.method),
  );
  for (const { operationId, endpoint, parameters, body, response } of sorted) {
    const route = `${endpoint.method} ${endpoint.path}`;
    if (seen.has(route)) throw new Error(`Duplicate route ${route}`);
    seen.add(route);

    const operation: OpenApiOperation = {
      operationId,
      summary: endpoint.summary,
      ...(endpoint.description !== undefined && { description: endpoint.description }),
      tags: [...endpoint.tags],
      ...(endpoint.deprecated === true && { deprecated: true }),
      security: endpoint.auth === 'public' ? [] : [{ session: [] }],
      ...(parameters.length > 0 && {
        parameters: parameters.map(({ schema, ...parameter }) => ({
          ...parameter,
          schema: resolve(schema),
        })),
      }),
      ...(body && {
        requestBody: {
          required: true,
          content: { 'application/json': { schema: resolve(body) } },
        },
      }),
      responses: {
        [String(endpoint.response.status)]: {
          description: endpoint.response.description,
          ...(response && { content: { 'application/json': { schema: resolve(response) } } }),
        },
        ...errorResponses(endpoint, envelopeRef),
      },
    };
    const method = endpoint.method.toLowerCase() as Lowercase<HttpMethod>;
    paths[endpoint.path] = { ...paths[endpoint.path], [method]: operation };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'Sport Performance API',
      version: options.version ?? CONTRACT_VERSION,
      description:
        options.description ??
        'API de Sport Performance. Generado desde `@sport-performance/contracts`; no editar a mano.',
    },
    tags: Object.entries(API_TAGS).map(([name, description]) => ({ name, description })),
    paths,
    components: {
      schemas,
      securitySchemes: {
        session: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Sesión de Better Auth: cookie en la web, token bearer en mobile. Se detalla con la autenticación.',
        },
      },
    },
  };
}

function errorResponses(
  endpoint: EndpointDefinition,
  envelopeRef: JsonSchema,
): OpenApiOperation['responses'] {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of endpointErrorCodes(endpoint)) {
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return Object.fromEntries(
    [...byStatus.entries()]
      .sort(([a], [b]) => a - b)
      .map(([status, codes]) => [
        String(status),
        {
          description: `Error: ${errorDescription(codes)}.`,
          content: { 'application/json': { schema: envelopeRef } },
        },
      ]),
  );
}

/** Stable serialization used for the committed `openapi.json`. */
export function serializeOpenApiDocument(document: OpenApiDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
