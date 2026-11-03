// Metro config (ADR 0058). Expo's default config already handles the pnpm
// monorepo (watch folders and the workspace root's node_modules); Sentry wraps
// it to add debug ids to the bundle, so uploaded source maps match the release.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname);

module.exports = config;
