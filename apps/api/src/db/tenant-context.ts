import { isRole, isUuid, type ClubId, type Role, type UserId } from '@sport-performance/domain';

/**
 * What a transaction tells Postgres about who is asking (ADR 0006). Row-level
 * policies read it through `app.current_club_id()`, `app.current_user_id()`
 * and `app.current_role()`. `null` means "no value": the policies deny.
 *
 * Shapes allowed: anonymous (all `null`), authenticated without a selected
 * club (`userId` only), and acting in a club (all three).
 */
export type TenantContext =
  | { readonly clubId: null; readonly userId: null; readonly role: null }
  | { readonly clubId: null; readonly userId: UserId; readonly role: null }
  | { readonly clubId: ClubId; readonly userId: UserId; readonly role: Role };

export const ANONYMOUS_CONTEXT: TenantContext = Object.freeze({
  clubId: null,
  userId: null,
  role: null,
});

/** Thrown before touching the database when a context is malformed. */
export class TenantContextError extends Error {
  override readonly name = 'TenantContextError';
}

/** Postgres settings the context maps to, in the order of {@link SET_TENANT_CONTEXT_SQL}. */
export const TENANT_SETTINGS = ['app.club_id', 'app.user_id', 'app.role'] as const;

/**
 * Sets the three settings for the current transaction only (`is_local = true`
 * is `SET LOCAL`). Values travel as bind parameters, never interpolated.
 * All three are always written, an empty string meaning "no value", so a
 * setting left at session level by mistake is overridden inside every
 * transaction. The functions of `packages/db` read `''` as `NULL`: Postgres
 * also reports `''` for a custom setting after a transaction that set it ends.
 */
export const SET_TENANT_CONTEXT_SQL =
  "select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true)";

/**
 * Validates a context at runtime (it may come from a session store) and
 * returns the bind parameters of {@link SET_TENANT_CONTEXT_SQL}.
 */
export function tenantContextParameters(context: TenantContext): [string, string, string] {
  const { clubId, userId, role } = context as {
    clubId: unknown;
    userId: unknown;
    role: unknown;
  };
  if (clubId !== null && !isUuid(clubId)) {
    throw new TenantContextError('Tenant context: clubId must be a lowercase UUID or null');
  }
  if (userId !== null && !isUuid(userId)) {
    throw new TenantContextError('Tenant context: userId must be a lowercase UUID or null');
  }
  if (role !== null && !isRole(role)) {
    throw new TenantContextError('Tenant context: role is not a known role');
  }
  const inClub = clubId !== null || role !== null;
  if (inClub && (clubId === null || role === null || userId === null)) {
    throw new TenantContextError('Tenant context: clubId and role go together, with a userId');
  }
  return [context.clubId ?? '', context.userId ?? '', context.role ?? ''];
}
