import type { EndpointCatalog } from '../endpoint.js';
import { sendSignInCode, signOut, verifySignInCode } from './auth.js';
import { getClubTheme } from './club-theme.js';
import { getHealth } from './health.js';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  previewInvitation,
  revokeInvitation,
} from './invitations.js';
import { getMe, listMyMemberships } from './me.js';

export * from './auth.js';
export * from './club-theme.js';
export * from './health.js';
export * from './invitations.js';
export * from './me.js';

/**
 * Every endpoint of the API, keyed by operationId. The API registers its
 * routes from here, the OpenAPI document is generated from here and the typed
 * client exposes one method per entry.
 */
export const apiEndpoints = {
  getHealth,
  sendSignInCode,
  verifySignInCode,
  signOut,
  getMe,
  listMyMemberships,
  createInvitation,
  listInvitations,
  revokeInvitation,
  previewInvitation,
  acceptInvitation,
  getClubTheme,
} as const satisfies EndpointCatalog;

export type ApiEndpoints = typeof apiEndpoints;
