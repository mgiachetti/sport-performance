import { router } from 'expo-router';
import { canOpenKiosk } from '../../src/kiosk/roster.ts';
import { useSession } from '../../src/state/app-context.tsx';
import { KioskSetup } from '../../src/state/kiosk-screens.tsx';

/** The staff opens the kiosk here (B-504), from Inicio. */
export default function KioskSetupRoute() {
  const state = useSession();
  if (state.status !== 'signedIn' || state.activeMembership === null) return null;
  if (!canOpenKiosk(state.activeMembership.role)) return null;
  return (
    <KioskSetup
      onCancel={() => {
        router.back();
      }}
    />
  );
}
