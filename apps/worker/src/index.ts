import { packageName as domain } from '@sport-performance/domain';

export const appName = '@sport-performance/worker' as const;

/** Internal workspace packages this app is wired to (verifies cross-package resolution). */
export const workspaceDependencies = [domain] as const;
