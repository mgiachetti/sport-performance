/** Test helpers. Not part of the build (`tsconfig.build.json` excludes `src/testing`). */
import { randomUUID } from 'node:crypto';
import { parseUuid, type ClubId, type Role, type UserId } from '@sport-performance/domain';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { describe } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import type { AuthContext } from '../auth/context.js';
import type { Database } from '../db/database.js';
import type { ErrorReportContext, ErrorReporter } from '../observability/error-reporter.js';
import { createLogger } from '../observability/logger.js';

export type LogLine = Record<string, unknown> & { msg?: string; level?: string };

/** A real pino logger writing to memory, so tests read what production would log. */
export function memoryLogger(): {
  logger: FastifyBaseLogger;
  lines: () => LogLine[];
  raw: () => string;
} {
  const chunks: string[] = [];
  const logger = createLogger({
    level: 'debug',
    version: 'test',
    environment: 'test',
    destination: {
      write(chunk: string) {
        chunks.push(chunk);
      },
    },
  });
  return {
    logger,
    raw: () => chunks.join(''),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as LogLine),
  };
}

/** Reporter that records what it was given. */
export function recordingReporter(): ErrorReporter & {
  captured: { error: unknown; context: ErrorReportContext | undefined }[];
} {
  const captured: { error: unknown; context: ErrorReportContext | undefined }[] = [];
  return {
    enabled: true,
    captured,
    capture(error, context) {
      captured.push({ error, context });
    },
    flush: () => Promise.resolve(true),
  };
}

/** An authenticated caller for tests that do not go through Better Auth. */
export function testAuthContext(
  userId: UserId,
  membership: { clubId: ClubId; role: Role; membershipId?: string } | null = null,
): AuthContext {
  return {
    userId,
    email: 'test@example.com',
    name: 'Test',
    isSuperadmin: false,
    session: { id: 'test-session', expiresAt: new Date(Date.now() + 60_000) },
    membership:
      membership === null
        ? null
        : {
            membershipId: parseUuid(membership.membershipId ?? randomUUID()),
            clubId: membership.clubId,
            role: membership.role,
          },
    membershipRejected: false,
    supportReason: null,
  };
}

/** Database double for tests that do not need Postgres. */
export function fakeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    transaction: () => Promise.reject(new Error('fakeDatabase: transaction not stubbed')),
    ping: () => Promise.resolve(),
    close: () => Promise.resolve(),
    ...overrides,
  };
}

export const testConfig: BuildAppOptions['config'] = {
  version: 'test-version',
  trustProxyHops: 0,
  bodyLimitBytes: 1024 * 1024,
  health: { databaseTimeoutMs: 500 },
  http: {
    requestTimeoutMs: 30_000,
    headersTimeoutMs: 10_000,
    keepAliveTimeoutMs: 72_000,
    connectionTimeoutMs: 60_000,
    maxConnections: 2048,
    maxHeaderSizeBytes: 16_384,
  },
  rateLimit: { enabled: true, timeoutMs: 500 },
  securityHeaders: { hsts: false },
};

export async function testApp(
  options: Partial<BuildAppOptions> = {},
): Promise<{ app: FastifyInstance; logs: ReturnType<typeof memoryLogger> }> {
  const logs = memoryLogger();
  const app = await buildApp({
    config: testConfig,
    db: fakeDatabase(),
    logger: logs.logger,
    ...options,
  });
  return { app, logs };
}

/**
 * `describe` for tests against a real Postgres 16 (`DATABASE_URL`). Locally
 * without a database they are skipped; in CI a missing URL is a failure.
 */
export const databaseUrl = process.env.DATABASE_URL;

export function describeWithPostgres(name: string, body: (url: string) => void): void {
  if (databaseUrl !== undefined && databaseUrl !== '') {
    describe(name, () => {
      body(databaseUrl);
    });
    return;
  }
  if (process.env.CI !== undefined) {
    throw new Error(`${name}: DATABASE_URL is required in CI (Postgres service)`);
  }
  describe.skip(`${name} (set DATABASE_URL to run against Postgres)`, () => undefined);
}
