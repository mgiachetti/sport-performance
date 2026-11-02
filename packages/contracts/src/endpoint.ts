import type { z } from 'zod';
import type { ErrorCode } from './primitives/errors.js';
import { nonStrictObjectPaths } from './strict-input.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Who may call an endpoint (ADR 0007, ADR 0025):
 * - `public`: anyone, no session needed.
 * - `session`: a signed-in user (cookie on web, bearer token on mobile), with
 *   or without a selected club (profile, club selector, accept invitation).
 * - `club`: a signed-in user acting in a club: a selected membership, sent in
 *   the {@link MEMBERSHIP_HEADER} header (implied when the user has exactly one).
 *   Its club and role are the tenant context of the request (RLS, ADR 0006).
 */
export type EndpointAuth = 'public' | 'session' | 'club';

/**
 * Header with the membership (club + role) the request acts as, as listed by
 * `GET /v1/me/memberships`. Clients store the user's choice and send it on
 * every request; a membership that is not the caller's is `403 forbidden`.
 */
export const MEMBERSHIP_HEADER = 'x-membership-id';

/**
 * Header with the club a superadmin supports (ADR 0029, ADR 0032). A
 * superadmin is not a member: on `club` endpoints they act in this club as
 * `superadmin`, instead of a membership. Sent by anyone else, or together
 * with {@link MEMBERSHIP_HEADER}, it is `403 forbidden`.
 */
export const SUPPORT_CLUB_HEADER = 'x-support-club-id';

/**
 * Why the superadmin acts (ADR 0029): required on every request of a
 * superadmin acting in a club ({@link SUPPORT_CLUB_HEADER}) and on the
 * registry of clubs; recorded in the support access log. UTF-8,
 * percent-encoded (`encodeURIComponent`), 1 to {@link SUPPORT_REASON_MAX_LENGTH}
 * characters once decoded. Missing or invalid: `403 forbidden`.
 */
export const SUPPORT_REASON_HEADER = 'x-support-reason';

/** Longest support reason (the `access_log_reason` check of the database). */
export const SUPPORT_REASON_MAX_LENGTH = 500;

/**
 * Response header of an idempotent create (ADR 0032) answered with the row a
 * previous request with the same `clientUuid` created: `true`.
 */
export const IDEMPOTENT_REPLAY_HEADER = 'x-idempotent-replay';

/**
 * Prefix of the session cookies the API sets for the web (`sp.session_token`,
 * `__Secure-sp.session_token` over HTTPS). Mobile never sees them: it uses the
 * bearer token.
 */
export const SESSION_COOKIE_PREFIX = 'sp';

export type SuccessStatus = 200 | 201 | 202 | 204;

/** OpenAPI tags. Every endpoint belongs to at least one. */
export const API_TAGS = {
  system: 'Estado del servicio.',
  auth: 'Ingreso con código por email (OTP) y sesiones.',
  me: 'El usuario de la sesión: perfil y membresías (selector de club).',
  invitations: 'Invitaciones por link a un club.',
  clubs: 'Clubes, su marca (white-label) y sus ramas (deporte y sexo).',
  categories: 'Categorías por rama y franja de edad, y posiciones por deporte.',
  members: 'Miembros del club, sus roles y las asignaciones del staff (qué ve cada uno).',
  players:
    'Jugadores y plantel: ficha, posiciones, alta y baja, categorías y altura de los padres.',
  calendar: 'Calendario: temporadas, ventanas de tests V1 a V4, días de test y fixture.',
  training: 'Sesiones de entrenamiento y partidos, bloques, participación y RPE del jugador.',
  wellness: 'Bienestar antes de entrenar: una carga por jugador y día del club.',
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
   * (`internal_error` and `rate_limited` always, `validation_failed` when it
   * takes input, `payload_too_large` when it takes a body, `unauthenticated`
   * when it needs a session, `forbidden` when it needs a club).
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
 * path placeholders and the params schema agree, and (at load time) that
 * every input schema rejects unknown keys at every level.
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
  const loose = (['params', 'query', 'body'] as const).flatMap((part) => {
    const schema = endpoint[part];
    return schema === undefined ? [] : nonStrictObjectPaths(schema, part);
  });
  if (loose.length > 0) {
    throw new Error(
      `Endpoint ${endpoint.method} ${endpoint.path}: input objects must be strict (z.strictObject): ${loose.join(', ')}`,
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
  if (endpoint.body) codes.add('payload_too_large');
  if (endpoint.auth !== 'public') codes.add('unauthenticated');
  if (endpoint.auth === 'club') codes.add('forbidden');
  // Every endpoint is under the general per-IP and per-user limits (ADR 0031).
  codes.add('rate_limited');
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
