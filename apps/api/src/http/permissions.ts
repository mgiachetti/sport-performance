import { guardian, player, staffAssignment } from '@sport-performance/db/schema';
import {
  PermissionDeniedError,
  authorize,
  currentAssignments,
  currentGuardianships,
  listScope,
  parseLocalDate,
  ruleFor,
  type ActionOf,
  type ListScope,
  type PermissionObligation,
  type PermissionResource,
  type PermissionSubject,
  type ResourceKind,
} from '@sport-performance/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/context.js';
import type { TenantDatabase } from '../db/database.js';
import { HttpError } from './errors.js';

/**
 * Authorization of the endpoints with the permission matrix of the domain
 * (ADR 0025, ADR 0032). Every handler builds the subject of the caller and
 * asks the matrix before touching data; row-level security stays as the
 * second line of defense (ADR 0026).
 */

/** Where a request acts: in a club (membership or support), or on the registry of clubs. */
export type RequestScope = 'club' | 'registry' | 'none';

/**
 * Builds the permission subject of the caller from the session, the
 * selected membership and, for the roles the matrix scopes, the rows that
 * scope them **today in the club's time zone**: current staff assignments
 * (`coach`, `sc`, `medical`), the user's own player (`player`) and current
 * guardian links (`parent`). Runs on the request transaction, so RLS
 * applies to these reads too.
 *
 * Throws `403` when the caller has no role for the scope: a session without
 * a club, or the registry for someone who is not a superadmin.
 */
export async function loadPermissionSubject(
  db: TenantDatabase,
  auth: AuthContext,
  scope: RequestScope,
): Promise<PermissionSubject> {
  if (scope === 'registry') {
    if (!auth.isSuperadmin) {
      throw new HttpError('forbidden', 'Only a superadmin manages the registry of clubs');
    }
    return { userId: auth.userId, role: 'superadmin', clubId: null };
  }
  const membership = auth.membership;
  if (scope === 'none' || membership === null) {
    throw new HttpError('forbidden', 'Select a club first');
  }
  const base = { userId: auth.userId, role: membership.role, clubId: membership.clubId };
  switch (membership.role) {
    case 'coach':
    case 'sc':
    case 'medical': {
      if (membership.membershipId === null) return { ...base, assignments: [] };
      const today = await clubToday(db);
      const rows = await db
        .select({
          categoryId: staffAssignment.categoryId,
          sport: staffAssignment.sport,
          validFrom: staffAssignment.validFrom,
          validTo: staffAssignment.validTo,
        })
        .from(staffAssignment)
        .where(
          and(
            eq(staffAssignment.clubId, membership.clubId),
            eq(staffAssignment.membershipId, membership.membershipId),
          ),
        );
      return { ...base, assignments: currentAssignments(rows, today) };
    }
    case 'player': {
      const [own] = await db
        .select({ id: player.id })
        .from(player)
        .where(and(eq(player.clubId, membership.clubId), eq(player.userId, auth.userId)))
        .limit(1);
      return { ...base, playerId: own?.id ?? null };
    }
    case 'parent': {
      const today = await clubToday(db);
      const rows = await db
        .select({
          playerId: guardian.playerId,
          validFrom: guardian.validFrom,
          validTo: guardian.validTo,
        })
        .from(guardian)
        .where(and(eq(guardian.clubId, membership.clubId), eq(guardian.userId, auth.userId)));
      // Majority confirmation (B-311) is not modelled yet: no link is confirmed, so the
      // matrix denies a guardian of an adult player (fail closed).
      return { ...base, guardianships: currentGuardianships(rows, today) };
    }
    case 'admin':
    case 'superadmin':
      return base;
  }
}

/** "Today" in the club's time zone (CLAUDE.md), from the database's clock. */
async function clubToday(db: TenantDatabase) {
  const { rows } = await db.execute<{ today: string | null }>(
    sql`select app.club_today()::text as today`,
  );
  const today = rows[0]?.today ?? null;
  if (today === null) throw new HttpError('forbidden', 'The club of the request is not visible');
  return parseLocalDate(today);
}

/**
 * The authorization API handlers get (`ctx.permissions`): the subject is
 * loaded once per request, inside its transaction.
 */
export interface RequestPermissions {
  subject(): Promise<PermissionSubject>;
  /**
   * Decides one access and throws `PermissionDeniedError` (answered `403`)
   * when denied. `clubId` defaults to the subject's club. Returns the
   * obligations (`audit_support_access` is already fulfilled by the
   * transaction helper; `audit_medical_access` by the medical read functions).
   */
  authorize<K extends ResourceKind>(
    kind: K,
    action: ActionOf<K>,
    resource?: Omit<PermissionResource<K>, 'kind'>,
  ): Promise<readonly PermissionObligation[]>;
  /**
   * The rows of a kind the subject may list, to turn into SQL filters.
   * Throws `PermissionDeniedError` when the role's cell is a denial; a scoped
   * role without targets (a coach without assignments) gets `none`: an empty
   * list, not an error.
   */
  listScope<K extends ResourceKind>(
    kind: K,
    action: ActionOf<K>,
  ): Promise<Exclude<ListScope, { kind: 'none' }> | { kind: 'none' }>;
}

export function requestPermissions(
  db: TenantDatabase,
  auth: AuthContext | null,
  scope: RequestScope,
): RequestPermissions {
  let loaded: Promise<PermissionSubject> | undefined;
  const subject = () => {
    if (auth === null) {
      return Promise.reject(new HttpError('unauthenticated', 'This endpoint needs a session'));
    }
    loaded ??= loadPermissionSubject(db, auth, scope);
    return loaded;
  };
  return {
    subject,
    async authorize(kind, action, resource = {}) {
      const who = await subject();
      return authorize(who, action, { clubId: who.clubId, ...resource, kind });
    },
    async listScope(kind, action) {
      const who = await subject();
      const rule = ruleFor(kind, action, who.role);
      if (rule.effect === 'deny') {
        throw new PermissionDeniedError(kind, action, { allowed: false, reason: 'role_denied' });
      }
      return listScope(who, kind, action);
    },
  };
}
