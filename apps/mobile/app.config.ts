import type { ExpoConfig } from 'expo/config';
import { buildExpoConfig } from './src/config/expo-config.ts';

/**
 * Expo config of the app (ADR 0058). Everything is derived from the build
 * environment by `buildExpoConfig` (tested in `src/config`): `APP_VARIANT`,
 * `API_BASE_URL`, `WEB_APP_URL`, `EAS_PROJECT_ID`, `SENTRY_*`. EAS Build sets
 * them per profile in `eas.json`; locally they come from `.env` (see
 * `.env.example`).
 */
export default (): ExpoConfig => buildExpoConfig(process.env);
