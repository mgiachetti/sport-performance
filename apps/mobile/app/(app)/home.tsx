import { router } from 'expo-router';
import { canRunIft3015 } from '../../src/ift/roster.ts';
import { HomeScreen } from '../../src/screens/app.tsx';
import { SyncIndicator } from '../../src/screens/sync.tsx';
import {
  useClubTheme,
  useNow,
  useServices,
  useSession,
  useSyncStatus,
} from '../../src/state/app-context.tsx';
import { PlayerToday } from '../../src/state/player-screens.tsx';

export default function Home() {
  const services = useServices();
  const state = useSession();
  const clubTheme = useClubTheme();
  const syncStatus = useSyncStatus();
  const now = useNow();
  if (state.status !== 'signedIn' || state.activeMembership === null) return null;
  const sync = (
    <SyncIndicator
      status={syncStatus}
      nowMs={now}
      onSyncNow={() => {
        services.sync.requestSync({ force: true });
      }}
    />
  );
  // The player's home is their day (B-503): wellness, RPE, streak and the next test day.
  if (state.activeMembership.role === 'player') return <PlayerToday sync={sync} />;
  return (
    <HomeScreen
      userName={state.user.name}
      membership={state.activeMembership}
      clubTheme={clubTheme}
      // The indicator already says so when the sync got no answer.
      offline={state.offline && syncStatus.phase !== 'offline'}
      sync={sync}
      onOpenIft3015={
        canRunIft3015(state.activeMembership.role)
          ? () => {
              router.push('/ift-3015');
            }
          : null
      }
      onOpenReaction={
        canRunIft3015(state.activeMembership.role)
          ? () => {
              router.push('/reaction');
            }
          : null
      }
    />
  );
}
