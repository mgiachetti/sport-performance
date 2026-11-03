import type {
  Category,
  Club,
  ClubTheme,
  Me,
  MembershipSummary,
  SessionUser,
  StaffAssignment,
} from '@sport-performance/contracts';
import {
  parseCategoryId,
  parseClubId,
  parseTimeZone,
  parseUserId,
  parseUuid,
  type MembershipRole,
} from '@sport-performance/domain';

/** Valid API payloads for the tests (they go through the client's response validation). */

const AT = '2026-11-01T12:00:00.000Z';
const VERSION = '1793586338688123';

export const ORC_ID = parseClubId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f');
export const OTHER_CLUB_ID = parseClubId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10');

export const USER: SessionUser = {
  id: parseUserId('0192e7a0-0000-7000-8000-000000000001'),
  email: 'santiago@example.com',
  name: 'Santiago Ríos',
  isSuperadmin: false,
};

export const SUPERADMIN: SessionUser = {
  id: parseUserId('0192e7a0-0000-7000-8000-000000000099'),
  email: 'soporte@example.com',
  name: 'Soporte',
  isSuperadmin: true,
};

export function membership(
  role: MembershipRole,
  options: { id?: string; clubId?: string; clubName?: string; slug?: string } = {},
): MembershipSummary {
  return {
    id: parseUuid(options.id ?? '0192e7a0-1111-7000-8000-000000000001'),
    club: {
      id: parseClubId(options.clubId ?? ORC_ID),
      slug: options.slug ?? 'orc',
      name: options.clubName ?? 'Olivos Rugby Club',
    },
    role,
    startedAt: AT,
  };
}

export function me(user: SessionUser, active: MembershipSummary | null): Me {
  return { user, session: { expiresAt: '2026-12-01T12:00:00.000Z' }, activeMembership: active };
}

export function club(overrides: Partial<Club> = {}): Club {
  return {
    id: ORC_ID,
    slug: 'orc',
    name: 'Olivos Rugby Club',
    shortName: 'ORC',
    timeZone: parseTimeZone('America/Argentina/Buenos_Aires'),
    locale: 'es-AR',
    colors: { primary: '#f1882a', secondary: '#050505' },
    logoFileId: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function clubTheme(overrides: Partial<ClubTheme> = {}): ClubTheme {
  return {
    clubId: ORC_ID,
    slug: 'orc',
    name: 'Olivos Rugby Club',
    shortName: 'ORC',
    logoUrl: null,
    colors: {
      primary: '#f1882a',
      onPrimary: '#050505',
      secondary: '#050505',
      onSecondary: '#f3eee7',
    },
    updatedAt: AT,
    ...overrides,
  };
}

export function category(
  id: string,
  name: string,
  sport: Category['sport'],
  overrides: Partial<Category> = {},
): Category {
  return {
    id: parseCategoryId(id),
    sport,
    sex: sport === 'rugby' ? 'male' : 'female',
    ageBandCode: 'm15',
    name,
    defaultStage: 'development',
    sortOrder: 0,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export const M15_RUGBY = category('0192e7a0-2222-7000-8000-000000000015', 'M15', 'rugby');
export const M17_RUGBY = category('0192e7a0-2222-7000-8000-000000000017', 'M17', 'rugby', {
  ageBandCode: 'm17',
  defaultStage: 'performance',
  sortOrder: 1,
});
export const F15_HOCKEY = category('0192e7a0-2222-7000-8000-000000000115', 'Sub 15', 'hockey', {
  sortOrder: 2,
});

export function categoryAssignment(memberRole: MembershipRole, target: Category): StaffAssignment {
  return {
    id: parseUuid('0192e7a0-3333-7000-8000-000000000001'),
    membershipId: parseUuid('0192e7a0-1111-7000-8000-000000000001'),
    member: { userId: USER.id, name: USER.name, role: memberRole },
    target: { kind: 'category', categoryId: target.id },
    validFrom: '2026-03-01' as StaffAssignment['validFrom'],
    validTo: null,
    status: 'current',
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
  };
}

export function page<T>(items: readonly T[]) {
  return { items: [...items], nextCursor: null };
}
