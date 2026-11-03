import type { ExpoConfig } from 'expo/config';
import { orcPalette } from '@sport-performance/ui-tokens';
import { expoVersionConfig } from '../version/release.ts';
import {
  parseVariant,
  runtimeConfigFromEnv,
  type BuildEnv,
  type RuntimeConfig,
} from './runtime-config.ts';
import { variantIdentity } from './variants.ts';

/** Paths the web serves for links that must open the app (ADR 0028, ADR 0042). */
export const APP_LINK_PATH_PREFIXES = ['/invite', '/player-access'] as const;

/** Slug of the EAS project (one project for every variant: they differ by channel). */
export const EAS_SLUG = 'sport-performance';

const EAS_PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `expo.extra.app`: read back at runtime with `parseRuntimeConfig`. */
export interface AppExtra {
  readonly app: RuntimeConfig;
  readonly eas?: { readonly projectId: string };
}

/**
 * The whole Expo config of the app, from the build environment (ADR 0058).
 * `app.config.ts` only calls this; keeping it a pure function lets the tests
 * pin what each variant ships (ids, scheme, links, update channel, plugins).
 */
export function buildExpoConfig(env: BuildEnv): ExpoConfig {
  const identity = variantIdentity(parseVariant(env.APP_VARIANT));
  const runtime = runtimeConfigFromEnv(env, identity.scheme);
  const projectId = env.EAS_PROJECT_ID?.trim() ?? '';
  if (projectId !== '' && !EAS_PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('EAS_PROJECT_ID must be the UUID of the EAS project');
  }
  const webHost = runtime.webAppUrl === null ? null : new URL(runtime.webAppUrl).host;
  const background = orcPalette.background;

  const extra: AppExtra = {
    app: runtime,
    ...(projectId !== '' && { eas: { projectId } }),
  };

  return {
    name: identity.name,
    slug: EAS_SLUG,
    scheme: identity.scheme,
    ...expoVersionConfig(),
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    backgroundColor: background,
    platforms: ['ios', 'android'],
    ios: {
      bundleIdentifier: identity.appId,
      supportsTablet: true,
      ...(webHost !== null && { associatedDomains: [`applinks:${webHost}`] }),
      config: { usesNonExemptEncryption: false },
      infoPlist: {
        // No tracking. The background modes are added by the plugins: `processing`
        // (`expo-background-task`, for the offline sync) and `audio` (`expo-audio`:
        // the 30-15 IFT signals go on with the app in the background).
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: identity.appId,
      // Health data of minors: never in Google Drive backups (ADR 0008).
      allowBackup: false,
      softwareKeyboardLayoutMode: 'resize',
      ...(webHost !== null && {
        intentFilters: [
          {
            action: 'VIEW',
            autoVerify: true,
            data: APP_LINK_PATH_PREFIXES.map((pathPrefix) => ({
              scheme: 'https',
              host: webHost,
              pathPrefix,
            })),
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ],
      }),
    },
    updates: {
      enabled: true,
      // Download in the background at launch; the next cold start applies it.
      // Never wait for the network: the staff opens the app on a field without signal.
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      ...(projectId !== '' && {
        url: `https://u.expo.dev/${projectId}`,
        requestHeaders: { 'expo-channel-name': identity.updateChannel },
      }),
    },
    experiments: { typedRoutes: false },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-localization',
      // The local database is encrypted with SQLCipher; its key lives in the secure storage (ADR 0069).
      ['expo-sqlite', { useSQLCipher: true }],
      'expo-background-task',
      [
        // 30-15 IFT signals (B-507, ADR 0070): playback in the background
        // (`UIBackgroundModes: audio`, the media playback service on Android)
        // and never the microphone.
        'expo-audio',
        { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: true },
      ],
      [
        'expo-splash-screen',
        { backgroundColor: background, resizeMode: 'contain', imageWidth: 160 },
      ],
      [
        '@sentry/react-native',
        {
          // Source maps are uploaded by EAS Build with `SENTRY_AUTH_TOKEN` (an
          // EAS secret, never in the repo); without org/project the upload is off.
          ...(env.SENTRY_ORG !== undefined &&
            env.SENTRY_ORG !== '' && { organization: env.SENTRY_ORG }),
          ...(env.SENTRY_PROJECT !== undefined &&
            env.SENTRY_PROJECT !== '' && { project: env.SENTRY_PROJECT }),
          disableAutoUpload:
            env.SENTRY_ORG === undefined ||
            env.SENTRY_ORG === '' ||
            env.SENTRY_PROJECT === undefined ||
            env.SENTRY_PROJECT === '',
        },
      ],
    ],
    extra,
  };
}
