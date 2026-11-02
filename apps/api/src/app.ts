import cors from '@fastify/cors';
import { MEMBERSHIP_HEADER } from '@sport-performance/contracts';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { anonymous, type Authenticate } from './auth/context.js';
import type { AuthModule } from './auth/module.js';
import { createOriginGuard } from './auth/origin-guard.js';
import type { ApiConfig } from './config/env.js';
import type { Database } from './db/database.js';
import { createErrorHandler, HttpError, notFoundHandler } from './http/errors.js';
import { disabledErrorReporter, type ErrorReporter } from './observability/error-reporter.js';
import { REQUEST_ID_HEADER, requestIdOf } from './observability/request-id.js';
import { registerRoutes } from './routes/index.js';

export interface Lifecycle {
  /** `true` from the shutdown signal on: readiness fails and new requests get `503`. */
  draining: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The database of the app; every query goes through `db.transaction` (ADR 0006). */
    db: Database;
    lifecycle: Lifecycle;
  }
}

export interface BuildAppOptions {
  config: Pick<ApiConfig, 'version' | 'trustProxyHops' | 'bodyLimitBytes' | 'health'>;
  db: Database;
  logger: FastifyBaseLogger;
  /**
   * Better Auth, the identity store and the identity endpoints (ADR 0028).
   * `main.ts` always passes it; without it every request is anonymous and
   * the identity routes are not mounted (unit tests of the core).
   */
  auth?: AuthModule;
  /** Overrides how the caller is resolved (tests); defaults to the auth module's. */
  authenticate?: Authenticate;
  errorReporter?: ErrorReporter;
  /** Registers extra routes before the app is ready (tests, future modules). */
  register?: (app: FastifyInstance) => void;
}

/**
 * Builds the Fastify app without listening or touching process state, so
 * tests drive it with `app.inject()`. `main.ts` owns the process.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const authenticate = options.authenticate ?? options.auth?.authenticate ?? anonymous;
  const guardOrigin =
    options.auth === undefined
      ? undefined
      : createOriginGuard([...options.auth.webOrigins, options.auth.apiOrigin]);

  const app: FastifyInstance = Fastify({
    loggerInstance: options.logger,
    genReqId: requestIdOf,
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    // Trust exactly the proxies in front of us (Railway: 1) for the client IP and protocol.
    trustProxy: (_address: string, hop: number) => hop < config.trustProxyHops,
    bodyLimit: config.bodyLimitBytes,
    // Draining is answered by our hook with the error envelope instead of Fastify's raw 503.
    return503OnClosing: false,
  });

  // Request bodies are JSON only (ADR 0028): a cross-site form or `text/plain` request
  // cannot reach a handler, it gets `400` before authentication matters.
  app.removeContentTypeParser('text/plain');

  app.decorate('db', options.db);
  app.decorate('lifecycle', { draining: false });
  app.decorateRequest('auth', null);

  app.setErrorHandler(createErrorHandler(options.errorReporter ?? disabledErrorReporter));
  app.setNotFoundHandler(notFoundHandler);

  if (options.auth !== undefined && options.auth.webOrigins.length > 0) {
    // The web app calls with `credentials: 'include'`; mobile sends no Origin.
    // Registered first, so preflights are answered before authentication.
    await app.register(cors, {
      origin: [...options.auth.webOrigins],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['content-type', 'authorization', MEMBERSHIP_HEADER, REQUEST_ID_HEADER],
      exposedHeaders: [REQUEST_ID_HEADER, 'retry-after'],
      maxAge: 600,
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    if (app.lifecycle.draining) {
      throw new HttpError('service_unavailable', 'The server is shutting down', {
        headers: { connection: 'close' },
      });
    }
    guardOrigin?.(request);
    // The request context hook: Better Auth sets user and membership here (ADR 0028).
    request.auth = await authenticate(request, reply);
  });

  // While draining, close each keep-alive connection after its in-flight
  // response, so `app.close()` does not wait for the keep-alive timeout.
  app.addHook('onSend', async (_request, reply, payload) => {
    if (app.lifecycle.draining) void reply.header('connection', 'close');
    return payload;
  });

  registerRoutes(app, {
    version: config.version,
    databaseTimeoutMs: config.health.databaseTimeoutMs,
    auth: options.auth,
  });
  options.register?.(app);

  await app.ready();
  return app;
}
