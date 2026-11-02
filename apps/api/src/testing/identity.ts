/**
 * Harness of the identity integration tests: a throwaway migrated database on
 * the Postgres 16 of `DATABASE_URL`, the app with the real auth module (Better
 * Auth, identity store, rate limiter) and the in-memory email transport. The
 * app connects like production (ADR 0026): the API pool as a fresh login of
 * `sport_performance_app`, Better Auth's as one of `sport_performance_auth`.
 * The owner connection only arranges and inspects rows.
 */
import { assertConnectionRole, createDatabase } from '@sport-performance/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import { parseClubId, parseUserId, type ClubId, type UserId } from '@sport-performance/domain';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { expect } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { createAuthModule, type AuthModule, type CreateAuthModuleOptions } from '../auth/module.js';
import type { AuthConfig } from '../config/env.js';
import { createApiPool, databaseFromPool } from '../db/database.js';
import { createMailer } from '../email/mailer.js';
import { MemoryEmailTransport } from '../email/transport.js';
import { fakeDatabase, memoryLogger, testConfig } from './support.js';

export interface TestDatabase {
  /** Login of `sport_performance_app` (the API's `DATABASE_URL`). */
  appUrl: string;
  /** Login of `sport_performance_auth` (`AUTH_DATABASE_URL`). */
  authUrl: string;
  /** Owner connection for arranging and inspecting rows (bypasses RLS and the API). */
  admin: pg.Pool;
  /** The throwaway database; pools over it are tracked so `drop()` closes them first. */
  temporary: TemporaryDatabase;
  /** Closes every tracked pool (waiting for its sockets), drops the database and the logins. */
  drop: () => Promise<void>;
}

/**
 * A new database with every migration of `packages/db` applied (as the owner
 * of `serverUrl`) and one fresh login per connection role of the API.
 */
export async function createTestDatabase(serverUrl: string): Promise<TestDatabase> {
  const temporary = await createTemporaryDatabase({ serverUrl, prefix: 'sp_api_test' });
  try {
    const app = await temporary.login('app');
    const auth = await temporary.login('auth');
    return {
      appUrl: app.connectionString,
      authUrl: auth.connectionString,
      admin: temporary.pool({ max: 2 }),
      temporary,
      drop: temporary.drop,
    };
  } catch (error) {
    await temporary.drop().catch(() => undefined);
    throw error;
  }
}

export const TEST_WEB_ORIGIN = 'https://web.example.com';

export function testAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    secret: 'test-secret-that-is-long-enough-for-better-auth-0123456789',
    baseUrl: 'http://localhost:3000',
    secureCookies: false,
    sessionExpiresInS: 30 * 24 * 60 * 60,
    webOrigins: [TEST_WEB_ORIGIN],
    links: { webAppUrl: 'https://app.example.com', appScheme: 'sportperformance' },
    database: { url: 'postgres://unused:unused@127.0.0.1:9/unused', poolMax: 4 },
    ...overrides,
  };
}

export interface IdentityTestApp {
  app: FastifyInstance;
  auth: AuthModule;
  emails: MemoryEmailTransport;
  close: () => Promise<void>;
}

export async function startIdentityApp(
  database: TestDatabase,
  options: {
    config?: Partial<AuthConfig>;
    limits?: CreateAuthModuleOptions['limits'];
    now?: () => Date;
    register?: BuildAppOptions['register'];
    routeClassLimits?: BuildAppOptions['routeClassLimits'];
  } = {},
): Promise<IdentityTestApp> {
  const pgOptions = { poolMax: 4, connectTimeoutMs: 5000, statementTimeoutMs: 15_000 };
  // Tracked, so dropping the database waits for their sockets (issue #147).
  const pool = database.temporary.track(
    createApiPool({ ...pgOptions, url: database.appUrl, applicationName: 'api-test' }),
    'api',
  );
  const authPool = database.temporary.track(
    createApiPool({ ...pgOptions, url: database.authUrl, applicationName: 'api-test-auth' }),
    'api-auth',
  );
  // The same startup check as main.ts: the flows below run as the real roles.
  await assertConnectionRole(pool, 'app');
  await assertConnectionRole(authPool, 'auth');
  const db = databaseFromPool(pool);
  const authDb = databaseFromPool(authPool);
  const emails = new MemoryEmailTransport();
  const logs = memoryLogger();
  const auth = createAuthModule({
    config: testAuthConfig(options.config),
    db,
    authDb,
    authDrizzle: createDatabase(authPool),
    mailer: createMailer(emails),
    logger: logs.logger,
    ...(options.limits !== undefined && { limits: options.limits }),
    ...(options.now !== undefined && { now: options.now }),
  });
  const app = await buildApp({
    // These suites assert the counters on the real store: on a loaded runner one
    // round trip can exceed the 500 ms after which the general limits fail open,
    // and a request would go through uncounted (issue #147).
    config: { ...testConfig, rateLimit: { ...testConfig.rateLimit, timeoutMs: 10_000 } },
    db,
    logger: logs.logger,
    auth,
    ...(options.register !== undefined && { register: options.register }),
    ...(options.routeClassLimits !== undefined && { routeClassLimits: options.routeClassLimits }),
  });
  return {
    app,
    auth,
    emails,
    close: async () => {
      await app.close();
      await db.close();
      await authDb.close();
    },
  };
}

