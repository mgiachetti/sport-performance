import { CONTRACT_VERSION } from '@sport-performance/contracts';
import { Store } from '../lib/store';

/**
 * What the web knows about its link to the API (ADR 0056):
 *
 * - `browserOnline`: `navigator.onLine` and its `online`/`offline` events.
 * - `apiReachable`: `false` after a request got no response (network, DNS,
 *   CORS) until the next one that does; the shell probes `/v1/health` meanwhile.
 * - `lastResponseAt`: epoch ms of the last answer from the API (any status).
 * - `serverContractVersion`: `X-Api-Version` of the last answer.
 */
export interface ConnectionState {
  readonly browserOnline: boolean;
  readonly apiReachable: boolean;
  readonly lastResponseAt: number | null;
  readonly serverContractVersion: string | null;
}

export type ConnectionStatus = 'online' | 'offline' | 'unreachable';

export function connectionStatus(state: ConnectionState): ConnectionStatus {
  if (!state.browserOnline) return 'offline';
  return state.apiReachable ? 'online' : 'unreachable';
}

/** Whether requests can go out: TanStack Query pauses queries and mutations otherwise. */
export function isConnected(state: ConnectionState): boolean {
  return connectionStatus(state) === 'online';
}

function majorMinor(version: string): string | null {
  const match = /^(\d+)\.(\d+)\.\d+/.exec(version.trim());
  return match === null ? null : `${match[1] ?? ''}.${match[2] ?? ''}`;
}

/**
 * A tab built against another contract than the API it talks to (ADR 0045
 * left it to B-401): the web is deployed with the API, so a different major
 * or minor means a new build is out (or was rolled back) and the tab must
 * reload. Patch versions do not change the contract's shape.
 */
export function isWebOutdated(
  serverVersion: string | null,
  buildVersion: string = CONTRACT_VERSION,
): boolean {
  if (serverVersion === null) return false;
  const server = majorMinor(serverVersion);
  return server !== null && server !== majorMinor(buildVersion);
}

export class ConnectionStore extends Store<ConnectionState> {
  readonly #now: () => number;

  constructor(options: { browserOnline: boolean; now?: () => number }) {
    super({
      browserOnline: options.browserOnline,
      apiReachable: true,
      lastResponseAt: null,
      serverContractVersion: null,
    });
    this.#now = options.now ?? Date.now;
  }

  setBrowserOnline(browserOnline: boolean): void {
    if (this.get().browserOnline !== browserOnline) this.set({ ...this.get(), browserOnline });
  }

  /** The API answered (any status): it is reachable. */
  reportResponse(contractVersion: string | null): void {
    const current = this.get();
    this.set({
      ...current,
      apiReachable: true,
      lastResponseAt: this.#now(),
      serverContractVersion: contractVersion ?? current.serverContractVersion,
    });
  }

  /** A request got no response (and was not aborted by the app). */
  reportNetworkFailure(): void {
    if (this.get().apiReachable) this.set({ ...this.get(), apiReachable: false });
  }

  /** Follows the browser's `online`/`offline` events; returns the cleanup. */
  attach(target: Window): () => void {
    const update = () => {
      this.setBrowserOnline(target.navigator.onLine);
    };
    target.addEventListener('online', update);
    target.addEventListener('offline', update);
    return () => {
      target.removeEventListener('online', update);
      target.removeEventListener('offline', update);
    };
  }
}
