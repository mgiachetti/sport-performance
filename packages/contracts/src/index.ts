/**
 * API contract of Sport Performance: zod schemas of every request and
 * response, the endpoint catalog and the typed client for web and mobile.
 * The OpenAPI generator lives in `@sport-performance/contracts/openapi`.
 */
export * from './client/client.js';
export * from './client/errors.js';
export * from './endpoint.js';
export * from './strict-input.js';
export * from './endpoints/index.js';
// Schemas without an endpoint yet (B-305): not in the catalog.
export * from './endpoints/change-history.js';
export * from './primitives/color.js';
export * from './primitives/dates.js';
export * from './primitives/errors.js';
export * from './primitives/ids.js';
export * from './primitives/pagination.js';

/** Workspace package identifier (the app skeletons list their workspace dependencies with it). */
export const packageName = '@sport-performance/contracts' as const;
