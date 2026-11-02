import {
  CLIENT_PLATFORM_HEADER,
  CLIENT_RUNTIME_VERSION_HEADER,
  CLIENT_VERSION_HEADER,
  RUNTIME_VERSION_PATTERN,
  type ValidationIssue,
} from '@sport-performance/contracts';
import {
  evaluateAppCompatibility,
  isAppPlatform,
  isAppVersion,
  type AppPlatform,
} from '@sport-performance/domain';
import type { FastifyRequest } from 'fastify';
import type { MobileAppConfig } from '../config/env.js';
import { HttpError } from './errors.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * `skip`: the route answers apps of any version (health, OpenAPI,
     * `GET /v1/app/compatibility`). Default: the app version is checked.
     */
    appVersionCheck?: 'skip';
  }
}

/** The mobile app that sent a request, from its client headers (ADR 0045). */
export interface ClientApp {
  readonly platform: AppPlatform;
  readonly version: string;
  readonly runtimeVersion: string | null;
}

function header(request: FastifyRequest, name: string): string | string[] | undefined {
  return request.headers[name];
}

function invalid(name: string, message: string): ValidationIssue {
  return { path: ['headers', name], code: 'invalid_value', message };
}

/**
 * Reads the client headers of the app. `null` when the request sends none
 * (the web, scripts, monitors). Headers that are repeated, malformed, or one
 * of platform and version without the other: `400 validation_failed`.
 */
export function clientAppOf(request: FastifyRequest): ClientApp | null {
  const platform = header(request, CLIENT_PLATFORM_HEADER);
  const version = header(request, CLIENT_VERSION_HEADER);
  const runtimeVersion = header(request, CLIENT_RUNTIME_VERSION_HEADER);
  if (platform === undefined && version === undefined && runtimeVersion === undefined) return null;

  const issues: ValidationIssue[] = [];
  if (!isAppPlatform(platform)) {
    issues.push(invalid(CLIENT_PLATFORM_HEADER, 'Expected ios or android'));
  }
  if (!isAppVersion(version)) {
    issues.push(invalid(CLIENT_VERSION_HEADER, 'Expected the native version, MAJOR.MINOR.PATCH'));
  }
  if (
    runtimeVersion !== undefined &&
    (typeof runtimeVersion !== 'string' || !RUNTIME_VERSION_PATTERN.test(runtimeVersion))
  ) {
    issues.push(invalid(CLIENT_RUNTIME_VERSION_HEADER, 'Expected an EAS runtime version'));
  }
  if (
    issues.length > 0 ||
    !isAppPlatform(platform) ||
    !isAppVersion(version) ||
    Array.isArray(runtimeVersion)
  ) {
    throw new HttpError('validation_failed', 'Invalid client headers of the app', {
      details: issues,
    });
  }
  return { platform, version, runtimeVersion: runtimeVersion ?? null };
}

/**
 * The `onRequest` check of the app version (ADR 0045): an app below the
 * minimum supported version of its platform gets `426 app_update_required`
 * on every route except those marked `appVersionCheck: 'skip'`. It runs
 * before authentication: an outdated app costs no session lookup.
 */
export function createAppVersionCheck(config: MobileAppConfig): (request: FastifyRequest) => void {
  return (request) => {
    // `routeOptions.config` is empty for unknown routes: they are checked too.
    if (request.routeOptions.config.appVersionCheck === 'skip') return;
    const client = clientAppOf(request);
    if (client === null) return;
    const policy = config[client.platform];
    if (evaluateAppCompatibility(policy, client.version) === 'update_required') {
      throw new HttpError(
        'app_update_required',
        `App ${client.version} on ${client.platform} is no longer supported; the minimum is ${policy.minVersion} (GET /v1/app/compatibility)`,
      );
    }
  };
}
