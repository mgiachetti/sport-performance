import { useKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { BackHandler } from 'react-native';
import { SyncIndicator } from '../src/screens/sync.tsx';
import {
  useKiosk,
  useNow,
  useServices,
  useSession,
  useSyncStatus,
} from '../src/state/app-context.tsx';
import { KioskMode } from '../src/state/kiosk-screens.tsx';

/**
 * The kiosk (B-504, ADR 0086): the only route while the device is the
 * club's kiosk. No tabs, no way back (the root layout guards every other
 * route, the Android back button does nothing here and the iOS gesture is
 * off), and the screen stays on.
 */
export default function KioskRoute() {
  const services = useServices();
  const kiosk = useKiosk();
  const session = useSession();
  const syncStatus = useSyncStatus();
  const now = useNow();
  useKeepAwake();
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => {
      subscription.remove();
    };
  }, []);
  if (kiosk.status !== 'on') return null;
  return (
    <KioskMode
      // Another kiosk (other categories) starts from nothing.
      key={`${kiosk.config.scope.membershipId}:${String(kiosk.config.startedAtMs)}`}
      config={kiosk.config}
      sync={
        <SyncIndicator
          status={syncStatus}
          offline={session.status === 'signedIn' && session.offline}
          nowMs={now}
          onSyncNow={() => {
            services.sync.requestSync({ force: true });
          }}
        />
      }
    />
  );
}
