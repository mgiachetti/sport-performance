import type { EndpointDefinition } from '@sport-performance/contracts';
import type { FastifyRequest } from 'fastify';
import {
  rateLimitError,
  type RateLimitCheck,
  type RateLimiter,
  type RateLimitRule,
} from '../auth/rate-limit.js';

/**
 * Class of a route for the general limits (ADR 0031). Each class has its own
 * counters, so a burst of reads does not eat the budget of writes.
 *
 * - `public`: no session needed and no state changed (`/openapi.json`, `/v1/health`, 404s).
 * - `auth`: public and changes state (sign-in codes, invitations by token):
 *   tighter per IP; the specific limits of ADR 0028 still apply on top.
 * - `read` / `write`: endpoints with a session, by method.
 * - `upload`: endpoints that hand out upload URLs (B-325): the tightest.
 * - `exempt`: platform probes (`/health/live`, `/health/ready`) and CORS preflights.
 */
export const ROUTE_CLASSES = ['public', 'auth', 'read', 'write', 'upload', 'exempt'] as const;
export type RouteClass = (typeof ROUTE_CLASSES)[number];

/** Per-IP counter of a class, and per-user when the caller has a session. */
export interface RouteClassLimits {
  readonly perIp?: RateLimitRule;
  readonly perUser?: RateLimitRule;
}

const MINUTE_S = 60;

/**
 * Default limits per minute. Per user they bound one account (a stolen token,
 * a client stuck in a loop); per IP they bound one address, sized for a whole
 * team on the club's wifi behind one NAT (40 people syncing at once).
 */
export const DEFAULT_ROUTE_CLASS_LIMITS = {
  public: { perIp: { name: 'api_public_ip', max: 300, windowS: MINUTE_S } },
  auth: { perIp: { name: 'api_auth_ip', max: 60, windowS: MINUTE_S } },
  read: {
    perIp: { name: 'api_read_ip', max: 1200, windowS: MINUTE_S },
    perUser: { name: 'api_read_user', max: 600, windowS: MINUTE_S },
  },
  write: {
    perIp: { name: 'api_write_ip', max: 600, windowS: MINUTE_S },
    perUser: { name: 'api_write_user', max: 120, windowS: MINUTE_S },
  },
  upload: {
    perIp: { name: 'api_upload_ip', max: 120, windowS: MINUTE_S },
    perUser: { name: 'api_upload_user', max: 30, windowS: MINUTE_S },
  },
  exempt: {},
} as const satisfies Record<RouteClass, RouteClassLimits>;

export type RouteClassLimitTable = Readonly<Record<RouteClass, RouteClassLimits>>;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Class of the route for the general rate limits; derived when unset. */
    rateLimit?: RouteClass;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Default class of a contract endpoint: by its auth level and method. */
export function endpointRouteClass(endpoint: Pick<EndpointDefinition, 'auth' | 'method'>) {
  const safe = SAFE_METHODS.has(endpoint.method);
  if (endpoint.auth === 'public') return safe ? 'public' : 'auth';
  return safe ? 'read' : 'write';
}

/** Class of a request: the route's, or derived from the method and the session. */
export function requestRouteClass(request: FastifyRequest): RouteClass {
  if (request.method === 'OPTIONS') return 'exempt';
  const declared = request.routeOptions.config.rateLimit;
  if (declared !== undefined) return declared;
  if (request.auth === null) return 'public';
  return SAFE_METHODS.has(request.method) ? 'read' : 'write';
}

export interface GeneralRateLimitOptions {
  store: RateLimiter;
  limits?: Partial<RouteClassLimitTable>;
  /**
   * Past this the store is considered down and the request goes through
   * (fail open): the general limits protect capacity, they must not turn a
   * slow database into an outage. The limits of the sign-in (ADR 0028) fail
   * closed instead.
   */
  timeoutMs: number;
}

class StoreTimeoutError extends Error {
  override readonly name = 'StoreTimeoutError';
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new StoreTimeoutError(`rate limit store did not answer in ${String(timeoutMs)} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The general rate limits of every request (ADR 0031): per IP always, per
 * user with a session, one store round trip per request. Throws `429
 * rate_limited` with `Retry-After` when a counter is over its limit.
 */
export function createGeneralRateLimit(options: GeneralRateLimitOptions) {
  const limits: RouteClassLimitTable = { ...DEFAULT_ROUTE_CLASS_LIMITS, ...options.limits };
  return async function enforceGeneralRateLimit(request: FastifyRequest): Promise<void> {
    const { perIp, perUser } = limits[requestRouteClass(request)];
    const checks: RateLimitCheck[] = [];
    if (perIp !== undefined) checks.push([perIp, request.ip]);
    if (perUser !== undefined && request.auth !== null) checks.push([perUser, request.auth.userId]);
    if (checks.length === 0) return;
    let results;
    try {
      results = await withTimeout(options.store.hit(checks), options.timeoutMs);
    } catch (error) {
      request.log.warn({ err: error }, 'rate limit store unavailable: request allowed');
      return;
    }
    const refused = rateLimitError(results);
    if (refused !== undefined) throw refused;
  };
}
