import { memberGuard, memberParser } from './enum.js';

/**
 * Role of a user inside one club (ADR 0007). Roles live on the membership,
 * not on the user: the same person can be `sc` in one club and `parent` in
 * another. `superadmin` is deliberately absent: it is a global attribute of
 * the user, never a club membership.
 *
 * The API sets the role of the chosen membership as `app.role` (ADR 0006).
 */
export const MEMBERSHIP_ROLES = ['player', 'parent', 'coach', 'sc', 'medical', 'admin'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const isMembershipRole = memberGuard(MEMBERSHIP_ROLES);
export const parseMembershipRole = memberParser(
  MEMBERSHIP_ROLES,
  'invalid_argument',
  'membership role',
);
