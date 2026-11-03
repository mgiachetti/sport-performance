import type { CompatibilityChecker, UpdateGate } from '../version/index.ts';

/**
 * The version gate as a store the UI subscribes to (ADR 0045): checked at
 * launch and when the app comes back to the foreground, and moved to
 * `update_required` by any `426` of the API.
 */
export interface VersionGate {
  readonly getState: () => UpdateGate;
  readonly subscribe: (listener: () => void) => () => void;
  check(): Promise<void>;
  /** For a `426 app_update_required` of any call. */
  handleApiError(error: unknown): Promise<void>;
  dismiss(): Promise<void>;
}

export function createVersionGate(checker: CompatibilityChecker): VersionGate {
  const listeners = new Set<() => void>();
  let state: UpdateGate = { kind: 'ok' };

  function setState(next: UpdateGate): void {
    state = next;
    for (const listener of listeners) listener();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async check() {
      setState(await checker.check());
    },
    async handleApiError(error) {
      const gate = await checker.handleApiError(error);
      if (gate !== null) setState(gate);
    },
    async dismiss() {
      if (state.kind !== 'update_available') return;
      await checker.dismissUpdateNotice(state.latestVersion);
      setState({ ...state, dismissed: true });
    },
  };
}
