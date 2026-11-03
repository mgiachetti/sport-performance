import type { Club, ClubTheme, Me } from '@sport-performance/contracts';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import type { ClubSelection } from '../api/club-selection';
import {
  categoriesQuery,
  clubProfileQuery,
  clubThemeQuery,
  meQuery,
  myAssignmentsQuery,
} from '../api/queries';
import { useServices, useStore } from '../app/services';
import {
  ASSIGNED_ROLES,
  ActiveClubProvider,
  buildActiveClub,
  isStaffRole,
  type StaffRole,
} from '../club/active-club';
import { resolveScope, scopeToSearch } from '../club/scope';
import { ScopeProvider } from '../club/use-scope';
import { StaffOnlyPage } from '../pages/StaffOnlyPage';
import { Loading } from '../ui/components';
import { AppShell } from './AppShell';

const route = getRouteApi('/_authed/_club');

/**
 * Layout of everything inside a club: resolves the `ActiveClub` from the
 * cache the route loader filled, applies the club's brand, resolves the
 * sport/category scope and renders the shell. Players and guardians get the
 * "use the app" page instead.
 */
export function ClubLayout() {
  const { selection } = useServices();
  const current = useStore(selection);
  // Signing out or switching clubs clears the selection right before navigating away.
  if (current === null) return <Loading />;
  return <ClubLayoutFor selection={current} />;
}

function ClubLayoutFor(props: { selection: ClubSelection }) {
  const { api, theme } = useServices();
  const { data: me } = useSuspenseQuery(meQuery(api, props.selection));
  const { data: club } = useSuspenseQuery(clubProfileQuery(api, props.selection));
  const { data: clubTheme } = useSuspenseQuery(clubThemeQuery(api, club.slug));
  const role =
    props.selection.kind === 'support' ? 'superadmin' : (me.activeMembership?.role ?? 'player');

  const { primary, secondary } = clubTheme.colors;
  useEffect(() => {
    theme.setBrand({ primary, secondary });
    return () => {
      theme.setBrand(null);
    };
  }, [theme, primary, secondary]);

  if (!isStaffRole(role)) return <StaffOnlyPage clubName={club.name} role={role} />;
  return (
    <StaffClubLayout
      selection={props.selection}
      role={role}
      me={me}
      club={club}
      clubTheme={clubTheme}
    />
  );
}

function StaffClubLayout(props: {
  selection: ClubSelection;
  role: StaffRole;
  me: Me;
  club: Club;
  clubTheme: ClubTheme;
}) {
  const { api } = useServices();
  const { selection, role, me, club, clubTheme } = props;
  const { data: categories } = useSuspenseQuery(categoriesQuery(api, selection));
  const { data: assignments } = useSuspenseQuery(
    myAssignmentsQuery(api, selection, ASSIGNED_ROLES.includes(role)),
  );
  const active = useMemo(
    () =>
      buildActiveClub({
        selection,
        user: me.user,
        membership: selection.kind === 'membership' ? me.activeMembership : null,
        club,
        theme: clubTheme,
        assignments,
        categories,
      }),
    [selection, me, club, clubTheme, assignments, categories],
  );

  const search = route.useSearch();
  const navigate = route.useNavigate();
  const scope = useMemo(() => resolveScope(categories, search), [categories, search]);
  const canonical = useMemo(() => scopeToSearch(scope), [scope]);
  const outOfDate = canonical.sport !== search.sport || canonical.category !== search.category;
  // A link may ask for a scope this user does not see: say so once, then fix the URL.
  const [ignoredNotice, setIgnoredNotice] = useState(false);
  if (scope.ignored && !ignoredNotice) setIgnoredNotice(true);
  useEffect(() => {
    if (outOfDate) void navigate({ search: () => canonical, replace: true });
  }, [outOfDate, canonical, navigate]);

  return (
    <ActiveClubProvider value={active}>
      <ScopeProvider value={scope}>
        <AppShell
          scopeIgnored={ignoredNotice}
          onDismissScopeIgnored={() => {
            setIgnoredNotice(false);
          }}
        />
      </ScopeProvider>
    </ActiveClubProvider>
  );
}
