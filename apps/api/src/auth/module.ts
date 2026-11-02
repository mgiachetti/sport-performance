import type { Database as DrizzleDatabase } from '@sport-performance/db';
import type { FastifyBaseLogger } from 'fastify';
import type { AuthConfig } from '../config/env.js';
import type { Database } from '../db/database.js';
import type { Mailer } from '../email/mailer.js';
import type { InvitationLinkOptions } from '../invitations/tokens.js';
import { createSessionAuthenticate } from './authenticate.js';
import { createBetterAuth, type SportAuth } from './better-auth.js';
import type { Authenticate } from './context.js';
import { createIdentityStore, type IdentityStore } from './identity.js';
import { createSessionStore, type SessionStore } from './sessions.js';
import {
  AUTH_RATE_LIMITS,
  createPgRateLimiter,
  type AuthRateLimits,
  type RateLimiter,
} from './rate-limit.js';

/** Everything the identity endpoints and the request hook need (ADR 0028). */
export interface AuthModule {
  readonly betterAuth: SportAuth;
  readonly authenticate: Authenticate;
  readonly identity: IdentityStore;
  /** Sessions and known devices, on Better Auth's connection (ADR 0033). */
  readonly sessions: SessionStore;
  readonly rateLimiter: RateLimiter;
  readonly limits: AuthRateLimits;
  readonly mailer: Mailer;
  readonly links: InvitationLinkOptions;
  /** Web origins allowed to send the session cookie (CORS and the origin guard). */
  readonly webOrigins: readonly string[];
  /** Origin of the API itself, also trusted by the origin guard. */
  readonly apiOrigin: string;
  /** Cookies (session and device id) are `Secure` with the `__Secure-` prefix. */
  readonly secureCookies: boolean;
  /**
   * Clock of the expiry of new invitations and of the invitation states the API
   * reports; tests may pin it. Accepting uses the database's clock.
   */
  readonly now: () => Date;
}

export interface CreateAuthModuleOptions {
  config: AuthConfig;
  /**
   * The API's connection (`sport_performance_app`): memberships across clubs
   * and invitations by token, under RLS (ADR 0026, ADR 0028).
   */
  db: Database;
  /** Better Auth's connection (`sport_performance_auth`): the attempt counters… */
  authDb: Database;
  /** …and the Drizzle client Better Auth uses on the same pool. */
  authDrizzle: DrizzleDatabase;
  mailer: Mailer;
  logger: FastifyBaseLogger;
  /** Override the default limits (tests). */
  limits?: Partial<AuthRateLimits>;
  now?: () => Date;
}

export function createAuthModule(options: CreateAuthModuleOptions): AuthModule {
  const { config } = options;
  const betterAuth = createBetterAuth({
    secret: config.secret,
    baseUrl: config.baseUrl,
    secureCookies: config.secureCookies,
    sessionExpiresInS: config.sessionExpiresInS,
    db: options.authDrizzle,
    logger: options.logger,
  });
  const identity = createIdentityStore(options.db);
  const sessions = createSessionStore(options.authDb);
  return {
    betterAuth,
    authenticate: createSessionAuthenticate(betterAuth, identity, sessions),
    identity,
    sessions,
    rateLimiter: createPgRateLimiter(options.authDb, config.secret),
    limits: { ...AUTH_RATE_LIMITS, ...options.limits },
    mailer: options.mailer,
    links: config.links,
    webOrigins: config.webOrigins,
    apiOrigin: new URL(config.baseUrl).origin,
    secureCookies: config.secureCookies,
    now: options.now ?? (() => new Date()),
  };
}
