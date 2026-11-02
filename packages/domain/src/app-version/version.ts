import { memberGuard, memberParser } from '../enum.js';
import { DomainValidationError, describeValue } from '../errors.js';

/**
 * Platforms of the mobile app (ADR 0013): one binary per store. The web is
 * not here: it always serves the latest build, so it has no minimum version.
 */
export const APP_PLATFORMS = ['ios', 'android'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];
export const isAppPlatform = memberGuard(APP_PLATFORMS);
export const parseAppPlatform = memberParser(APP_PLATFORMS, 'invalid_argument', 'app platform');

/**
 * Native version of the app binary: `MAJOR.MINOR.PATCH`, numbers without
 * leading zeros (at most 6 digits), as both stores accept it
 * (`CFBundleShortVersionString`, `versionName`). No pre-release or build
 * suffix: build numbers are separate (EAS increments them).
 */
export const APP_VERSION_PATTERN = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/** A parsed app version. */
export interface AppVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function isAppVersion(value: unknown): value is string {
  return typeof value === 'string' && APP_VERSION_PATTERN.test(value);
}

/** Parses `1.4.0`. Throws {@link DomainValidationError} (`invalid_argument`) otherwise. */
export function parseAppVersion(value: unknown): AppVersion {
  const match = typeof value === 'string' ? APP_VERSION_PATTERN.exec(value) : null;
  if (match === null) {
    throw new DomainValidationError(
      'invalid_argument',
      `Invalid app version: ${describeValue(value)}. Expected MAJOR.MINOR.PATCH.`,
      value,
    );
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatAppVersion(version: AppVersion): string {
  return `${String(version.major)}.${String(version.minor)}.${String(version.patch)}`;
}

/** Negative when `a` is older than `b`, `0` when equal, positive when newer. */
export function compareAppVersions(a: AppVersion | string, b: AppVersion | string): number {
  const left = typeof a === 'string' ? parseAppVersion(a) : a;
  const right = typeof b === 'string' ? parseAppVersion(b) : b;
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}
