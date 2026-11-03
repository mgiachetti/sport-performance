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
import type { AppServices } from './app/services';
import { ensureClubSelection, loadActiveClub } from './club/load';
import { parseScopeSearch } from './club/scope';
import { ClubLayout } from './layout/ClubLayout';
import { RootLayout } from './layout/RootLayout';
import { ClubSelectPage } from './pages/ClubSelectPage';
import { RouteErrorPage, NotFoundPage } from './pages/ErrorPages';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { SupportPage } from './pages/SupportPage';
import { parseClubsSearch, parseLoginSearch, safeRedirect } from './routing/redirect';
import { Loading } from './ui/components';

/** What every route's `beforeLoad` and `loader` receive (ADR 0056). */
export interface RouterContext {
  readonly services: AppServices;
}

/**
 * Route tree (code-based, ADR 0056):
 *
 * ```
 * __root__                    theme, banners, 404 and error boundary
 * ├── /login                  sign-in by email code
 * └── _authed                 needs a session (GET /v1/me), else /login?redirect=
 *     ├── /clubs              club selector (memberships, support mode entry)
 *     ├── /support            superadmin: reason + club of the registry
 *     └── _club               needs a club: ActiveClub, layout, ?sport&category
 *         └── /               home of the club
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

export const routeTree = rootRoute.addChildren([
  loginRoute,
  authedRoute.addChildren([clubsRoute, supportRoute, clubRoute.addChildren([homeRoute])]),
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
