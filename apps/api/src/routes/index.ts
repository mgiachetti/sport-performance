import type { ApiEndpoints } from '@sport-performance/contracts';
import type { FastifyInstance } from 'fastify';
import type { AuthModule } from '../auth/module.js';
import { registerAuthRoutes } from './auth.js';
import { registerHealthRoutes, type HealthOptions } from './health.js';
import { registerInvitationRoutes } from './invitations.js';
import { registerMeRoutes } from './me.js';
import { registerOpenApiRoute } from './openapi.js';

/**
 * Endpoints of the contract the API serves, by operationId. Adding an
 * endpoint to `apiEndpoints` without listing it here or in
 * {@link PENDING_ENDPOINTS} fails to compile (see `Unaccounted` below).
 */
export const IMPLEMENTED_ENDPOINTS = [
  'getHealth',
  'sendSignInCode',
  'verifySignInCode',
  'signOut',
  'getMe',
  'listMyMemberships',
  'createInvitation',
  'listInvitations',
  'revokeInvitation',
  'previewInvitation',
  'acceptInvitation',
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

export interface RoutesOptions extends HealthOptions {
  /**
   * Identity endpoints (`/v1/auth`, `/v1/me`, `/v1/invitations`). Always
   * present in the process (`main.ts`); unit tests of the core build the app
   * without it and those routes answer `404`.
   */
  auth?: AuthModule | undefined;
}

export function registerRoutes(app: FastifyInstance, options: RoutesOptions): void {
  registerOpenApiRoute(app);
  registerHealthRoutes(app, options);
  if (options.auth !== undefined) {
    registerAuthRoutes(app, options.auth);
    registerMeRoutes(app, options.auth);
    registerInvitationRoutes(app, options.auth);
  }
}
