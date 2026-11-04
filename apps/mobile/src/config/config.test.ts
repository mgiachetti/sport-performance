import { describe, expect, it } from 'vitest';
import { NATIVE_APP_VERSION } from '../version/index.ts';
import { APP_LINK_PATH_PREFIXES, buildExpoConfig, type AppExtra } from './expo-config.ts';
import {
  InvalidRuntimeConfigError,
  parseOriginUrl,
  parseRuntimeConfig,
  runtimeConfigFromEnv,
} from './runtime-config.ts';
import { APP_VARIANTS, variantIdentity } from './variants.ts';

const PROJECT_ID = '3f0c8a52-6d1e-4b8a-9f3e-2c7d5b1a0e94';

const productionEnv = {
  APP_VARIANT: 'production',
  API_BASE_URL: 'https://api.sport.example.com/',
  WEB_APP_URL: 'https://app.sport.example.com',
  EAS_PROJECT_ID: PROJECT_ID,
  SENTRY_DSN: 'https://public@o1.ingest.sentry.io/2',
  SENTRY_TRACES_SAMPLE_RATE: '0.1',
};

describe('variants', () => {
  it('gives each variant its own app id, scheme and update channel', () => {
    const identities = APP_VARIANTS.map(variantIdentity);
    expect(new Set(identities.map((i) => i.appId)).size).toBe(APP_VARIANTS.length);
    expect(new Set(identities.map((i) => i.scheme)).size).toBe(APP_VARIANTS.length);
    expect(identities.map((i) => i.updateChannel)).toEqual([...APP_VARIANTS]);
    // The API builds `sportperformance://…` links: only production answers them.
    expect(variantIdentity('production').scheme).toBe('sportperformance');
  });
});

describe('parseOriginUrl', () => {
  it('normalizes an origin and keeps a path prefix without trailing slash', () => {
    expect(parseOriginUrl('X', 'https://api.example.com/', 'production')).toBe(
      'https://api.example.com',
    );
    expect(parseOriginUrl('X', 'https://example.com/api/', 'staging')).toBe(
      'https://example.com/api',
    );
  });

  it('requires https outside development', () => {
    expect(() => parseOriginUrl('API_BASE_URL', 'http://api.example.com', 'staging')).toThrow(
      'API_BASE_URL must be https in staging',
    );
    expect(() => parseOriginUrl('API_BASE_URL', 'http://localhost:3000', 'production')).toThrow(
      InvalidRuntimeConfigError,
    );
  });

  it('accepts plain http in development only to local or private-network hosts', () => {
    for (const url of [
      'http://localhost:3000',
      'http://192.168.0.12:3000',
      'http://10.0.2.2:3000',
      'http://172.20.1.5:3000',
      'http://laptop.local:3000',
    ]) {
      expect(parseOriginUrl('X', url, 'development'), url).toBe(url);
    }
    expect(() => parseOriginUrl('X', 'http://api.example.com', 'development')).toThrow();
    expect(() => parseOriginUrl('X', 'http://172.40.1.5', 'development')).toThrow();
  });

  it('rejects missing values, queries and credentials', () => {
    expect(() => parseOriginUrl('X', '', 'development')).toThrow('X is required');
    expect(() => parseOriginUrl('X', 'not a url', 'development')).toThrow('must be a URL');
    expect(() => parseOriginUrl('X', 'https://a.example.com?x=1', 'production')).toThrow();
    expect(() => parseOriginUrl('X', 'https://u:p@a.example.com', 'production')).toThrow();
  });
});

