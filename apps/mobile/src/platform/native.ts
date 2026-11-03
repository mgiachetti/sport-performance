import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { Platform as ReactNativePlatform } from 'react-native';
import { parseRuntimeConfig, type RuntimeConfig } from '../config/runtime-config.ts';
import type { SentryBuild } from '../observability/sentry-options.ts';
import type { Platform } from '../state/services.ts';
import { NATIVE_APP_VERSION, parseAppBuildInfo, type AppBuildInfo } from '../version/index.ts';
import { openNativeLocalDatabase } from './sqlite.ts';
import type { PreferenceStorage, SecureStorage } from './storage.ts';

/**
 * Keychain items readable after the first unlock (background sync, B-502)
 * and never migrated to another device by a backup: a restored phone signs
 * in again (ADR 0058).
 */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const secureStorage: SecureStorage = {
  getItem: (key) => SecureStore.getItemAsync(key, SECURE_OPTIONS),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, SECURE_OPTIONS),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, SECURE_OPTIONS),
};

const preferences: PreferenceStorage = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
};

export function runtimeConfig(): RuntimeConfig {
  const extra = Constants.expoConfig?.extra as { app?: unknown } | undefined;
  return parseRuntimeConfig(extra?.app);
}

export function buildInfo(): AppBuildInfo {
  const platform = ReactNativePlatform.OS;
  if (platform !== 'ios' && platform !== 'android') {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  return parseAppBuildInfo({
    platform,
    nativeVersion: Application.nativeApplicationVersion ?? NATIVE_APP_VERSION,
    // `null` in development builds, which run without EAS Update.
    runtimeVersion: Updates.isEnabled ? Updates.runtimeVersion : null,
  });
}

export function sentryBuild(build: AppBuildInfo): SentryBuild {
  return {
    appId: Application.applicationId ?? 'unknown',
    nativeVersion: build.nativeVersion,
    buildNumber: Application.nativeBuildVersion,
    updateId: Updates.isEnabled && !Updates.isEmbeddedLaunch ? Updates.updateId : null,
  };
}

/** `1.0.0 (12)`, for the account screen and support. */
export function versionLabel(build: AppBuildInfo): string {
  const number = Application.nativeBuildVersion;
  return number === null ? build.nativeVersion : `${build.nativeVersion} (${number})`;
}

/** The device as the app services see it. */
export function nativePlatform(config: RuntimeConfig, build: AppBuildInfo): Platform {
  const reportError = (error: unknown) => {
    if (config.sentry !== null) Sentry.captureException(error);
  };
  return {
    config,
    build,
    secureStorage,
    preferences,
    randomUUID,
    languageTags: getLocales().map((locale) => locale.languageTag),
    reportError,
    openLocalDatabase: () => openNativeLocalDatabase(reportError),
  };
}
