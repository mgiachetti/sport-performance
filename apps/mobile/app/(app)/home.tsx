import { HomeScreen } from '../../src/screens/app.tsx';
import { useClubTheme, useSession } from '../../src/state/app-context.tsx';

export default function Home() {
  const state = useSession();
  const clubTheme = useClubTheme();
  if (state.status !== 'signedIn' || state.activeMembership === null) return null;
  return (
    <HomeScreen
      userName={state.user.name}
      membership={state.activeMembership}
      clubTheme={clubTheme}
      offline={state.offline}
    />
  );
}
