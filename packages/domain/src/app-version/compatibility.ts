import { memberGuard } from '../enum.js';
import { DomainValidationError } from '../errors.js';
import { compareAppVersions, type AppVersion } from './version.js';

/**
 * What a version of the app may do against the API (B-324, ADR 0045):
 * - `supported`: up to date.
 * - `update_available`: works, but there is a newer version in the store
 *   (a dismissible notice).
 * - `update_required`: below the minimum supported version. Online, the
 *   API answers `426 app_update_required` and the app shows the blocking
 *   "actualizá la app" screen.
 */
export const APP_COMPATIBILITY_STATUSES = [
  'supported',
  'update_available',
  'update_required',
] as const;
export type AppCompatibilityStatus = (typeof APP_COMPATIBILITY_STATUSES)[number];
export const isAppCompatibilityStatus = memberGuard(APP_COMPATIBILITY_STATUSES);

/** Version policy of one platform. */
export interface AppVersionPolicy {
  /** Oldest version the API still serves. */
  readonly minVersion: AppVersion | string;
  /** Newest version published in the store; `null` when not announced. */
  readonly latestVersion: AppVersion | string | null;
}

/** Throws when the latest version is older than the minimum (a configuration error). */
export function assertAppVersionPolicy(policy: AppVersionPolicy): void {
  if (
    policy.latestVersion !== null &&
    compareAppVersions(policy.latestVersion, policy.minVersion) < 0
  ) {
    throw new DomainValidationError(
      'invalid_argument',
      'The latest app version cannot be older than the minimum supported version.',
      policy,
    );
  }
}

/**
 * Status of `version` under `policy`. A build newer than the announced
 * latest (in store review, internal testing) is `supported`.
 */
export function evaluateAppCompatibility(
  policy: AppVersionPolicy,
  version: AppVersion | string,
): AppCompatibilityStatus {
  assertAppVersionPolicy(policy);
  if (compareAppVersions(version, policy.minVersion) < 0) return 'update_required';
  if (policy.latestVersion !== null && compareAppVersions(version, policy.latestVersion) < 0) {
    return 'update_available';
  }
  return 'supported';
}
