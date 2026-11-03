/** Version compatibility of the app (B-324, ADR 0045). */
export {
  NATIVE_APP_VERSION,
  RUNTIME_VERSION_POLICY,
  expoVersionConfig,
  runtimeVersionOf,
  type ExpoVersionConfig,
} from './release.ts';
export { appClientHeaders, parseAppBuildInfo, type AppBuildInfo } from './client-headers.ts';
export {
  BLOCKED_STORAGE_KEY,
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
} from './compatibility.ts';
export { updatePrompt, type UpdatePrompt } from './update-prompt.ts';
