import { ApiError, type AppCompatibility, type EndpointInput } from '@sport-performance/contracts';
import type { getAppCompatibility } from '@sport-performance/contracts';
import {
  evaluateAppCompatibility,
  isAppVersion,
  parseAppVersionPolicy,
  type ParsedAppVersionPolicy,
} from '@sport-performance/domain';
import { parseAppBuildInfo, type AppBuildInfo } from './client-headers.ts';

/**
 * What the app does about its own version (B-324, ADR 0045):
 * - `ok`: nothing to do. Also when the version was never checked and the
 *   server cannot be reached: without a known policy the app just works.
 * - `update_available`: a newer version is in the store: dismissible notice.
 * - `update_required`: the server confirmed that the API no longer serves
 *   this binary: the blocking "actualizá la app" screen with the store button.
 * - `update_required_offline`: the last policy seen (or the last `426`
 *   received) says this binary is no longer served, but the server could
 *   not be reached now: the app keeps working locally, sync pauses and a
 *   notice explains why. The staff loads a whole test day without signal
 *   (product principle 5).
 */
export type UpdateGate =
  | { readonly kind: 'ok' }
  | {
      readonly kind: 'update_available';
      readonly latestVersion: string;
      readonly storeUrl: string | null;
      /** The user chose "Más tarde" for this latest version. */
      readonly dismissed: boolean;
    }
  | {
      readonly kind: 'update_required' | 'update_required_offline';
      /** `null` when a `426` arrived and the policy could not be read. */
      readonly minVersion: string | null;
      readonly storeUrl: string | null;
    };

/** The blocking screen: only when the server confirmed it. */
export function blocksApp(gate: UpdateGate): boolean {
  return gate.kind === 'update_required';
}

/**
 * Sync pauses while the version is not supported: the API would answer
 * `426` to every push. The queue stays in SQLite and goes out after the update.
 */
export function pausesSync(gate: UpdateGate): boolean {
  return gate.kind === 'update_required' || gate.kind === 'update_required_offline';
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
/**
 * The native version a `426 app_update_required` was received for. It keeps
 * sync paused offline even when the cached policy is older than the `426`
 * (a stale cache, replicas mid-rollout of a new minimum); a successful check
 * that says the version is served clears it, and an updated binary no
 * longer matches it.
 */
export const BLOCKED_STORAGE_KEY = 'app_version.blocked_version';

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
   * For the error of any API call: on `426 app_update_required` it remembers
   * the block on the device, re-reads the policy and returns the gate
   * (always `update_required`); `null` for any other error.
   */
  handleApiError(error: unknown): Promise<UpdateGate | null>;
  /** "Más tarde" on the notice of a newer version: hidden until a newer one comes out. */
  dismissUpdateNotice(latestVersion: string): Promise<void>;
}

interface ReadPolicy {
  readonly policy: CachedPolicy;
  readonly parsed: ParsedAppVersionPolicy;
}

/** The cached policy, or `null` when missing or corrupt (then it is ignored). */
function parseCachedPolicy(raw: string | null): ReadPolicy | null {
  if (raw === null || raw === '') return null;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof CachedPolicy, unknown>>;
    const { minVersion, latestVersion, storeUrl, checkedAt } = value;
    if (!isAppVersion(minVersion)) return null;
    if (latestVersion !== null && !isAppVersion(latestVersion)) return null;
    if (storeUrl !== null && (typeof storeUrl !== 'string' || !storeUrl.startsWith('https://'))) {
      return null;
    }
    if (typeof checkedAt !== 'string') return null;
    const policy = { minVersion, latestVersion, storeUrl, checkedAt };
    // Throws (caught below) when the latest version is older than the minimum.
    return { policy, parsed: parseAppVersionPolicy(policy) };
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
        kind: offline ? 'update_required_offline' : 'update_required',
        minVersion: policy.minVersion,
        storeUrl: policy.storeUrl,
      };
    case 'update_available':
      return policy.latestVersion === null
        ? { kind: 'ok' }
        : {
            kind: 'update_available',
            latestVersion: policy.latestVersion,
            storeUrl: policy.storeUrl,
            dismissed: dismissed === policy.latestVersion,
          };
    case 'supported':
      return { kind: 'ok' };
  }
}

/**
 * Checks the version of the app against the API and keeps the last policy
 * on the device. Never blocks on its own failures: an unreachable server,
 * a `5xx`, an answer off the contract or a failing device storage fall back
 * to the cached policy (`update_required_offline`) or to `ok`.
 */
export function createCompatibilityChecker(
  options: CompatibilityCheckerOptions,
): CompatibilityChecker {
  const build = parseAppBuildInfo(options.build);
  const now = options.now ?? (() => new Date());
  const { storage } = options;

  // The device storage is best effort here: a failure reads as "nothing stored"
  // and a lost write only costs deciding from the server next time.
  async function read(key: string): Promise<string | null> {
    try {
      return await storage.get(key);
    } catch {
      return null;
    }
  }
  async function write(key: string, value: string): Promise<void> {
    try {
      await storage.set(key, value);
    } catch {
      // Ignored: see above.
    }
  }

  async function fromCache(): Promise<UpdateGate> {
    const cached = parseCachedPolicy(await read(POLICY_STORAGE_KEY));
    const blocked = (await read(BLOCKED_STORAGE_KEY)) === build.nativeVersion;
    if (cached === null) {
      return blocked
        ? { kind: 'update_required_offline', minVersion: null, storeUrl: null }
        : { kind: 'ok' };
    }
    const status = evaluateAppCompatibility(cached.parsed, build.nativeVersion);
    if (status === 'update_required' || blocked) {
      return {
        kind: 'update_required_offline',
        // A remembered `426` above the cached minimum: the new minimum is unknown.
        minVersion: status === 'update_required' ? cached.policy.minVersion : null,
        storeUrl: cached.policy.storeUrl,
      };
    }
    return gateOf(status, cached.policy, await read(DISMISSED_STORAGE_KEY), true);
  }

  async function check(): Promise<UpdateGate> {
    let answer: AppCompatibility;
    try {
      answer = await options.getAppCompatibility({
        query: {
          platform: build.platform,
          version: build.nativeVersion,
          ...(build.runtimeVersion !== null && { runtimeVersion: build.runtimeVersion }),
        },
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
    await write(POLICY_STORAGE_KEY, JSON.stringify(policy));
    // The server answered: its decision replaces a remembered `426`.
    await write(
      BLOCKED_STORAGE_KEY,
      answer.status === 'update_required' ? build.nativeVersion : '',
    );
    return gateOf(answer.status, policy, await read(DISMISSED_STORAGE_KEY), false);
  }

  return {
    check,
    async handleApiError(error) {
      if (!isAppUpdateRequired(error)) return null;
      const gate = await check();
      // After `check()`, which may have cleared it: the API just said `426`.
      await write(BLOCKED_STORAGE_KEY, build.nativeVersion);
      if (gate.kind === 'update_required' || gate.kind === 'update_required_offline') {
        return { ...gate, kind: 'update_required' };
      }
      // The `426` wins over a policy that could not be read or is stale.
      const cached = parseCachedPolicy(await read(POLICY_STORAGE_KEY));
      return {
        kind: 'update_required',
        minVersion: null,
        storeUrl: cached?.policy.storeUrl ?? null,
      };
    },
    async dismissUpdateNotice(latestVersion) {
      await storage.set(DISMISSED_STORAGE_KEY, latestVersion);
    },
  };
}
