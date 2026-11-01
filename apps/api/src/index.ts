/**
 * @sport-performance/api: the HTTP API (Fastify + zod, ADR 0009). The
 * process starts from `main.ts`; this entry exposes the building blocks for
 * tests and for the packages that plug into the API (auth, data layer).
 */
export { buildApp, type BuildAppOptions, type Lifecycle } from './app.js';
export {
  anonymous,
  tenantContextOf,
  type AuthContext,
  type Authenticate,
  type Membership,
} from './auth/context.js';
export {
  ConfigError,
  envSchema,
  loadConfig,
  loadSentryConfig,
  type ApiConfig,
  type SentryConfig,
} from './config/env.js';
export {
  DatabaseTimeoutError,
  TransactionAbortedError,
  createPgDatabase,
  databaseFromPool,
  type Database,
  type PgDatabaseOptions,
  type TransactionClient,
} from './db/database.js';
export {
  ANONYMOUS_CONTEXT,
  SET_TENANT_CONTEXT_SQL,
  TENANT_SETTINGS,
  TenantContextError,
  tenantContextParameters,
  type TenantContext,
} from './db/tenant-context.js';
export {
  registerEndpoint,
  type EndpointRequest,
  type EndpointResult,
  type EndpointRoute,
  type HandlerContext,
  type TransactionalHandlerContext,
} from './http/endpoint.js';
export { HttpError } from './http/errors.js';
export { disabledErrorReporter, type ErrorReporter } from './observability/error-reporter.js';
export { createLogger } from './observability/logger.js';

export const appName = '@sport-performance/api' as const;
