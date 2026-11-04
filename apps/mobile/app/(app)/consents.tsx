import { router } from 'expo-router';
import { useSession } from '../../src/state/app-context.tsx';
import { PlayerConsents } from '../../src/state/player-screens.tsx';

/** The player's consents (B-503), opened from Cuenta. */
export default function Consents() {
  const state = useSession();
  if (state.status !== 'signedIn' || state.activeMembership?.role !== 'player') return null;
  return (
    <PlayerConsents
      onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/account');
      }}
    />
  );
}
