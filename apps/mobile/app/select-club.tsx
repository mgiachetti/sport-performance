import { NoClubScreen, SelectClubScreen } from '../src/screens/clubs.tsx';
import { useServices, useSession } from '../src/state/app-context.tsx';

/** Club selector (ADR 0028): the membership chosen goes in `X-Membership-Id`. */
export default function SelectClub() {
  const services = useServices();
  const state = useSession();
  if (state.status !== 'signedIn') return null;
  if (state.memberships.length === 0) {
    return (
      <NoClubScreen
        offline={state.offline}
        onRetry={() => {
          void services.session.refresh();
        }}
        onSignOut={() => {
          void services.session.signOut();
        }}
      />
    );
  }
  return (
    <SelectClubScreen
      memberships={state.memberships}
      activeMembershipId={state.activeMembership?.id ?? null}
      notice={state.clubNotice}
      onSelect={(membershipId) => {
        services.session.selectMembership(membershipId).catch(services.reportError);
      }}
    />
  );
}
