import {
  toValidationIssues,
  type EndpointDefinition,
  type ValidationIssue,
} from '@sport-performance/contracts';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { tenantContextOf, type AuthContext, type Membership } from '../auth/context.js';
import { tenantDatabase, type TenantDatabase, type TransactionClient } from '../db/database.js';
import type { TenantContext, TransactionSettings } from '../db/tenant-context.js';
import { endpointRouteClass, type RouteClass } from '../security/rate-limit.js';
import { HttpError } from './errors.js';
import { requestPermissions, type RequestPermissions, type RequestScope } from './permissions.js';

/**
 * Body limit of a route class, below the global `BODY_LIMIT_BYTES`: the
 * public endpoints that change state take an email, a code or a token.
 */
export const ROUTE_CLASS_BODY_LIMIT_BYTES: Partial<Record<RouteClass, number>> = {
  auth: 16 * 1024,
};

type Parsed<Schema> = Schema extends z.ZodType ? z.output<Schema> : undefined;

/** Validated input of a handler: the `z.output` of each declared part. */
export interface EndpointRequest<E extends EndpointDefinition> {
  params: Parsed<E['params']>;
  query: Parsed<E['query']>;
  body: Parsed<E['body']>;
}

/** What a handler returns: anything the response schema accepts (it is parsed before sending). */
export type EndpointResult<E extends EndpointDefinition> = E['response']['schema'] extends z.ZodType
  ? z.input<E['response']['schema']>
  : undefined;

/** A caller acting in a club: what `club` endpoints get. */
export type ClubAuthContext = AuthContext & { readonly membership: Membership };

/**
 * `session` endpoints only run with a caller and `club` endpoints with a
 * selected membership, so their handlers get the narrowed `auth`.
 */
export type EndpointAuthContext<E extends EndpointDefinition> = E['auth'] extends 'club'
  ? ClubAuthContext
  : E['auth'] extends 'session'
    ? AuthContext
    : AuthContext | null;

export interface HandlerContext<E extends EndpointDefinition> {
  auth: EndpointAuthContext<E>;
  request: FastifyRequest;
  reply: FastifyReply;
  log: FastifyBaseLogger;
}

export interface TransactionalHandlerContext<
  E extends EndpointDefinition,
> extends HandlerContext<E> {
  /** Connection of the request transaction, with the tenant context already set. */
  tx: TransactionClient;
  /**
   * Typed Drizzle client (`@sport-performance/db`) over `tx`: same
   * transaction, same tenant context, so RLS applies to every query. Its
   * `transaction()` is a savepoint of the request transaction.
   */
  db: TenantDatabase;
  /**
   * The permission matrix for this caller (ADR 0025, ADR 0032): every
   * handler calls `authorize` (one resource) or `listScope` (a list) before
   * touching data. A denial is answered `403`.
   */
  permissions: RequestPermissions;
  /**
   * Set when the offline sync runs the handler (ADR 0050): when the mutation
   * was recorded on the device (its clock, never ahead of the server's).
   * Time windows are checked at this instant, not at the sync's.
   */
  recordedAt?: Date;
}

/** Limits of one route; the defaults come from the endpoint (ADR 0031). */
export interface EndpointRouteLimits {
  /** Class of the general rate limits; default from the endpoint's auth and method. */
  rateLimit?: RouteClass;
  /** Largest body; default the class's, never above the global `BODY_LIMIT_BYTES`. */
  bodyLimitBytes?: number;
}

/**
 * How an endpoint of the catalog is served. `transaction: true` runs the
 * handler (and the response check) inside one transaction with the caller's
 * tenant context (ADR 0006, 0009): the handler gets `tx`, a response outside
 * the contract rolls it back. Endpoints that do not touch the database say
 * `transaction: false`.
 */
export type EndpointRoute<E extends EndpointDefinition> = EndpointRouteLimits &
  (
    | {
        transaction: true;
        /**
         * `registry`: a superadmin on the registry of clubs (no club in the
         * context, role `superadmin`, support access without club, ADR 0029).
         * Only for `session` endpoints; anyone else gets `403`.
         */
        scope?: 'registry';
        /**
         * The reason of a correction (`changeReason` of the body, ADR 0030),
         * set as `app.change_reason` for the whole transaction.
         */
        changeReason?: (input: EndpointRequest<E>) => string | null | undefined;
        handler: (
          input: EndpointRequest<E>,
          ctx: TransactionalHandlerContext<E>,
        ) => Promise<EndpointResult<E>>;
      }
    | {
        transaction: false;
        handler: (input: EndpointRequest<E>, ctx: HandlerContext<E>) => Promise<EndpointResult<E>>;
      }
  );

