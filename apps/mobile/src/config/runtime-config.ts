import { APP_VARIANTS, isAppVariant, type AppVariant } from './variants.ts';

/**
 * What the running JavaScript knows about its build (ADR 0058). `app.config.ts`
 * writes it into `expo.extra.app` when the binary or the EAS Update is built,
 * and the app reads it back with {@link parseRuntimeConfig} at startup. It
 * holds no secrets: everything here ships inside the bundle.
 */
export interface RuntimeConfig {
  readonly variant: AppVariant;
  /** Origin of the API, without a trailing slash. */
  readonly apiBaseUrl: string;
  /** Origin of the staff web (universal links); `null` in development without one. */
  readonly webAppUrl: string | null;
  /** Deep link scheme of this variant. */
  readonly scheme: string;
  /** `null`: Sentry is not initialized (development without a DSN). */
  readonly sentry: SentryRuntimeConfig | null;
}

export interface SentryRuntimeConfig {
  /** The DSN is public by design (it only lets a client send events). */
  readonly dsn: string;
  /** Fraction of transactions traced, 0 to 1. */
  readonly tracesSampleRate: number;
}

export class InvalidRuntimeConfigError extends Error {
  override readonly name = 'InvalidRuntimeConfigError';
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '10.0.2.2']);

/** Private network ranges a phone reaches a development API on (LAN IP of the laptop). */
function isPrivateHost(hostname: string): boolean {
  if (LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.local')) return true;
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * An origin URL (`https://api.example.com`, optional path prefix), without
 * trailing slash. Release variants require `https`; development also accepts
 * plain `http` to a local or private-network host (the laptop running the API).
 */
export function parseOriginUrl(name: string, value: unknown, variant: AppVariant): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidRuntimeConfigError(`${name} is required`);
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new InvalidRuntimeConfigError(`${name} must be a URL, got ${JSON.stringify(value)}`);
  }
  if (url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new InvalidRuntimeConfigError(`${name} must not have a query, hash or credentials`);
  }
  const secure = url.protocol === 'https:';
  const localHttp =
    variant === 'development' && url.protocol === 'http:' && isPrivateHost(url.hostname);
  if (!secure && !localHttp) {
    throw new InvalidRuntimeConfigError(
      variant === 'development'
        ? `${name} must be https, or http to a local or private-network host`
        : `${name} must be https in ${variant}`,
    );
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function parseSampleRate(value: unknown): number {
  const rate = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (rate === undefined || rate === null || rate === '') return 0;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new InvalidRuntimeConfigError('SENTRY_TRACES_SAMPLE_RATE must be a number from 0 to 1');
  }
  return rate;
}

function parseSentry(dsn: unknown, sampleRate: unknown): SentryRuntimeConfig | null {
  if (dsn === undefined || dsn === null || dsn === '') return null;
  if (typeof dsn !== 'string') throw new InvalidRuntimeConfigError('SENTRY_DSN must be a string');
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new InvalidRuntimeConfigError('SENTRY_DSN must be a URL');
  }
  if (url.protocol !== 'https:' || url.username === '') {
    throw new InvalidRuntimeConfigError('SENTRY_DSN must be an https DSN with its public key');
  }
  return { dsn, tracesSampleRate: parseSampleRate(sampleRate) };
}

/** Environment variables read when building the app config (see `.env.example`). */
export interface BuildEnv {
  /** `process.env` as is: other variables are ignored. */
  readonly [name: string]: string | undefined;
  readonly APP_VARIANT?: string | undefined;
  readonly API_BASE_URL?: string | undefined;
  readonly WEB_APP_URL?: string | undefined;
  readonly SENTRY_DSN?: string | undefined;
  readonly SENTRY_TRACES_SAMPLE_RATE?: string | undefined;
  readonly SENTRY_ORG?: string | undefined;
  readonly SENTRY_PROJECT?: string | undefined;
  readonly EAS_PROJECT_ID?: string | undefined;
}

export function parseVariant(value: unknown): AppVariant {
  if (value === undefined || value === '') return 'development';
  if (!isAppVariant(value)) {
    throw new InvalidRuntimeConfigError(
      `APP_VARIANT must be one of ${APP_VARIANTS.join(', ')}, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** Default API of a development build: the API running on the same machine. */
export const DEVELOPMENT_API_BASE_URL = 'http://localhost:3000';

/**
 * Validates the build environment into the runtime config. Release variants
 * (`staging`, `production`) require an https API and web: a build without
 * them fails here instead of shipping an app that cannot sign in or open
 * invitation links.
 */
export function runtimeConfigFromEnv(env: BuildEnv, scheme: string): RuntimeConfig {
  const variant = parseVariant(env.APP_VARIANT);
  const release = variant !== 'development';
  const apiBaseUrl = parseOriginUrl(
    'API_BASE_URL',
    env.API_BASE_URL ?? (release ? undefined : DEVELOPMENT_API_BASE_URL),
    variant,
  );
  const webAppUrl =
    env.WEB_APP_URL === undefined || env.WEB_APP_URL === ''
      ? release
        ? parseOriginUrl('WEB_APP_URL', undefined, variant)
        : null
      : parseOriginUrl('WEB_APP_URL', env.WEB_APP_URL, variant);
  return {
    variant,
    apiBaseUrl,
    webAppUrl,
    scheme,
    sentry: parseSentry(env.SENTRY_DSN, env.SENTRY_TRACES_SAMPLE_RATE),
  };
}

/**
 * Reads back the config `app.config.ts` embedded (`Constants.expoConfig.extra.app`).
 * Throws on a malformed value: that is a broken build, better caught at launch.
 */
export function parseRuntimeConfig(extra: unknown): RuntimeConfig {
  if (typeof extra !== 'object' || extra === null) {
    throw new InvalidRuntimeConfigError('expo.extra.app is missing: rebuild the app config');
  }
  const record = extra as Record<string, unknown>;
  const variant = parseVariant(record.variant);
  if (typeof record.scheme !== 'string' || !/^[a-z][a-z0-9+.-]*$/.test(record.scheme)) {
    throw new InvalidRuntimeConfigError('expo.extra.app.scheme is invalid');
  }
  const sentry = record.sentry as Partial<SentryRuntimeConfig> | null | undefined;
  return {
    variant,
    apiBaseUrl: parseOriginUrl('apiBaseUrl', record.apiBaseUrl, variant),
    webAppUrl:
      record.webAppUrl === null ? null : parseOriginUrl('webAppUrl', record.webAppUrl, variant),
    scheme: record.scheme,
    sentry:
      sentry === null || sentry === undefined
        ? null
        : parseSentry(sentry.dsn, sentry.tracesSampleRate),
  };
}
