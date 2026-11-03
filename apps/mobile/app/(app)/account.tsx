import { useState } from 'react';
import { versionLabel } from '../../src/platform/native.ts';
import { AccountScreen } from '../../src/screens/app.tsx';
import { useClubTheme, useServices, useSession } from '../../src/state/app-context.tsx';

export default function Account() {
  const services = useServices();
  const state = useSession();
  const clubTheme = useClubTheme();
  const [signingOut, setSigningOut] = useState(false);
  if (state.status !== 'signedIn' || state.activeMembership === null) return null;
  return (
    <AccountScreen
      email={state.email}
      membership={state.activeMembership}
      clubTheme={clubTheme}
      canChangeClub={state.memberships.length > 1}
      version={versionLabel(services.build)}
      offline={state.offline}
      signingOut={signingOut}
      onChangeClub={() => {
        services.session.chooseAnotherClub().catch(services.reportError);
      }}
      onSignOut={() => {
        setSigningOut(true);
        void services.session.signOut().finally(() => {
          setSigningOut(false);
        });
      }}
    />
  );
}