/** `/v1/clubs/{clubSlug}/theme` → `/v1/clubs/:clubSlug/theme`. */
export function fastifyPath(path: string): string {
  return path.replace(/\{([^{}]+)\}/g, ':$1');
}

function parsePart(
  schema: z.ZodType | undefined,
  value: unknown,
  location: 'params' | 'query' | 'body',
  issues: ValidationIssue[],
): unknown {
  if (schema === undefined) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  issues.push(...toValidationIssues(result.error.issues, [location]));
  return undefined;
}

/** Thrown when a handler's result does not match the response schema. Never shown to clients. */
export class ResponseContractError extends Error {
  override readonly name = 'ResponseContractError';
  /** Paths and codes only: the values may be personal data. */
  readonly issues: { path: string; code: string }[];

  constructor(endpoint: EndpointDefinition, error: z.ZodError) {
    super(`Response of ${endpoint.method} ${endpoint.path} does not match its contract`);
    this.issues = error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
    }));
  }
}

function requestScope(
  endpoint: EndpointDefinition,
  routeScope: 'registry' | undefined,
): RequestScope {
  if (routeScope === 'registry') {
    if (endpoint.auth !== 'session') {
      throw new Error(
        `${endpoint.method} ${endpoint.path}: the registry scope is for session endpoints`,
      );
    }
    return 'registry';
  }
  return endpoint.auth === 'club' ? 'club' : 'none';
}

/**
 * Tenant context and settings of the request transaction (ADR 0032): the
 * caller's club and role, the request id, the change reason and, for a
 * superadmin, the support reason that `app.begin_support_access` records.
 * A superadmin without a support reason does not act (`403`). `auth` is
 * `null` for a public endpoint, whoever calls: it runs anonymous.
 */
function transactionOf(
  request: FastifyRequest,
  auth: AuthContext | null,
  scope: RequestScope,
  changeReason: string | null | undefined,
): { context: TenantContext; settings: TransactionSettings } {
  const settings: TransactionSettings = {
    requestId: request.id,
    changeReason: changeReason ?? null,
  };
  if (scope === 'registry') {
    if (!auth?.isSuperadmin) {
      throw new HttpError('forbidden', 'Only a superadmin manages the registry of clubs');
    }
    return {
      context: { clubId: null, userId: auth.userId, role: 'superadmin' },
      settings: { ...settings, supportReason: requireSupportReason(auth.supportReason) },
    };
  }
  const context = tenantContextOf(auth);
  if (context.role === 'superadmin') {
    return {
      context,
      settings: { ...settings, supportReason: requireSupportReason(auth?.supportReason ?? null) },
    };
  }
  return { context, settings };
}

function requireSupportReason(reason: string | null): string {
  if (reason === null) {
    throw new HttpError(
      'forbidden',
      'A superadmin acts only with X-Support-Reason (UTF-8, percent-encoded, 1 to 500 characters)',
    );
  }
  return reason;
}

/**
 * Validates the parts of a request with the contract schemas (`z.output`
 * of each), or throws `400 validation_failed` with every issue, located by
 * part (`params`, `query`, `body`) under `prefix`.
 */
export function parseEndpointInput<E extends EndpointDefinition>(
  endpoint: E,
  raw: { params?: unknown; query?: unknown; body?: unknown },
  prefix: readonly (string | number)[] = [],
): EndpointRequest<E> {
  const issues: ValidationIssue[] = [];
  const input = {
    params: parsePart(endpoint.params, raw.params, 'params', issues),
    query: parsePart(endpoint.query, raw.query, 'query', issues),
    body: parsePart(endpoint.body, raw.body, 'body', issues),
  } as EndpointRequest<E>;
  if (issues.length > 0) {
    throw new HttpError('validation_failed', 'The request does not match the contract', {
      details: issues.map((issue) => ({ ...issue, path: [...prefix, ...issue.path] })),
    });
  }
  return input;
}

/** A handler's result checked (and stripped) by the response schema of its endpoint. */
export function checkResponse<E extends EndpointDefinition>(
  endpoint: E,
  result: EndpointResult<E>,
): unknown {
  const schema = endpoint.response.schema;
  if (schema === undefined) return undefined;
  const parsed = schema.safeParse(result);
  if (!parsed.success) throw new ResponseContractError(endpoint, parsed.error);
  return parsed.data;
}

