import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  retainSearchParams,
  type RouterHistory,
} from '@tanstack/react-router';
import { isSessionExpired } from './api/errors';
import { ensureQuery, meQuery } from './api/queries';
import { CalendarPage } from './calendar/CalendarPage';
import { parseCalendarSearch } from './calendar/model';
import type { AppServices } from './app/services';
import { ensureClubSelection, loadActiveClub } from './club/load';
import { FieldSessionPage } from './field-sessions/FieldSessionPage';
import { FieldSessionsPage } from './field-sessions/FieldSessionsPage';
import { parseFieldSessionsSearch } from './field-sessions/search';
import { ConfigurationPage } from './configuration/ConfigurationPage';
import { parseConfigurationSearch } from './configuration/search';
import { parseScopeSearch } from './club/scope';
import { ClubLayout } from './layout/ClubLayout';
import { RootLayout } from './layout/RootLayout';
import { ClubSelectPage } from './pages/ClubSelectPage';
import { RouteErrorPage, NotFoundPage } from './pages/ErrorPages';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { PanelPage } from './pages/panel/PanelPage';
import { parsePanelSearch } from './pages/panel/panel-search';
import { PlayerProfilePage } from './pages/players/PlayerProfilePage';
import { PlayersPage } from './pages/players/PlayersPage';
import { SupportPage } from './pages/SupportPage';
import { parseClubsSearch, parseLoginSearch, safeRedirect } from './routing/redirect';
import { NewSessionPage } from './training/NewSessionPage';
import { parseSessionsSearch } from './training/search';
import { SessionDetailPage } from './training/SessionDetailPage';
import { SessionsPage } from './training/SessionsPage';
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
 *     └── _club               needs a club: ActiveClub, layout, ?sport&category
 *         ├── /               home of the club
 *         ├── /panel          weekly panel (?week&group)
 *         ├── /players        roster of what the user sees (B-404)
 *         ├── /players/$id    profile of a player (B-404)
 *         ├── /sessions       training sessions and matches (B-407): list, new, one
 *         ├── /field-sessions sessions with field data (?kind) and /$trainingSessionId (B-408)
 *         ├── /calendar       season calendar (B-406): windows, test days, fixture
 *         └── /configuration  club configuration (B-409)
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

export const clubRoute = createRoute({
  getParentRoute: () => authedRoute,
  id: '_club',
  validateSearch: parseScopeSearch,
  search: { middlewares: [retainSearchParams(['sport', 'category'])] },
  beforeLoad: async ({ context, location }) => ({
    clubSelection: await ensureClubSelection(context.services, location.href),
  }),
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
      calendarRoute,
      configurationRoute,
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
