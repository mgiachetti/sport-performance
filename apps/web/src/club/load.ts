import { redirect } from '@tanstack/react-router';
import type { ClubSelection } from '../api/club-selection';
import {
  categoriesQuery,
  clubProfileQuery,
  clubThemeQuery,
  ensureQuery,
  meQuery,
  membershipsQuery,
  myAssignmentsQuery,
} from '../api/queries';
import type { AppServices } from '../app/services';
import { ASSIGNED_ROLES, isStaffRole } from './active-club';

function toClubs(href: string, unavailable: boolean) {
  return redirect({
    to: '/clubs',
    search: { redirect: href, ...(unavailable ? { unavailable: true as const } : {}) },
  });
}

/**
 * `beforeLoad` of the club layout: makes sure there is a valid selection.
 *
 * - support mode only for a superadmin;
 * - a remembered membership must still be one of the user's;
 * - without a selection, a single membership is picked by itself and more
 *   than one (or none) go to the club selector, which comes back to `href`.
 */
export async function ensureClubSelection(
  services: AppServices,
  href: string,
): Promise<ClubSelection> {
  const { api, queryClient, selection } = services;
  const current = selection.get();
  if (current?.kind === 'support') {
    const me = await ensureQuery(queryClient, meQuery(api, current));
    if (me.user.isSuperadmin) return current;
    selection.select(null);
    throw toClubs(href, true);
  }
  const { items } = await ensureQuery(queryClient, membershipsQuery(api));
  if (current !== null) {
    if (items.some((membership) => membership.id === current.membershipId)) return current;
    selection.select(null);
    throw toClubs(href, true);
  }
  const [only, ...others] = items;
  if (only !== undefined && others.length === 0) {
    const picked: ClubSelection = { kind: 'membership', membershipId: only.id };
    selection.select(picked);
    return picked;
  }
  throw toClubs(href, false);
}

/**
 * `loader` of the club layout: everything `ActiveClub` is built from, in the
 * query cache before the layout renders (it reads them with suspense, so
 * refetches update it in place).
 */
export async function loadActiveClub(
  services: AppServices,
  current: ClubSelection,
  href: string,
): Promise<void> {
  const { api, queryClient, selection } = services;
  const me = await ensureQuery(queryClient, meQuery(api, current));
  if (current.kind === 'membership' && me.activeMembership?.id !== current.membershipId) {
    // The API no longer accepts the membership (ended between two requests).
    selection.select(null);
    await queryClient.invalidateQueries({ queryKey: ['session'] });
    throw toClubs(href, true);
  }
  const role =
    current.kind === 'membership' ? (me.activeMembership?.role ?? 'player') : 'superadmin';
  const club = await ensureQuery(queryClient, clubProfileQuery(api, current));
  await Promise.all([
    ensureQuery(queryClient, clubThemeQuery(api, club.slug)),
    isStaffRole(role) ? ensureQuery(queryClient, categoriesQuery(api, current)) : null,
    isStaffRole(role)
      ? ensureQuery(queryClient, myAssignmentsQuery(api, current, ASSIGNED_ROLES.includes(role)))
      : null,
  ]);
}
