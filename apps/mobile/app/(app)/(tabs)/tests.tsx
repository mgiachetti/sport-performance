import { router } from 'expo-router';
import { useSession } from '../../../src/state/app-context.tsx';
import { PlayerTests } from '../../../src/state/player-screens.tsx';

/** "Mis tests" of the player (B-503): only the `player` role has this tab. */
export default function Tests() {
  const state = useSession();
  if (state.status !== 'signedIn' || state.activeMembership?.role !== 'player') return null;
  return (
    <PlayerTests
      onOpenProtocols={() => {
        router.push('/protocols');
      }}
    />
  );
}
