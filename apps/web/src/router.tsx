import { isUuid, type ClubId } from '@sport-performance/domain';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  redirect,
  retainSearchParams,
  type RouterHistory,
} from '@tanstack/react-router';
import { AdminGuard, AdminIndex, AdminLayout } from './admin/AdminLayout';
import { AssignmentsSection } from './admin/AssignmentsSection';
import { CategoriesSection } from './admin/CategoriesSection';
import { ClubSection } from './admin/ClubSection';
import { InvitationsSection } from './admin/InvitationsSection';
import { MembersSection } from './admin/MembersSection';
import { RosterImportSection } from './admin/RosterImportSection';
import { SeasonRolloverPage } from './admin/SeasonRolloverPage';
import { SeasonsSection } from './admin/SeasonsSection';
import { isSessionExpired } from './api/errors';
import { ensureQuery, meQuery } from './api/queries';
import { CalendarPage } from './calendar/CalendarPage';
import { parseCalendarSearch } from './calendar/model';
import type { AppServices } from './app/services';
import { FieldSessionPage } from './field-sessions/FieldSessionPage';
import { GymProgramPage, NewGymProgramPage } from './gym/GymProgramPage';
import { GymProgramsPage } from './gym/GymProgramsPage';
import { MenstrualCyclePage } from './menstrual-cycle/MenstrualCyclePage';
import { FieldSessionsPage } from './field-sessions/FieldSessionsPage';
import { parseFieldSessionsSearch } from './field-sessions/search';
import { ConfigurationPage } from './configuration/ConfigurationPage';
import { parseConfigurationSearch } from './configuration/search';
import { ensureAreaOfRole, ensureClubSelection, loadActiveClub } from './club/load';
import { parseScopeSearch } from './club/scope';
import { ChildPage } from './guardian/ChildPage';
import { ChildrenPage } from './guardian/ChildrenPage';
import { ConsoleClubPage } from './console/ConsoleClubPage';
import { ConsoleClubsPage } from './console/ConsoleClubsPage';
import { ConsoleLayout } from './console/ConsoleLayout';
import {
  ConsoleSupportAccessPage,
  parseSupportAccessSearch,
} from './console/ConsoleSupportAccessPage';
import { NewClubPage } from './console/NewClubPage';
import { ClubLayout } from './layout/ClubLayout';
import { RootLayout } from './layout/RootLayout';
import { AnthropometryPage } from './pages/anthropometry/AnthropometryPage';
import { ClubSelectPage } from './pages/ClubSelectPage';
import { RouteErrorPage, NotFoundPage } from './pages/ErrorPages';
import { HomePage } from './pages/HomePage';
import { GuidePage } from './pages/help/GuidePage';
import { ProtocolPage } from './pages/help/ProtocolPage';
import { ProtocolsPage } from './pages/help/ProtocolsPage';
import { LoginPage } from './pages/LoginPage';
import { PanelPage } from './pages/panel/PanelPage';
import { parsePanelSearch } from './pages/panel/panel-search';
import { parsePlayerProfileSearch } from './pages/players/profile-tabs';
import { PlayerProfilePage } from './pages/players/PlayerProfilePage';
import { PlayersPage } from './pages/players/PlayersPage';
import { SupportPage } from './pages/SupportPage';
import { parseClubsSearch, parseLoginSearch, safeRedirect } from './routing/redirect';
import { NewSessionPage } from './training/NewSessionPage';
import { parseSessionsSearch } from './training/search';
import { SessionDetailPage } from './training/SessionDetailPage';
import { SessionsPage } from './training/SessionsPage';
import { ClubSupportAccessPage } from './support-access/ClubSupportAccessPage';
import { UsagePage } from './usage/UsagePage';
import { TestDayPage } from './test-day/TestDayPage';
import { TestDaysPage } from './test-day/TestDaysPage';
import { parseTestDaySearch, testDaySheetQuery } from './test-day/queries';
import { Loading } from './ui/components';

/** What every route's `beforeLoad` and `loader` receive (ADR 0057). */
export interface RouterContext {
  readonly services: AppServices;
}