/** Routes registered on each app, by endpoint: the offline sync runs their handlers. */
const ROUTES = new WeakMap<
  FastifyInstance,
  Map<EndpointDefinition, EndpointRoute<EndpointDefinition>>
>();

/** A transactional route as registered, to run its handler inside another transaction. */
export interface TransactionalRoute<E extends EndpointDefinition> {
  changeReason?: (input: EndpointRequest<E>) => string | null | undefined;
  handler: (
    input: EndpointRequest<E>,
    ctx: TransactionalHandlerContext<E>,
  ) => Promise<EndpointResult<E>>;
}

/**
 * The registered transactional route of `endpoint` (the offline sync, ADR
 * 0050, runs a mutation through the same handler as the online request).
 * Throws when the endpoint is not registered on `app` or does not run in
 * a club transaction.
 */
export function transactionalRouteOf<E extends EndpointDefinition>(
  app: FastifyInstance,
  endpoint: E,
): TransactionalRoute<E> {
  const route = ROUTES.get(app)?.get(endpoint) as EndpointRoute<E> | undefined;
  if (route === undefined) {
    throw new Error(`${endpoint.method} ${endpoint.path} is not registered`);
  }
  if (!route.transaction || route.scope !== undefined || endpoint.auth !== 'club') {
    throw new Error(`${endpoint.method} ${endpoint.path} is not a club transactional route`);
  }
  return route;
}

/**
 * Registers an endpoint of the contract catalog: Fastify route, auth guard,
 * input validation with the contract schemas, handler and response check.
 */
export function registerEndpoint<E extends EndpointDefinition>(
  app: FastifyInstance,
  endpoint: E,
  route: EndpointRoute<E>,
): void {
  let routes = ROUTES.get(app);
  if (routes === undefined) {
    routes = new Map();
    ROUTES.set(app, routes);
  }
  if (routes.has(endpoint)) {
    throw new Error(`${endpoint.method} ${endpoint.path} is already registered`);
  }
  routes.set(endpoint, route as unknown as EndpointRoute<EndpointDefinition>);
  const routeClass = route.rateLimit ?? endpointRouteClass(endpoint);
  const bodyLimit = Math.min(
    app.initialConfig.bodyLimit ?? Number.POSITIVE_INFINITY,
    route.bodyLimitBytes ?? ROUTE_CLASS_BODY_LIMIT_BYTES[routeClass] ?? Number.POSITIVE_INFINITY,
  );
  app.route({
    method: endpoint.method,
    url: fastifyPath(endpoint.path),
    config: {
      rateLimit: routeClass,
      ...(endpoint.skipAppVersionCheck === true && { appVersionCheck: 'skip' as const }),
    },
    ...(Number.isFinite(bodyLimit) && { bodyLimit }),
    handler: async (request, reply) => {
      if (endpoint.auth !== 'public' && request.auth === null) {
        throw new HttpError('unauthenticated', 'This endpoint needs a session');
      }
      if (endpoint.auth === 'club' && request.auth?.membership === null) {
        throw new HttpError(
          'forbidden',
          request.auth.membershipRejected
            ? 'X-Membership-Id is not an active membership of this user, or X-Support-Club-Id is not allowed'
            : 'Select a club: send X-Membership-Id (GET /v1/me/memberships)',
        );
      }

      const input = parseEndpointInput(endpoint, request);

      const base: HandlerContext<E> = {
        auth: request.auth as EndpointAuthContext<E>,
        request,
        reply,
        log: request.log,
      };
      const respond = (result: EndpointResult<E>): unknown => checkResponse(endpoint, result);

      let body: unknown;
      if (route.transaction) {
        const scope = requestScope(endpoint, route.scope);
        // A public endpoint answers the same with or without a session: it runs anonymous
        // (no club, user or role in the context, so no support access for a superadmin).
        const caller = endpoint.auth === 'public' ? null : request.auth;
        const { context, settings } = transactionOf(
          request,
          caller,
          scope,
          route.changeReason?.(input),
        );
        // The response is built inside the transaction (a result outside the contract rolls
        // it back) but only sent after the commit: a transaction that did not commit never
        // reaches the client (ADR 0029: medical reads are logged in that same transaction).
        body = await app.db.transaction(
          context,
          async (tx) => {
            const db = tenantDatabase(tx);
            const permissions = requestPermissions(db, caller, scope);
            return respond(await route.handler(input, { ...base, tx, db, permissions }));
          },
          settings,
        );
      } else {
        body = respond(await route.handler(input, base));
      }

      void reply.code(endpoint.response.status);
      return endpoint.response.status === 204 ? reply.send() : body;
    },
  });
}
