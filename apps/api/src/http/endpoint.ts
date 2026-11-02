import {
  toValidationIssues,
  type EndpointDefinition,
  type ValidationIssue,
} from '@sport-performance/contracts';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { tenantContextOf, type AuthContext, type Membership } from '../auth/context.js';
import { tenantDatabase, type TenantDatabase, type TransactionClient } from '../db/database.js';
import { endpointRouteClass, type RouteClass } from '../security/rate-limit.js';
import { HttpError } from './errors.js';

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
   * transaction, same tenant context, so RLS applies to every query.
   */
  db: TenantDatabase;
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

/**
 * Registers an endpoint of the contract catalog: Fastify route, auth guard,
 * input validation with the contract schemas, handler and response check.
 */
export function registerEndpoint<E extends EndpointDefinition>(
  app: FastifyInstance,
  endpoint: E,
  route: EndpointRoute<E>,
): void {
  const routeClass = route.rateLimit ?? endpointRouteClass(endpoint);
  const bodyLimit = Math.min(
    app.initialConfig.bodyLimit ?? Number.POSITIVE_INFINITY,
    route.bodyLimitBytes ?? ROUTE_CLASS_BODY_LIMIT_BYTES[routeClass] ?? Number.POSITIVE_INFINITY,
  );
  app.route({
    method: endpoint.method,
    url: fastifyPath(endpoint.path),
    config: { rateLimit: routeClass },
    ...(Number.isFinite(bodyLimit) && { bodyLimit }),
    handler: async (request, reply) => {
      if (endpoint.auth !== 'public' && request.auth === null) {
        throw new HttpError('unauthenticated', 'This endpoint needs a session');
      }
      if (endpoint.auth === 'club' && request.auth?.membership === null) {
        throw new HttpError(
          'forbidden',
          request.auth.membershipRejected
            ? 'X-Membership-Id is not an active membership of this user'
            : 'Select a club: send X-Membership-Id (GET /v1/me/memberships)',
        );
      }

      const issues: ValidationIssue[] = [];
      const input = {
        params: parsePart(endpoint.params, request.params, 'params', issues),
        query: parsePart(endpoint.query, request.query, 'query', issues),
        body: parsePart(endpoint.body, request.body, 'body', issues),
      } as EndpointRequest<E>;
      if (issues.length > 0) {
        throw new HttpError('validation_failed', 'The request does not match the contract', {
          details: issues,
        });
      }

      const base: HandlerContext<E> = {
        auth: request.auth as EndpointAuthContext<E>,
        request,
        reply,
        log: request.log,
      };
      const respond = (result: EndpointResult<E>): unknown => {
        const schema = endpoint.response.schema;
        if (schema === undefined) return undefined;
        const parsed = schema.safeParse(result);
        if (!parsed.success) throw new ResponseContractError(endpoint, parsed.error);
        return parsed.data;
      };

      const body = route.transaction
        ? await app.db.transaction(tenantContextOf(request.auth), async (tx) =>
            respond(await route.handler(input, { ...base, tx, db: tenantDatabase(tx) })),
          )
        : respond(await route.handler(input, base));

      void reply.code(endpoint.response.status);
      return endpoint.response.status === 204 ? reply.send() : body;
    },
  });
}
