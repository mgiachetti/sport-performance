import { ApiError, type AppCompatibility, type EndpointInput } from '@sport-performance/contracts';
import type { getAppCompatibility } from '@sport-performance/contracts';
import { evaluateAppCompatibility, isAppVersion } from '@sport-performance/domain';
import { parseAppBuildInfo, type AppBuildInfo } from './client-headers.js';

/**
 * What the app does about its own version (B-324, ADR 0045):
 * - `unknown`: never checked and the server cannot be reached: the app works.
 * - `supported`: up to date.
 * - `update_available`: a newer version is in the store: dismissible notice.
 * - `update_required`: the API no longer serves this binary. Online
 *   (`offline: false`) the blocking "actualizá la app" screen; when the
 *   server could not be reached (`offline: true`, from the last policy seen)
 *   the app keeps working locally, sync pauses and a notice explains why:
 *   the staff loads a whole test day without signal (product principle 5).
 */
export type UpdateGate =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'supported' }
  | {
      readonly kind: 'update_available';
      readonly latestVersion: string;
      readonly storeUrl: string | null;
      /** The user chose "Más tarde" for this latest version. */
      readonly dismissed: boolean;
    }
  | {
      readonly kind: 'update_required';
      /** `null` when a `426` arrived and the policy could not be read yet. */
      readonly minVersion: string | null;
      readonly storeUrl: string | null;
      readonly offline: boolean;
    };

/** The blocking screen: only when the server confirmed it. */
export function blocksApp(gate: UpdateGate): boolean {
  return gate.kind === 'update_required' && !gate.offline;
}

/**
 * Sync pauses while the version is not supported: the API would answer
 * `426` to every push. The queue stays in SQLite and goes out after the update.
 */
export function pausesSync(gate: UpdateGate): boolean {
  return gate.kind === 'update_required';
}

/** True for the error of any call when this binary is no longer supported. */
export function isAppUpdateRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'app_update_required';
}

/** Key-value store of the device (B-501: SQLite or secure storage). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** The last policy the server answered, kept to decide offline. */
export interface CachedPolicy {
  readonly minVersion: string;
  readonly latestVersion: string | null;
  readonly storeUrl: string | null;
  /** ISO instant of the answer. */
  readonly checkedAt: string;
}

export const POLICY_STORAGE_KEY = 'app_version.policy';
export const DISMISSED_STORAGE_KEY = 'app_version.dismissed_latest';

/** The client call the checker needs (`createApiClient().getAppCompatibility`). */
export type GetAppCompatibility = (
  input: EndpointInput<typeof getAppCompatibility>,
) => Promise<AppCompatibility>;

export interface CompatibilityCheckerOptions {
  readonly build: AppBuildInfo;
  readonly getAppCompatibility: GetAppCompatibility;
  readonly storage: KeyValueStore;
  readonly now?: () => Date;
}

export interface CompatibilityChecker {
  /** At launch and when the app comes back to the foreground. */
  check(): Promise<UpdateGate>;
  /**
   * For the error of any API call: on `426 app_update_required` it re-reads
   * the policy and returns the gate (always `update_required`, online);
   * `null` for any other error.
   */
  handleApiError(error: unknown): Promise<UpdateGate | null>;
  /** "Más tarde" on the notice of a newer version: hidden until a newer one comes out. */
  dismissUpdateNotice(latestVersion: string): Promise<void>;
}

function parseCachedPolicy(raw: string | null): CachedPolicy | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof CachedPolicy, unknown>>;
    const { minVersion, latestVersion, storeUrl, checkedAt } = value;
    if (!isAppVersion(minVersion)) return null;
    if (latestVersion !== null && !isAppVersion(latestVersion)) return null;
    if (storeUrl !== null && (typeof storeUrl !== 'string' || !storeUrl.startsWith('https://'))) {
      return null;
    }
    if (typeof checkedAt !== 'string') return null;
    return { minVersion, latestVersion, storeUrl, checkedAt };
  } catch {
    return null;
  }
}

function gateOf(
  status: AppCompatibility['status'],
  policy: Omit<CachedPolicy, 'checkedAt'>,
  dismissed: string | null,
  offline: boolean,
): UpdateGate {
  switch (status) {
    case 'update_required':
      return {
        kind: 'update_required',
        minVersion: policy.minVersion,
        storeUrl: policy.storeUrl,
        offline,
      };
    case 'update_available':
      return policy.latestVersion === null
        ? { kind: 'supported' }
        : {
            kind: 'update_available',
            latestVersion: policy.latestVersion,
            storeUrl: policy.storeUrl,
            dismissed: dismissed === policy.latestVersion,
          };
    case 'supported':
      return { kind: 'supported' };
  }
}

/**
 * Checks the version of the app against the API and keeps the last policy
 * on the device. Never blocks on its own failures: an unreachable server,
 * a `5xx` or an answer off the contract fall back to the cached policy
 * (`offline: true`) or to `unknown`.
 */
export function createCompatibilityChecker(
  options: CompatibilityCheckerOptions,
): CompatibilityChecker {
  const build = parseAppBuildInfo(options.build);
  const now = options.now ?? (() => new Date());
  const { storage } = options;

  async function fromCache(): Promise<UpdateGate> {
    const cached = parseCachedPolicy(await storage.get(POLICY_STORAGE_KEY));
    if (cached === null) return { kind: 'unknown' };
    let status: AppCompatibility['status'];
    try {
      status = evaluateAppCompatibility(cached, build.nativeVersion);
    } catch {
      return { kind: 'unknown' };
    }
    return gateOf(status, cached, await storage.get(DISMISSED_STORAGE_KEY), true);
  }

  async function check(): Promise<UpdateGate> {
    let answer: AppCompatibility;
    try {
      answer = await options.getAppCompatibility({
        query: { platform: build.platform, version: build.nativeVersion },
      });
    } catch {
      return fromCache();
    }
    const policy: CachedPolicy = {
      minVersion: answer.minVersion,
      latestVersion: answer.latestVersion,
      storeUrl: answer.storeUrl,
      checkedAt: now().toISOString(),
    };
    await storage.set(POLICY_STORAGE_KEY, JSON.stringify(policy));
    return gateOf(answer.status, policy, await storage.get(DISMISSED_STORAGE_KEY), false);
  }

  return {
    check,
    async handleApiError(error) {
      if (!isAppUpdateRequired(error)) return null;
      const gate = await check();
      if (gate.kind === 'update_required') return { ...gate, offline: false };
      // The API just said `426`: it wins over a policy that could not be read or is stale.
      const cached = parseCachedPolicy(await storage.get(POLICY_STORAGE_KEY));
      return {
        kind: 'update_required',
        minVersion: null,
        storeUrl: cached?.storeUrl ?? null,
        offline: false,
      };
    },
    async dismissUpdateNotice(latestVersion) {
      await storage.set(DISMISSED_STORAGE_KEY, latestVersion);
    },
  };
}
