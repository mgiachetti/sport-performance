import { packageName as contracts } from '@sport-performance/contracts';
import { packageName as domain } from '@sport-performance/domain';

export const appName = '@sport-performance/api' as const;

/** Internal workspace packages this app is wired to (verifies cross-package resolution). */
export const workspaceDependencies = [contracts, domain] as const;
