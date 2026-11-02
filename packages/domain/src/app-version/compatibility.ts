import { memberGuard } from '../enum.js';
import { DomainValidationError } from '../errors.js';
import { compareAppVersions, parseAppVersion, type AppVersion } from './version.js';

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

/** Version policy of one platform, as configured (`MAJOR.MINOR.PATCH` strings). */
export interface AppVersionPolicy {
  /** Oldest version the API still serves. */
  readonly minVersion: AppVersion | string;
  /** Newest version published in the store; `null` when not announced. */
  readonly latestVersion: AppVersion | string | null;
}

/** A policy already parsed and validated by {@link parseAppVersionPolicy}. */
export interface ParsedAppVersionPolicy {
  readonly minVersion: AppVersion;
  readonly latestVersion: AppVersion | null;
}

function versionOf(value: AppVersion | string): AppVersion {
  return typeof value === 'string' ? parseAppVersion(value) : value;
}

/**
 * Parses and validates a policy once (at startup, or when the app reads its
 * cache), so {@link evaluateAppCompatibility} does no validation per call.
 * Throws {@link DomainValidationError} (`invalid_argument`) on a malformed
 * version or a latest version older than the minimum (a configuration error).
 */
export function parseAppVersionPolicy(policy: AppVersionPolicy): ParsedAppVersionPolicy {
  const minVersion = versionOf(policy.minVersion);
  const latestVersion = policy.latestVersion === null ? null : versionOf(policy.latestVersion);
  if (latestVersion !== null && compareAppVersions(latestVersion, minVersion) < 0) {
    throw new DomainValidationError(
      'invalid_argument',
      'The latest app version cannot be older than the minimum supported version.',
      policy,
    );
  }
  return { minVersion, latestVersion };
}

/**
 * Status of `version` under `policy`. A build newer than the announced
 * latest (in store review, internal testing) is `supported`.
 */
export function evaluateAppCompatibility(
  policy: ParsedAppVersionPolicy,
  version: AppVersion | string,
): AppCompatibilityStatus {
  if (compareAppVersions(version, policy.minVersion) < 0) return 'update_required';
  if (policy.latestVersion !== null && compareAppVersions(version, policy.latestVersion) < 0) {
    return 'update_available';
  }
  return 'supported';
}
