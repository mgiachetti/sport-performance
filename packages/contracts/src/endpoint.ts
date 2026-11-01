import type { z } from 'zod';
import type { ErrorCode } from './primitives/errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** `public`: no session needed. `session`: an authenticated user with a membership in the club. */
export type EndpointAuth = 'public' | 'session';

export type SuccessStatus = 200 | 201 | 202 | 204;

/** OpenAPI tags. Every endpoint belongs to at least one. */
export const API_TAGS = {
  system: 'Estado del servicio.',
  clubs: 'Clubes y su marca (white-label).',
} as const satisfies Record<string, string>;

export type ApiTag = keyof typeof API_TAGS;

/** Schema for path params or query: a flat object whose values are scalars. */
export type ObjectSchema = z.ZodObject;

export interface EndpointResponse<Schema extends z.ZodType | undefined = z.ZodType | undefined> {
  status: SuccessStatus;
  description: string;
  /** `undefined` only for `204 No Content`. */
  schema: Schema;
}

/**
 * Declarative description of one HTTP endpoint. It is the single source for
 * the API route (validation), the OpenAPI document and the typed client.
 *
 * Paths start with the API version (`/v1/...`) and name params in braces
 * (`/v1/clubs/{clubSlug}/theme`). Schemas must not use transforms: what
 * travels on the wire is what the schema describes.
 */
export interface EndpointDefinition {
  method: HttpMethod;
  path: `/v${number}/${string}`;
  summary: string;
  description?: string;
  tags: readonly [ApiTag, ...ApiTag[]];
  auth: EndpointAuth;
  params?: ObjectSchema;
  query?: ObjectSchema;
  body?: z.ZodType;
  response: EndpointResponse;
  /**
   * Error codes this endpoint can answer besides the implicit ones
   * (`internal_error` always, `validation_failed` when it takes input,
   * `unauthenticated` when it needs a session).
   */
  errors: readonly ErrorCode[];
  deprecated?: boolean;
}

/** Names of the `{param}` placeholders of a path, as a union. */
export type PathParamNames<Path extends string> =
  Path extends `${string}{${infer Name}}${infer Rest}` ? Name | PathParamNames<Rest> : never;

type SchemaKeys<Schema> = Schema extends z.ZodObject<infer Shape> ? keyof Shape & string : never;

type SameKeys<A, B> = [Exclude<A, B> | Exclude<B, A>] extends [never] ? true : false;

/** Compile-time check that `params` declares exactly the placeholders of `path`. */
export type ValidatePathParams<E extends EndpointDefinition> =
  SameKeys<PathParamNames<E['path']>, SchemaKeys<E['params']>> extends true
    ? unknown
    : {
        params: `path params must match the placeholders of ${E['path']}`;
      };

const PLACEHOLDER = /\{([^{}]+)\}/g;

/** Runtime list of `{param}` names in a path, in order. */
export function pathParamNames(path: string): string[] {
  return Array.from(path.matchAll(PLACEHOLDER), (match) => match[1] ?? '');
}

/**
 * Declares an endpoint. Checks (at compile time and at load time) that the
 * path placeholders and the params schema agree.
 */
export function defineEndpoint<const E extends EndpointDefinition>(
  endpoint: E & ValidatePathParams<E>,
): E {
  const declared = Object.keys(endpoint.params?.shape ?? {}).sort();
  const inPath = pathParamNames(endpoint.path).sort();
  if (declared.join(',') !== inPath.join(',')) {
    throw new Error(
      `Endpoint ${endpoint.method} ${endpoint.path}: params [${declared.join(', ')}] do not match path placeholders [${inPath.join(', ')}]`,
    );
  }
  if (endpoint.response.status === 204 && endpoint.response.schema !== undefined) {
    throw new Error(`Endpoint ${endpoint.method} ${endpoint.path}: 204 responses carry no schema`);
  }
  if (endpoint.response.status !== 204 && endpoint.response.schema === undefined) {
    throw new Error(`Endpoint ${endpoint.method} ${endpoint.path}: response schema is required`);
  }
  return endpoint;
}

/** Implicit error codes of an endpoint plus the declared ones, deduplicated and sorted by status. */
export function endpointErrorCodes(endpoint: EndpointDefinition): ErrorCode[] {
  const codes = new Set<ErrorCode>(endpoint.errors);
  if (endpoint.params ?? endpoint.query ?? endpoint.body) codes.add('validation_failed');
  if (endpoint.auth === 'session') codes.add('unauthenticated');
  codes.add('internal_error');
  return [...codes];
}

type InputOf<Schema> = Schema extends z.ZodType ? z.input<Schema> : never;

type OptionalWhenEmpty<Key extends string, Value> = [Value] extends [never]
  ? unknown
  : object extends Value
    ? Partial<Record<Key, Value>>
    : Record<Key, Value>;

/** What a caller passes to call an endpoint: `{ params?, query?, body? }`, each only if declared. */
export type EndpointInput<E extends EndpointDefinition> = OptionalWhenEmpty<
  'params',
  InputOf<E['params']>
> &
  OptionalWhenEmpty<'query', InputOf<E['query']>> &
  OptionalWhenEmpty<'body', InputOf<E['body']>>;

/** What a successful call resolves to. */
export type EndpointOutput<E extends EndpointDefinition> = E['response']['schema'] extends z.ZodType
  ? z.output<E['response']['schema']>
  : undefined;

/** A catalog of endpoints keyed by operationId (camelCase). */
export type EndpointCatalog = Record<string, EndpointDefinition>;