/**
 * Route tree (code-based, ADR 0057):
 *
 * ```
 * __root__                    theme, banners, 404 and error boundary
 * ├── /login                  sign-in by email code
 * └── _authed                 needs a session (GET /v1/me), else /login?redirect=
 *     ├── /clubs              club selector (memberships, support mode entry)
 *     ├── /support            superadmin: reason + club of the registry
 *     ├── /console            superadmin console (ADR 0066): reason, then
 *     │   ├── /clubs          registry of clubs; /clubs/new onboarding
 *     │   ├── /clubs/$clubId  one club: branches, modules, its admin
 *     │   └── /support-access the support access log
 *     └── _club               needs a club: ActiveClub, layout, ?sport&category
 *         ├── /               home of the club
 *         ├── /panel          weekly panel (?week&group)
 *         ├── /players        roster of what the user sees (B-404)
 *         ├── /players/$id    profile of a player (B-404)
 *         ├── /sessions       training sessions and matches (B-407): list, new, one
 *         ├── /field-sessions sessions with field data (?kind) and /$trainingSessionId (B-408)
 *         ├── /menstrual-cycle cycles players shared with the medical or S&C member (B-806)
 *         ├── /calendar       season calendar (B-406): windows, test days, fixture
 *         ├── /test-days      test days of what the user sees (B-405)
 *         ├── /test-days/$id  the sheet of a test day, ?station=
 *         ├── /anthropometry  batch anthropometry with instant maturation (B-412)
 *         ├── /configuration  club configuration (B-409)
 *         ├── /admin          administration (B-411): one child per section
 *         ├── /support-access support accesses to the club (administration)
 *         ├── /usage          usage metrics of the club (administration, B-707)
 *         ├── /help           protocols of the club's tests (B-415)
 *         ├── /help/guide     usage guide for the staff
 *         ├── /help/protocols/$testDefinitionId   one protocol, its images and videos
 *         └── /family         guardians only (ADR 0065): their children
 *             └── $playerId   summarised profile, consents, parents' heights
 * ```
 *
 * A new screen is a child of `_club` (it inherits session, club, theme and
 * scope) plus an entry in `layout/navigation.ts` gated by the permission matrix.
 */
export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorPage,
});

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: parseLoginSearch,
  beforeLoad: async ({ context, search }) => {
    const { api, queryClient, selection } = context.services;
    // Direct call (not through the cache): a 401 here is the expected answer.
    const me = await api.getMe().catch(() => null);
    if (me !== null) {
      queryClient.setQueryData(meQuery(api, selection.get()).queryKey, me);
      throw redirect({ href: search.redirect ?? '/' });
    }
  },
  component: LoginPage,
});

export const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authed',
  beforeLoad: async ({ context, location }) => {
    const { api, queryClient, selection } = context.services;
    try {
      await ensureQuery(queryClient, meQuery(api, selection.get()));
    } catch (error) {
      if (isSessionExpired(error)) {
        throw redirect({
          to: '/login',
          search: {
            ...(safeRedirect(location.href) === undefined ? {} : { redirect: location.href }),
          },
        });
      }
      throw error;
    }
  },
});

export const clubsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/clubs',
  validateSearch: parseClubsSearch,
  component: ClubSelectPage,
});

export const supportRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/support',
  validateSearch: parseClubsSearch,
  beforeLoad: async ({ context }) => {
    const { api, queryClient, selection } = context.services;
    const me = await ensureQuery(queryClient, meQuery(api, selection.get()));
    if (!me.user.isSuperadmin) throw redirect({ to: '/clubs' });
  },
  component: SupportPage,
});

/** The superadmin console (B-414, ADR 0066): only for a superadmin, outside any club. */
export const consoleRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/console',
  beforeLoad: async ({ context }) => {
    const { api, queryClient, selection } = context.services;
    const me = await ensureQuery(queryClient, meQuery(api, selection.get()));
    if (!me.user.isSuperadmin) throw redirect({ to: '/clubs' });
  },
  component: ConsoleLayout,
});

export const consoleIndexRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/console/clubs', replace: true });
  },
});

