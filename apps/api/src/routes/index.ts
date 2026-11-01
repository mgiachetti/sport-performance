import type { ApiEndpoints } from '@sport-performance/contracts';
import type { FastifyInstance } from 'fastify';
import { registerHealthRoutes, type HealthOptions } from './health.js';
import { registerOpenApiRoute } from './openapi.js';

/**
 * Endpoints of the contract the API serves, by operationId. Adding an
 * endpoint to `apiEndpoints` without listing it here or in
 * {@link PENDING_ENDPOINTS} fails to compile (see `Unaccounted` below).
 */
export const IMPLEMENTED_ENDPOINTS = [
  'getHealth',
] as const satisfies readonly (keyof ApiEndpoints)[];

/** Declared in the contract but served by a later issue. */
export const PENDING_ENDPOINTS = {
  getClubTheme: '#44 (B-313): needs the clubs table of packages/db',
} as const satisfies Partial<Record<keyof ApiEndpoints, string>>;

type Unaccounted = Exclude<
  keyof ApiEndpoints,
  (typeof IMPLEMENTED_ENDPOINTS)[number] | keyof typeof PENDING_ENDPOINTS
>;
/** Compile-time check: every endpoint of the contract is either served or pending. */
export const everyEndpointAccounted: [Unaccounted] extends [never] ? true : Unaccounted = true;

export type RoutesOptions = HealthOptions;

export function registerRoutes(app: FastifyInstance, options: RoutesOptions): void {
  registerOpenApiRoute(app);
  registerHealthRoutes(app, options);
}
