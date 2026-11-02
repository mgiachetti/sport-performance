import { getHealth, healthSchema, type Health } from '@sport-performance/contracts';
import type { FastifyInstance } from 'fastify';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';

export interface HealthOptions {
  version: string;
  databaseTimeoutMs: number;
}

/**
 * Probes for the platform (ADR 0003): outside `/v1` and the public contract,
 * like `/openapi.json`, because they describe the process, not the API.
 *
 * - `GET /health/live`: the process answers. Never touches dependencies, so a
 *   database outage does not get the container restarted.
 * - `GET /health/ready`: the process can serve: not shutting down and the
 *   database answers within `databaseTimeoutMs`. Otherwise `503`.
 * - `GET /v1/health` (contract `getHealth`): same check as readiness, for
 *   monitors and clients that only speak the contract.
 */
export function registerHealthRoutes(app: FastifyInstance, options: HealthOptions): void {
  const healthy = (): Health =>
    healthSchema.parse({ status: 'ok', version: options.version, time: new Date().toISOString() });

  const ready = async (): Promise<Health> => {
    if (app.lifecycle.draining) {
      throw new HttpError('service_unavailable', 'The server is shutting down');
    }
    try {
      await app.db.ping(options.databaseTimeoutMs);
    } catch (error) {
      app.log.warn({ err: error }, 'readiness: database ping failed');
      throw new HttpError('service_unavailable', 'The database is not answering', { cause: error });
    }
    return healthy();
  };

  // Probes run often: keep them out of the info logs unless they fail.
  // Probes are exempt from the rate limits: a limited probe would get a healthy replica restarted.
  const probe = { logLevel: 'warn', config: { rateLimit: 'exempt' } } as const;
  app.get('/health/live', probe, () => Promise.resolve(healthy()));
  app.get('/health/ready', probe, ready);
  registerEndpoint(app, getHealth, { transaction: false, handler: ready });
}