export const consoleClubsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/clubs',
  component: ConsoleClubsPage,
});

export const consoleNewClubRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/clubs/new',
  component: NewClubPage,
});

export const consoleClubRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/clubs/$clubId',
  params: {
    parse: (raw: { clubId: string }): { clubId: ClubId } => {
      // `notFound()` is TanStack Router's own signal (not an Error): the 404 page renders.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      if (!isUuid(raw.clubId)) throw notFound();
      return { clubId: raw.clubId as ClubId };
    },
    stringify: (params: { clubId: ClubId }) => ({ clubId: params.clubId }),
  },
  component: ConsoleClubPage,
});

export const consoleSupportAccessRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/support-access',
  validateSearch: parseSupportAccessSearch,
  component: ConsoleSupportAccessPage,
});

export const clubRoute = createRoute({
  getParentRoute: () => authedRoute,
  id: '_club',
  validateSearch: parseScopeSearch,
  search: { middlewares: [retainSearchParams(['sport', 'category'])] },
  beforeLoad: async ({ context, location }) => {
    const clubSelection = await ensureClubSelection(context.services, location.href);
    await ensureAreaOfRole(context.services, clubSelection, location.pathname);
    return { clubSelection };
  },
  loader: ({ context, location }) =>
    loadActiveClub(context.services, context.clubSelection, location.href),
  pendingComponent: () => <Loading />,
  component: ClubLayout,
});

export const homeRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/',
  component: HomePage,
});

export const panelRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/panel',
  validateSearch: parsePanelSearch,
  component: PanelPage,
});

export const playersRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/players',
  component: PlayersPage,
});

export const playerProfileRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/players/$playerId',
  validateSearch: parsePlayerProfileSearch,
  component: function PlayerProfileRoute() {
    const { playerId } = playerProfileRoute.useParams();
    return <PlayerProfilePage playerId={playerId} />;
  },
});

export const sessionsRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/sessions',
});

export const sessionsIndexRoute = createRoute({
  getParentRoute: () => sessionsRoute,
  path: '/',
  validateSearch: parseSessionsSearch,
  component: SessionsPage,
});

export const newSessionRoute = createRoute({
  getParentRoute: () => sessionsRoute,
  path: '/new',
  component: NewSessionPage,
});

export const sessionDetailRoute = createRoute({
  getParentRoute: () => sessionsRoute,
  path: '/$trainingSessionId',
  component: SessionDetailPage,
});

export const fieldSessionsRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/field-sessions',
});

export const fieldSessionsIndexRoute = createRoute({
  getParentRoute: () => fieldSessionsRoute,
  path: '/',
  validateSearch: parseFieldSessionsSearch,
  component: FieldSessionsPage,
});

export const fieldSessionRoute = createRoute({
  getParentRoute: () => fieldSessionsRoute,
  path: '/$trainingSessionId',
  component: FieldSessionPage,
});

export const gymRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/gym',
});

export const gymIndexRoute = createRoute({
  getParentRoute: () => gymRoute,
  path: '/',
  component: GymProgramsPage,
});

export const newGymProgramRoute = createRoute({
  getParentRoute: () => gymRoute,
  path: '/new',
  component: NewGymProgramPage,
});

export const gymProgramRoute = createRoute({
  getParentRoute: () => gymRoute,
  path: '/$gymProgramId',
  component: GymProgramPage,
});

export const menstrualCycleRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/menstrual-cycle',
  component: MenstrualCyclePage,
});

export const calendarRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/calendar',
  validateSearch: parseCalendarSearch,
  component: CalendarPage,
});

export const configurationRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/configuration',
  validateSearch: parseConfigurationSearch,
  component: ConfigurationPage,
});

export const adminRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/admin',
  component: AdminLayout,
});

const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  component: AdminIndex,
});

// Sections of the administration, each guarded by its permissions (`ADMIN_TABS`).
const adminMembersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'members',
  component: () => (
    <AdminGuard to="/admin/members">
      <MembersSection />
    </AdminGuard>
  ),
});

const adminInvitationsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'invitations',
  component: () => (
    <AdminGuard to="/admin/invitations">
      <InvitationsSection />
    </AdminGuard>
  ),
});

const adminAssignmentsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'assignments',
  component: () => (
    <AdminGuard to="/admin/assignments">
      <AssignmentsSection />
    </AdminGuard>
  ),
});

const adminClubRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'club',
  component: () => (
    <AdminGuard to="/admin/club">
      <ClubSection />
    </AdminGuard>
  ),
});

const adminCategoriesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'categories',
  component: () => (
    <AdminGuard to="/admin/categories">
      <CategoriesSection />
    </AdminGuard>
  ),
});

const adminSeasonsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'seasons',
  component: () => (
    <AdminGuard to="/admin/seasons">
      <SeasonsSection />
    </AdminGuard>
  ),
});

const adminRosterRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'roster',
  component: () => (
    <AdminGuard to="/admin/roster">
      <RosterImportSection />
    </AdminGuard>
  ),
});

const adminSeasonRolloverRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'seasons/$seasonId',
  component: () => (
    <AdminGuard to="/admin/seasons">
      <SeasonRolloverPage />
    </AdminGuard>
  ),
});

const adminRoutes = [
  adminIndexRoute,
  adminMembersRoute,
  adminInvitationsRoute,
  adminAssignmentsRoute,
  adminClubRoute,
  adminCategoriesRoute,
  adminSeasonsRoute,
  adminSeasonRolloverRoute,
  adminRosterRoute,
];

export const anthropometryRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/anthropometry',
  component: AnthropometryPage,
});

export const familyRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/family',
});

export const childrenRoute = createRoute({
  getParentRoute: () => familyRoute,
  path: '/',
  component: ChildrenPage,
});

export const childRoute = createRoute({
  getParentRoute: () => familyRoute,
  path: '$playerId',
  component: ChildPage,
});

export const clubSupportAccessRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/support-access',
  component: ClubSupportAccessPage,
});

export const usageRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/usage',
  component: UsagePage,
});

export const helpRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/help',
  component: ProtocolsPage,
});

export const helpGuideRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/help/guide',
  component: GuidePage,
});

export const protocolRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/help/protocols/$testDefinitionId',
  component: ProtocolPage,
});

export const testDaysRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/test-days',
  component: TestDaysPage,
});

export const testDayRoute = createRoute({
  getParentRoute: () => clubRoute,
  path: '/test-days/$testSessionId',
  validateSearch: parseTestDaySearch,
  loader: ({ context, params }) =>
    ensureQuery(
      context.services.queryClient,
      testDaySheetQuery(context.services.api, context.clubSelection, params.testSessionId),
    ),
  pendingComponent: () => <Loading />,
  component: TestDayPage,
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  authedRoute.addChildren([
    clubsRoute,
    supportRoute,
    clubRoute.addChildren([
      homeRoute,
      panelRoute,
      playersRoute,
      playerProfileRoute,
      sessionsRoute.addChildren([sessionsIndexRoute, newSessionRoute, sessionDetailRoute]),
      fieldSessionsRoute.addChildren([fieldSessionsIndexRoute, fieldSessionRoute]),
      gymRoute.addChildren([gymIndexRoute, newGymProgramRoute, gymProgramRoute]),
      menstrualCycleRoute,
      calendarRoute,
      testDaysRoute,
      testDayRoute,
      anthropometryRoute,
      configurationRoute,
      adminRoute.addChildren(adminRoutes),
      clubSupportAccessRoute,
      usageRoute,
      helpRoute,
      helpGuideRoute,
      protocolRoute,
      familyRoute.addChildren([childrenRoute, childRoute]),
    ]),
    consoleRoute.addChildren([
      consoleIndexRoute,
      consoleClubsRoute,
      consoleNewClubRoute,
      consoleClubRoute,
      consoleSupportAccessRoute,
    ]),
  ]),
]);

export function createAppRouter(services: AppServices, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { services },
    ...(history === undefined ? {} : { history }),
    defaultPreload: 'intent',
    // Data lives in TanStack Query; the router only waits for it.
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 300,
    scrollRestoration: true,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
