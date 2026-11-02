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
export { createSessionAuthenticate, selectMembership } from './auth/authenticate.js';
export { createBetterAuth, generateSignInCode, type SportAuth } from './auth/better-auth.js';
export { createIdentityStore, type ActiveMembership, type IdentityStore } from './auth/identity.js';
export { createAuthModule, type AuthModule, type CreateAuthModuleOptions } from './auth/module.js';
export {
  AUTH_RATE_LIMITS,
  createMemoryRateLimiter,
  createPgRateLimiter,
  type RateLimitCheck,
  type RateLimiter,
  type RateLimitRule,
} from './auth/rate-limit.js';
export {
  ConfigError,
  configSummary,
  envSchema,
  loadConfig,
  loadSentryConfig,
  type ApiConfig,
  type AuthConfig,
  type EmailConfig,
  type SentryConfig,
} from './config/env.js';
export { createMailer, type Mailer } from './email/mailer.js';
export { ResendEmailTransport } from './email/resend.js';
export {
  EmailDeliveryError,
  LogEmailTransport,
  MemoryEmailTransport,
  type EmailMessage,
  type EmailTransport,
} from './email/transport.js';
export {
  DatabaseTimeoutError,
  TransactionAbortedError,
  createApiPool,
  createPgDatabase,
  databaseFromPool,
  tenantDatabase,
  type Database,
  type PgDatabaseOptions,
  type TenantDatabase,
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
  type ClubAuthContext,
  type EndpointRequest,
  type EndpointResult,
  type EndpointRoute,
  type EndpointRouteLimits,
  type HandlerContext,
  type TransactionalHandlerContext,
} from './http/endpoint.js';
export { HttpError } from './http/errors.js';
export { createSecurityHeaders, SECURITY_HEADERS } from './security/headers.js';
export {
  DEFAULT_ROUTE_CLASS_LIMITS,
  ROUTE_CLASSES,
  createGeneralRateLimit,
  endpointRouteClass,
  type RouteClass,
  type RouteClassLimits,
} from './security/rate-limit.js';
export { disabledErrorReporter, type ErrorReporter } from './observability/error-reporter.js';
export { createLogger } from './observability/logger.js';

export const appName = '@sport-performance/api' as const;
