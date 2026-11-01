import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { anonymous, type Authenticate } from './auth/context.js';
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
  /** Resolves the caller of each request; anonymous until Better Auth lands (#40). */
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
  const authenticate = options.authenticate ?? anonymous;

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

  app.decorate('db', options.db);
  app.decorate('lifecycle', { draining: false });
  app.decorateRequest('auth', null);

  app.setErrorHandler(createErrorHandler(options.errorReporter ?? disabledErrorReporter));
  app.setNotFoundHandler(notFoundHandler);

  app.addHook('onRequest', async (request, reply) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    if (app.lifecycle.draining) {
      throw new HttpError('service_unavailable', 'The server is shutting down', {
        headers: { connection: 'close' },
      });
    }
    // The request context hook: Better Auth (#40) sets user and membership here.
    request.auth = await authenticate(request);
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
  });
  options.register?.(app);

  await app.ready();
  return app;
}
