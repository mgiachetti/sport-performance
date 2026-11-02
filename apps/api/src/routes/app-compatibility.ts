import { CONTRACT_VERSION, getAppCompatibility } from '@sport-performance/contracts';
import { evaluateAppCompatibility } from '@sport-performance/domain';
import type { FastifyInstance } from 'fastify';
import type { MobileAppConfig } from '../config/env.js';
import { parseMobileAppPolicies } from '../http/app-version.js';
import { registerEndpoint } from '../http/endpoint.js';

export interface AppCompatibilityOptions {
  /** Deployed version of the server (`APP_VERSION` or the commit sha). */
  version: string;
  mobileApp: MobileAppConfig;
}

/** The answer depends only on the query and the deploy: shared caches may keep it a while. */
const CACHE_CONTROL = 'public, max-age=300';

/**
 * `GET /v1/app/compatibility` (B-324, ADR 0045): whether a version of the app
 * can use the API, and where to update it. No session, no database: the
 * policy is configuration, the same for every club.
 */
export function registerAppCompatibilityRoutes(
  app: FastifyInstance,
  options: AppCompatibilityOptions,
): void {
  const policies = parseMobileAppPolicies(options.mobileApp);
  registerEndpoint(app, getAppCompatibility, {
    transaction: false,
    handler: ({ query }, { reply }) => {
      const policy = options.mobileApp[query.platform];
      void reply.header('cache-control', CACHE_CONTROL);
      return Promise.resolve({
        status: evaluateAppCompatibility(policies[query.platform], query.version),
        platform: query.platform,
        version: query.version,
        // Informative: under `policy: appVersion` it equals the native version (ADR 0045).
        runtimeVersion: query.runtimeVersion ?? null,
        minVersion: policy.minVersion,
        latestVersion: policy.latestVersion,
        storeUrl: policy.storeUrl,
        api: { contractVersion: CONTRACT_VERSION, serverVersion: options.version },
      });
    },
  });
}
