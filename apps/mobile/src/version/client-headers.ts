import {
  CLIENT_PLATFORM_HEADER,
  CLIENT_RUNTIME_VERSION_HEADER,
  CLIENT_VERSION_HEADER,
  RUNTIME_VERSION_PATTERN,
  type HeaderMap,
} from '@sport-performance/contracts';
import { isAppPlatform, isAppVersion, type AppPlatform } from '@sport-performance/domain';

/**
 * What the running app is (ADR 0045). B-501 fills it from `Platform.OS`,
 * `expo-application` (`nativeApplicationVersion`) and `expo-updates`
 * (`runtimeVersion`).
 */
export interface AppBuildInfo {
  readonly platform: AppPlatform;
  /** Native version of the binary, `MAJOR.MINOR.PATCH`. */
  readonly nativeVersion: string;
  /** EAS Update runtime of the running bundle; `null` in development builds without updates. */
  readonly runtimeVersion: string | null;
}

/** Checks the build info once, at startup: a malformed value is a bug of the build. */
export function parseAppBuildInfo(info: AppBuildInfo): AppBuildInfo {
  if (!isAppPlatform(info.platform)) {
    throw new Error(`Unknown app platform: ${String(info.platform)}`);
  }
  if (!isAppVersion(info.nativeVersion)) {
    throw new Error(
      `The native app version must be MAJOR.MINOR.PATCH, got ${JSON.stringify(info.nativeVersion)}`,
    );
  }
  if (info.runtimeVersion !== null && !RUNTIME_VERSION_PATTERN.test(info.runtimeVersion)) {
    throw new Error(`Invalid EAS runtime version: ${info.runtimeVersion}`);
  }
  return info;
}

/**
 * Client headers the app sends on every request (the `headers` option of
 * `createApiClient`), so the API can answer `426 app_update_required` when
 * this binary is no longer supported.
 */
export function appClientHeaders(info: AppBuildInfo): HeaderMap {
  const build = parseAppBuildInfo(info);
  return {
    [CLIENT_PLATFORM_HEADER]: build.platform,
    [CLIENT_VERSION_HEADER]: build.nativeVersion,
    ...(build.runtimeVersion !== null && { [CLIENT_RUNTIME_VERSION_HEADER]: build.runtimeVersion }),
  };
}
