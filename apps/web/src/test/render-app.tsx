import { createMemoryHistory } from '@tanstack/react-router';
import { render, type RenderResult } from '@testing-library/react';
import { userEvent, type UserEvent } from '@testing-library/user-event';
import type { UploadFetch } from '../api/storage-upload';
import { App, defaultTranslator } from '../app/App';
import { createWebApp, type WebApp } from '../app/create-app';
import type { MembershipSummary, SessionUser } from '@sport-performance/contracts';
import { apiError, createFakeApi, type FakeApi, type FakeHandlers } from './fake-api';
import * as fixtures from './fixtures';

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