describe('runtimeConfigFromEnv', () => {
  it('defaults to a development build against the local API', () => {
    expect(runtimeConfigFromEnv({}, 'sportperformance-dev')).toEqual({
      variant: 'development',
      apiBaseUrl: 'http://localhost:3000',
      webAppUrl: null,
      scheme: 'sportperformance-dev',
      sentry: null,
    });
  });

  it('fails a release build without its API or web', () => {
    expect(() => runtimeConfigFromEnv({ APP_VARIANT: 'staging' }, 's')).toThrow(
      'API_BASE_URL is required',
    );
    expect(() =>
      runtimeConfigFromEnv(
        { APP_VARIANT: 'production', API_BASE_URL: 'https://a.example.com' },
        's',
      ),
    ).toThrow('WEB_APP_URL is required');
  });

  it('rejects an unknown variant and a malformed Sentry config', () => {
    expect(() => runtimeConfigFromEnv({ APP_VARIANT: 'prod' }, 's')).toThrow('APP_VARIANT');
    expect(() => runtimeConfigFromEnv({ SENTRY_DSN: 'http://k@sentry.io/1' }, 's')).toThrow(
      'SENTRY_DSN',
    );
    expect(() =>
      runtimeConfigFromEnv(
        { SENTRY_DSN: 'https://k@sentry.io/1', SENTRY_TRACES_SAMPLE_RATE: '2' },
        's',
      ),
    ).toThrow('SENTRY_TRACES_SAMPLE_RATE');
  });

  it('round-trips through expo.extra', () => {
    const config = runtimeConfigFromEnv(productionEnv, 'sportperformance');
    expect(parseRuntimeConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(config.sentry).toEqual({ dsn: productionEnv.SENTRY_DSN, tracesSampleRate: 0.1 });
  });

  it('rejects a missing or tampered extra', () => {
    expect(() => parseRuntimeConfig(undefined)).toThrow('expo.extra.app is missing');
    const config = runtimeConfigFromEnv(productionEnv, 'sportperformance');
    expect(() =>
      parseRuntimeConfig({ ...config, apiBaseUrl: 'http://evil.example.com' }),
    ).toThrow();
    expect(() => parseRuntimeConfig({ ...config, scheme: 'Bad Scheme' })).toThrow('scheme');
  });
});

describe('buildExpoConfig', () => {
  it('builds the production app: ids, scheme, version policy and update channel', () => {
    const config = buildExpoConfig(productionEnv);
    expect(config).toMatchObject({
      name: 'Sport Performance',
      slug: 'sport-performance',
      scheme: 'sportperformance',
      version: NATIVE_APP_VERSION,
      runtimeVersion: { policy: 'appVersion' },
      ios: { bundleIdentifier: 'com.sportperformance.app' },
      android: { package: 'com.sportperformance.app', allowBackup: false },
      updates: {
        url: `https://u.expo.dev/${PROJECT_ID}`,
        requestHeaders: { 'expo-channel-name': 'production' },
        checkAutomatically: 'ON_LOAD',
        fallbackToCacheTimeout: 0,
      },
    });
    const extra = config.extra as AppExtra;
    expect(extra.eas).toEqual({ projectId: PROJECT_ID });
    expect(extra.app.apiBaseUrl).toBe('https://api.sport.example.com');
  });

  it('opens invitation and player-access links of the web (Universal Links, App Links)', () => {
    const config = buildExpoConfig(productionEnv);
    expect(config.ios?.associatedDomains).toEqual(['applinks:app.sport.example.com']);
    expect(config.android?.intentFilters).toEqual([
      {
        action: 'VIEW',
        autoVerify: true,
        category: ['BROWSABLE', 'DEFAULT'],
        data: APP_LINK_PATH_PREFIXES.map((pathPrefix) => ({
          scheme: 'https',
          host: 'app.sport.example.com',
          pathPrefix,
        })),
      },
    ]);
  });

  it('builds a development client without EAS project, links or Sentry upload', () => {
    const config = buildExpoConfig({});
    expect(config.scheme).toBe('sportperformance-dev');
    expect(config.ios?.bundleIdentifier).toBe('com.sportperformance.app.dev');
    expect(config.ios?.associatedDomains).toBeUndefined();
    expect(config.android?.intentFilters).toBeUndefined();
    expect(config.updates?.url).toBeUndefined();
    expect((config.extra as AppExtra).eas).toBeUndefined();
    expect(config.plugins).toContainEqual(['@sentry/react-native', { disableAutoUpload: true }]);
  });

  it('plays the 30-15 IFT signals in the background, never with the microphone', () => {
    const config = buildExpoConfig(productionEnv);
    expect(config.plugins).toContainEqual([
      'expo-audio',
      { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: true },
    ]);
  });

  it('turns the Sentry source map upload on with org and project', () => {
    const config = buildExpoConfig({ ...productionEnv, SENTRY_ORG: 'org', SENTRY_PROJECT: 'app' });
    expect(config.plugins).toContainEqual([
      '@sentry/react-native',
      { organization: 'org', project: 'app', disableAutoUpload: false },
    ]);
  });

  it('receives remote pushes with the APNs environment of the variant (B-510)', () => {
    expect(buildExpoConfig(productionEnv).plugins).toContainEqual([
      'expo-notifications',
      { mode: 'production', defaultChannel: 'default', enableBackgroundRemoteNotifications: false },
    ]);
    expect(buildExpoConfig({}).plugins).toContainEqual([
      'expo-notifications',
      {
        mode: 'development',
        defaultChannel: 'default',
        enableBackgroundRemoteNotifications: false,
      },
    ]);
  });

  it('encrypts the local database and registers the background sync (ADR 0069)', () => {
    const config = buildExpoConfig(productionEnv);
    expect(config.plugins).toContainEqual(['expo-sqlite', { useSQLCipher: true }]);
    expect(config.plugins).toContain('expo-background-task');
    // Health data of minors never goes to a cloud backup.
    expect(config.android?.allowBackup).toBe(false);
  });

  it('rejects a malformed EAS project id', () => {
    expect(() => buildExpoConfig({ ...productionEnv, EAS_PROJECT_ID: 'my-project' })).toThrow(
      'EAS_PROJECT_ID',
    );
  });

  it('never ships a secret in the config', () => {
    const json = JSON.stringify(
      buildExpoConfig({ ...productionEnv, SENTRY_AUTH_TOKEN: 'sntrys_x' }),
    );
    expect(json).not.toContain('sntrys_x');
  });
});
