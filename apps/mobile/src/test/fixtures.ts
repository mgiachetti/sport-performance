import {
  clubThemeSchema,
  membershipSchema,
  sessionUserSchema,
  type ClubTheme,
  type MembershipSummary,
  type SessionUser,
} from '@sport-performance/contracts';
import { runtimeConfigFromEnv } from '../config/runtime-config.ts';
import { memoryPreferenceStorage, memorySecureStorage } from '../platform/storage.ts';
import { createAppServices, type Platform } from '../state/services.ts';
import { createFakeApi, type FakeApi } from './fake-api.ts';

export const USER: SessionUser = sessionUserSchema.parse({
  id: '1f2e3d4c-5b6a-4789-8abc-def012345678',
  email: 'ana@example.com',
  name: 'Ana',
  isSuperadmin: false,
});

export const ORC_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
export const OTHER_CLUB_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

export function membership(
  id: string,
  role: MembershipSummary['role'],
  club: { id: string; slug: string; name: string } = {
    id: ORC_ID,
    slug: 'orc',
    name: 'Olivos Rugby Club',
  },
): MembershipSummary {
  return membershipSchema.parse({ id, role, club, startedAt: '2026-03-01T12:00:00.000Z' });
}

export const COACH_AT_ORC = membership('a1111111-1111-4111-8111-111111111111', 'coach');
export const PARENT_AT_ORC = membership('a2222222-2222-4222-8222-222222222222', 'parent');
export const PLAYER_AT_OTHER = membership('a3333333-3333-4333-8333-333333333333', 'player', {
  id: OTHER_CLUB_ID,
  slug: 'otro',
  name: 'Atlético Otro',
});

export const ORC_THEME: ClubTheme = clubThemeSchema.parse({
  clubId: ORC_ID,
  slug: 'orc',
  name: 'Olivos Rugby Club',
  shortName: 'ORC',
  logoUrl: null,
  colors: {
    primary: '#F1882A',
    onPrimary: '#050505',
    secondary: '#050505',
    onSecondary: '#F3EEE7',
  },
  updatedAt: '2026-10-01T12:00:00.000Z',
});

export const SESSION_TOKEN = 'session-token-of-ana';
export const DEVICE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** Answers of a signed-in user with the given memberships. */
export function signedInRoutes(api: FakeApi, memberships: readonly MembershipSummary[]): void {
  api.on('GET /v1/me', {
    status: 200,
    body: {
      user: USER,
      session: { expiresAt: '2026-12-01T12:00:00.000Z' },
      activeMembership: memberships[0] ?? null,
    },
  });
  api.on('GET /v1/me/memberships', { status: 200, body: { items: memberships } });
}

/** The app services against a fake API and in-memory device storage. */
export function testServices(options: { secure?: Record<string, string> } = {}) {
  const api = createFakeApi();
  const secure = memorySecureStorage(options.secure);
  const preferences = memoryPreferenceStorage();
  const errors: unknown[] = [];
  const platform: Platform = {
    config: runtimeConfigFromEnv({ API_BASE_URL: api.baseUrl }, 'sportperformance-dev'),
    build: { platform: 'ios', nativeVersion: '1.0.0', runtimeVersion: null },
    secureStorage: secure,
    preferences,
    randomUUID: () => DEVICE_ID,
    languageTags: ['es-AR'],
    reportError: (error) => errors.push(error),
    fetch: api.fetch,
  };
  const services = createAppServices(platform);
  return { api, secure, preferences, errors, services };
}
