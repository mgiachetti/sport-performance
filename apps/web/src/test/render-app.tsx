import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, type RenderResult } from '@testing-library/react';
import { userEvent, type UserEvent } from '@testing-library/user-event';
import { beforeAll } from 'vitest';
import type { UploadFetch } from '../api/storage-upload';
import { App, defaultTranslator } from '../app/App';
import { createWebApp, type WebApp } from '../app/create-app';
import type { MembershipSummary, SessionUser } from '@sport-performance/contracts';
import { apiError, createFakeApi, type FakeApi, type FakeHandlers } from './fake-api';
import * as fixtures from './fixtures';
import { resetTestEnvironment } from './reset';

export const TEST_API_URL = 'https://api.test';

export interface RenderAppOptions {
  /** Initial URL (`/`, `/login?redirect=/`...). */
  readonly path?: string;
  readonly handlers?: FakeHandlers;
  readonly browserOnline?: boolean;
  readonly systemPrefersMoreContrast?: boolean;
  /** Answers the signed `PUT`s to the bucket; by default every upload succeeds. */
  readonly uploadFetch?: UploadFetch;
}

/** A signed upload the app sent to the bucket. */
export interface SentUpload {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Blob;
}

export interface RenderedApp extends RenderResult {
  readonly app: WebApp;
  readonly api: FakeApi;
  readonly user: UserEvent;
  /** Signed uploads sent to the bucket, in order. */
  readonly uploads: SentUpload[];
}

/**
 * Renders the whole app (providers, router, theme, connection) over a fake
 * API, at `path`, with an in-memory history and no query retries. Screens are
 * tested through it, as the user sees them:
 *
 * ```tsx
 * const { user, api } = renderApp({ path: '/', handlers: signedInAs('coach') });
 * expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
 * ```
 */
export function renderApp(options: RenderAppOptions = {}): RenderedApp {
  const api = createFakeApi(TEST_API_URL, options.handlers);
  const uploads: SentUpload[] = [];
  const answerUpload = options.uploadFetch ?? (() => Promise.resolve({ ok: true, status: 200 }));
  const app = createWebApp({
    apiUrl: TEST_API_URL,
    fetch: api.fetch,
    uploadFetch: (url, init) => {
      uploads.push({ url, headers: init.headers, body: init.body });
      return answerUpload(url, init);
    },
    storage: { local: window.localStorage, session: window.sessionStorage },
    browserOnline: options.browserOnline ?? true,
    systemPrefersMoreContrast: options.systemPrefersMoreContrast ?? false,
    history: createMemoryHistory({ initialEntries: [options.path ?? '/'] }),
    retries: 0,
  });
  const user = userEvent.setup();
  const result = render(<App app={app} translator={defaultTranslator(['es-AR'])} />);
  return { ...result, app, api, user, uploads };
}

/** Below the shared `hookTimeout` (60 s): room for a busy runner, still catches a hang. */
const WARM_UP_TIMEOUT_MS = 30_000;

/**
 * Warm-up of every file that renders the app. Each test file runs in a fresh
 * worker (new jsdom, modules evaluated again), so the first mount of the app
 * in a file pays a cold start the next ones do not: about 5 times a warm
 * mount (270 ms vs 50 ms on an idle machine), split among the first render of
 * the router and the shell, the first parse of each contract and the first
 * role query over jsdom's computed styles (110 ms of it). Under CPU
 * contention that alone took the first test of a file, usually «is in the
 * navigation…», past Testing Library's wait. The hook pays it once, under the
 * hook timeout, with the mount the screens start from (a staff member at
 * `/`, until the navigation is on screen), and leaves the document as a fresh
 * test expects.
 */
beforeAll(async () => {
  const { app } = renderApp({ path: '/', handlers: signedIn() });
  try {
    await screen.findByRole('link', { name: 'Calendario' }, { timeout: WARM_UP_TIMEOUT_MS });
  } finally {
    resetTestEnvironment();
    app.services.queryClient.clear();
  }
});

/**
 * Handlers of a signed-in user with the given memberships, in ORC: session,
 * memberships, club, theme, categories and the user's assignments.
 */
export function signedIn(
  options: {
    user?: SessionUser;
    memberships?: readonly MembershipSummary[];
    categories?: readonly ReturnType<typeof fixtures.category>[];
    assignedTo?: readonly ReturnType<typeof fixtures.category>[];
  } = {},
): FakeHandlers {
  const user = options.user ?? fixtures.USER;
  const memberships = options.memberships ?? [fixtures.membership('coach')];
  const categories = options.categories ?? [fixtures.M15_RUGBY, fixtures.M17_RUGBY];
  return {
    getMe: (request) => {
      const wanted = request.headers['x-membership-id'];
      const active =
        memberships.find((m) => m.id === wanted) ??
        (memberships.length === 1 ? memberships[0] : null);
      return fixtures.me(user, active ?? null);
    },
    listMyMemberships: () => ({ items: [...memberships] }),
    getClub: () => fixtures.club(),
    getClubTheme: () => fixtures.clubTheme(),
    listCategories: () => fixtures.page(categories),
    listMyStaffAssignments: () =>
      fixtures.page(
        (options.assignedTo ?? categories).map((c) => fixtures.categoryAssignment('coach', c)),
      ),
    signOut: () => undefined,
    getHealth: () => ({ status: 'ok', version: 'test', time: '2026-11-01T12:00:00.000Z' }),
  };
}

/** Handlers of a visitor without a session: every session endpoint answers `401`. */
export function signedOut(): FakeHandlers {
  const unauthenticated = () => apiError(401, 'unauthenticated');
  return {
    getMe: unauthenticated,
    listMyMemberships: unauthenticated,
    getHealth: () => ({ status: 'ok', version: 'test', time: '2026-11-01T12:00:00.000Z' }),
  };
}
