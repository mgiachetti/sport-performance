import type {
  Category,
  Club,
  ClubTheme,
  MembershipSummary,
  SessionUser,
  StaffAssignment,
} from '@sport-performance/contracts';
import type { AssignmentTarget, PermissionSubject, Role } from '@sport-performance/domain';
import { createContext, useContext, type ReactNode } from 'react';
import type { ClubSelection } from '../api/club-selection';

/** Roles the staff web serves (CLAUDE.md, roles): players and guardians use the app. */
export const STAFF_ROLES = ['coach', 'sc', 'medical', 'admin', 'superadmin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(role: Role): role is StaffRole {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

/** Roles that see the club through their staff assignments (ADR 0025, `assigned` scope). */
export const ASSIGNED_ROLES: readonly Role[] = ['coach', 'sc', 'medical'];

/**
 * The club the user acts in, resolved by the club route: who, with which
 * role, in which club, and what they see. Every screen inside the club
 * layout reads it with {@link useActiveClub}.
 */
export interface ActiveClub {
  readonly selection: ClubSelection;
  readonly user: SessionUser;
  readonly role: Role;
  /** `null` in support mode (a superadmin is not a member). */
  readonly membership: MembershipSummary | null;
  readonly club: Club;
  readonly theme: ClubTheme;
  /** Current assignments of the membership (empty for roles not scoped by them). */
  readonly assignments: readonly AssignmentTarget[];
  /** Active categories the role sees, in the club's order. */
  readonly categories: readonly Category[];
  /** Subject of the permission matrix (ADR 0025). */
  readonly subject: PermissionSubject;
}

/** Assignment targets from the API rows (the API already filtered the current ones). */
export function assignmentTargets(rows: readonly StaffAssignment[]): AssignmentTarget[] {
  return rows.map((row) =>
    row.target.kind === 'category'
      ? { kind: 'category', categoryId: row.target.categoryId }
      : { kind: 'sport', sport: row.target.sport },
  );
}

export function buildActiveClub(input: {
  selection: ClubSelection;
  user: SessionUser;
  membership: MembershipSummary | null;
  club: Club;
  theme: ClubTheme;
  assignments: readonly StaffAssignment[];
  categories: readonly Category[];
}): ActiveClub {
  const role: Role = input.membership?.role ?? 'superadmin';
  const assignments = ASSIGNED_ROLES.includes(role) ? assignmentTargets(input.assignments) : [];
  return {
    selection: input.selection,
    user: input.user,
    role,
    membership: input.membership,
    club: input.club,
    theme: input.theme,
    assignments,
    categories: input.categories,
    subject: { userId: input.user.id, role, clubId: input.club.id, assignments },
  };
}

const ActiveClubContext = createContext<ActiveClub | null>(null);

export function ActiveClubProvider(props: { value: ActiveClub; children: ReactNode }) {
  return (
    <ActiveClubContext.Provider value={props.value}>{props.children}</ActiveClubContext.Provider>
  );
}

/** The active club; only inside the club layout. */
export function useActiveClub(): ActiveClub {
  const value = useContext(ActiveClubContext);
  if (value === null) throw new Error('useActiveClub outside the club layout');
  return value;
}
