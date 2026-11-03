import { useState } from 'react';
import { versionLabel } from '../../src/platform/native.ts';
import { AccountScreen } from '../../src/screens/app.tsx';
import { SyncIndicator, SyncIssuesList } from '../../src/screens/sync.tsx';
import {
  useClubTheme,
  useNow,
  useServices,
  useSession,
  useSyncIssues,
  useSyncStatus,
} from '../../src/state/app-context.tsx';

export default function Account() {
  const services = useServices();
  const state = useSession();
  const clubTheme = useClubTheme();
  const syncStatus = useSyncStatus();
  const issues = useSyncIssues();
  const now = useNow();
  const [signingOut, setSigningOut] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
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
      pendingCount={syncStatus.pendingCount}
      confirmSignOut={confirmSignOut}
      sync={
        <>
          <SyncIndicator
            status={syncStatus}
            nowMs={now}
            onSyncNow={() => {
              services.sync.requestSync({ force: true });
            }}
          />
          <SyncIssuesList
            issues={issues}
            onDismiss={(id) => {
              services.sync.dismissIssue(id).catch(services.reportError);
            }}
            onDismissAll={() => {
              services.sync.dismissAllIssues().catch(services.reportError);
            }}
          />
        </>
      }
      onChangeClub={() => {
        services.session.chooseAnotherClub().catch(services.reportError);
      }}
      onSignOut={() => {
        // Changes not sent yet are lost when signing out: the first press warns.
        if (syncStatus.pendingCount > 0 && !confirmSignOut) {
          setConfirmSignOut(true);
          services.sync.requestSync({ force: true });
          return;
        }
        setSigningOut(true);
        void services.session.signOut().finally(() => {
          setSigningOut(false);
          setConfirmSignOut(false);
        });
      }}
    />
  );
}
