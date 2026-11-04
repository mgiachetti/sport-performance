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
import type { HardwareInfo } from '../reaction/installation.ts';
import type { Platform } from '../state/services.ts';
import { createNativeSignalPlayer } from './signal-audio.ts';
import { NATIVE_APP_VERSION, parseAppBuildInfo, type AppBuildInfo } from '../version/index.ts';
import { createNativePushDevice } from './push.ts';
import { openNativeLocalDatabase } from './sqlite.ts';
import { nativeSprintVideoFiles } from './sprint-video.tsx';
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

/**
 * The phone as it registers as a measuring device (B-606): phone or tablet,
 * model and system version, from React Native's platform constants (no
 * extra native module).
 */
export function hardwareInfo(): HardwareInfo {
  const constants = ReactNativePlatform.constants as unknown as Record<string, unknown>;
  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  if (ReactNativePlatform.OS === 'ios') {
    const idiom = text(constants.interfaceIdiom);
    const version = text(constants.osVersion);
    return {
      kind: idiom === 'pad' ? 'tablet' : 'phone',
      model: idiom === 'pad' ? 'iPad' : 'iPhone',
      osVersion: version === null ? null : `iOS ${version}`,
    };
  }
  const brand = text(constants.Brand) ?? text(constants.Manufacturer);
  const model = text(constants.Model);
  const release = text(constants.Release);
  const named =
    model === null
      ? brand
      : brand === null || model.toLowerCase().startsWith(brand.toLowerCase())
        ? model
        : `${brand} ${model}`;
  return {
    // Android does not tell a tablet apart without another module: the staff names it.
    kind: 'phone',
    model: named,
    osVersion: release === null ? null : `Android ${release}`,
  };
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
    createSignalPlayer: createNativeSignalPlayer,
    hardware: hardwareInfo(),
    createPushDevice: createNativePushDevice,
    sprintVideoFiles: nativeSprintVideoFiles,
  };
}
