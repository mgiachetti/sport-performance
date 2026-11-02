/** Version compatibility of the app (B-324, ADR 0045). */
export {
  NATIVE_APP_VERSION,
  RUNTIME_VERSION_POLICY,
  expoVersionConfig,
  runtimeVersionOf,
  type ExpoVersionConfig,
} from './release.js';
export { appClientHeaders, parseAppBuildInfo, type AppBuildInfo } from './client-headers.js';
export {
  DISMISSED_STORAGE_KEY,
  POLICY_STORAGE_KEY,
  blocksApp,
  createCompatibilityChecker,
  isAppUpdateRequired,
  pausesSync,
  type CachedPolicy,
  type CompatibilityChecker,
  type CompatibilityCheckerOptions,
  type GetAppCompatibility,
  type KeyValueStore,
  type UpdateGate,
} from './compatibility.js';
export { updatePrompt, type UpdatePrompt } from './update-prompt.js';
