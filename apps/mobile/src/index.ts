import { packageName as contracts } from '@sport-performance/contracts';
import { packageName as domain } from '@sport-performance/domain';
import { packageName as i18n } from '@sport-performance/i18n';
import { packageName as uiTokens } from '@sport-performance/ui-tokens';

export const appName = '@sport-performance/mobile' as const;

/** Internal workspace packages this app is wired to (verifies cross-package resolution). */
export const workspaceDependencies = [contracts, domain, i18n, uiTokens] as const;

export * from './version/index.js';
