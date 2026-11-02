import { isAppVersion } from '@sport-performance/domain';

/**
 * Native version of the app binary (B-324, ADR 0045): the single source of
 * `expo.version` (`CFBundleShortVersionString` / `versionName`). Bump it in
 * the PR of every store release; build numbers are not here, EAS increments
 * them (`cli.appVersionSource: "remote"`, `autoIncrement`).
 */
export const NATIVE_APP_VERSION = '1.0.0';

/**
 * EAS Update `runtimeVersion` policy (ADR 0013, ADR 0045): the runtime is the
 * native version, so an OTA update published for `1.4.0` only reaches
 * binaries `1.4.0`, and a native change always ships with a new version
 * (and a new runtime) through the stores.
 */
export const RUNTIME_VERSION_POLICY = 'appVersion' as const;

/** Runtime version of a binary under {@link RUNTIME_VERSION_POLICY}. */
export function runtimeVersionOf(nativeVersion: string): string {
  return nativeVersion;
}

/** The versioning part of the Expo config; `app.config.ts` (B-501) spreads it. */
export interface ExpoVersionConfig {
  readonly version: string;
  readonly runtimeVersion: { readonly policy: typeof RUNTIME_VERSION_POLICY };
}

export function expoVersionConfig(nativeVersion: string = NATIVE_APP_VERSION): ExpoVersionConfig {
  if (!isAppVersion(nativeVersion)) {
    throw new Error(
      `The native app version must be MAJOR.MINOR.PATCH, got ${JSON.stringify(nativeVersion)}`,
    );
  }
  return { version: nativeVersion, runtimeVersion: { policy: RUNTIME_VERSION_POLICY } };
}
