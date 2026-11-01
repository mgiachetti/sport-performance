import type { EndpointCatalog } from '../endpoint.js';
import { getClubTheme } from './club-theme.js';
import { getHealth } from './health.js';

export * from './club-theme.js';
export * from './health.js';

/**
 * Every endpoint of the API, keyed by operationId. The API registers its
 * routes from here, the OpenAPI document is generated from here and the typed
 * client exposes one method per entry.
 */
export const apiEndpoints = {
  getHealth,
  getClubTheme,
} as const satisfies EndpointCatalog;

export type ApiEndpoints = typeof apiEndpoints;
