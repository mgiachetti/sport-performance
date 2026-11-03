import * as Network from 'expo-network';
import { AppState } from 'react-native';
import type { SyncTriggerSources } from '../offline/triggers.ts';

/** Whether a network state is usable: connected, and not known to be without internet. */
function usable(state: Network.NetworkState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

/** The app state and the network of the phone, as the sync triggers read them (ADR 0065). */
export const nativeSyncTriggerSources: SyncTriggerSources = {
  onAppActive(listener) {
    const subscription = AppState.addEventListener('change', (state) => {
      listener(state === 'active');
    });
    return () => {
      subscription.remove();
    };
  },
  onConnectivity(listener) {
    let active = true;
    void Network.getNetworkStateAsync()
      .then((state) => {
        if (active) listener(usable(state));
      })
      .catch(() => undefined);
    const subscription = Network.addNetworkStateListener((state) => {
      listener(usable(state));
    });
    return () => {
      active = false;
      subscription.remove();
    };
  },
  setInterval: (task, ms) => setInterval(task, ms),
  clearInterval: (handle) => {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};