/** The 6-digit code of the last sign-in email sent to `email`. */
export function lastCode(emails: MemoryEmailTransport, email: string): string {
  const message = emails.lastTo(email);
  expect(message?.kind).toBe('sign_in_code');
  const code = /\b(\d{6})\b/.exec(message?.subject ?? '')?.[1];
  if (code === undefined) throw new Error(`no sign-in code sent to ${email}`);
  return code;
}

/** `name=value` pairs of the `Set-Cookie` headers, for the next request's `Cookie`. */
export function cookieHeader(response: LightMyRequestResponse): string {
  return response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

export interface SignedIn {
  userId: UserId;
  /** Headers that authenticate the next requests (cookie or bearer). */
  headers: Record<string, string>;
  /** The verify response (cookies, body). */
  response: LightMyRequestResponse;
}

export interface SignInOptions {
  /** `User-Agent` of the verify request. */
  userAgent?: string;
  /** Mobile: the app's device id. */
  deviceId?: string;
  /** Web: `Cookie` of the verify request (the device id cookie of an earlier sign-in). */
  cookie?: string;
}

/** Requests a code, reads it from the memory transport and verifies it. */
export async function signIn(
  t: IdentityTestApp,
  email: string,
  transport: 'cookie' | 'bearer' = 'cookie',
  options: SignInOptions = {},
): Promise<SignedIn> {
  const sent = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/email-otp',
    payload: { email },
  });
  expect(sent.statusCode).toBe(202);
  const verified = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/email-otp/verify',
    payload: {
      email,
      code: lastCode(t.emails, email),
      transport,
      ...(options.deviceId !== undefined && { deviceId: options.deviceId }),
    },
    headers: {
      ...(options.userAgent !== undefined && { 'user-agent': options.userAgent }),
      ...(options.cookie !== undefined && { cookie: options.cookie }),
    },
  });
  expect(verified.statusCode).toBe(200);
  const body = verified.json<{ user: { id: string }; session: { token: string | null } }>();
  return {
    userId: parseUserId(body.user.id),
    headers:
      transport === 'bearer'
        ? { authorization: `Bearer ${body.session.token ?? ''}` }
        : { cookie: cookieHeader(verified) },
    response: verified,
  };
}

/** Inserts a club with the owner connection. */
export async function createClub(
  admin: pg.Pool,
  slug: string,
  name = slug.toUpperCase(),
): Promise<ClubId> {
  const result = await admin.query<{ id: string }>(
    'insert into club (slug, name, short_name) values ($1, $2, upper(left($1, 16))) returning id',
    [slug, name],
  );
  return parseClubId(result.rows[0]?.id);
}

export async function createMembership(
  admin: pg.Pool,
  userId: UserId,
  clubId: ClubId,
  role: string,
): Promise<string> {
  const result = await admin.query<{ id: string }>(
    'insert into membership (club_id, user_id, role) values ($1, $2, $3) returning id',
    [clubId, userId, role],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('membership not created');
  return id;
}

export async function createCategory(
  admin: pg.Pool,
  clubId: ClubId,
  name: string,
): Promise<string> {
  await admin.query(
    `insert into club_branch (club_id, sport, sex) values ($1, 'rugby', 'male')
     on conflict (club_id, sport, sex) do nothing`,
    [clubId],
  );
  const result = await admin.query<{ id: string }>(
    `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
     values ($1, 'rugby', 'male', 'm15', $2, 'development') returning id`,
    [clubId, name],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('category not created');
  return id;
}

/**
 * The auth module without a database: Better Auth over a pool that is never
 * connected. For unit tests that only need the identity routes mounted.
 */
export function offlineAuthModule(): AuthModule {
  const pool = new pg.Pool({ connectionString: 'postgres://offline:offline@127.0.0.1:9/offline' });
  return createAuthModule({
    config: testAuthConfig(),
    db: fakeDatabase(),
    authDb: fakeDatabase(),
    authDrizzle: createDatabase(pool),
    mailer: createMailer(new MemoryEmailTransport()),
    logger: memoryLogger().logger,
  });
}
