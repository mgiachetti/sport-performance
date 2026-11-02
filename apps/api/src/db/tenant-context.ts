import {
  isRole,
  isUuid,
  parseChangeReason,
  type ClubId,
  type Role,
  type UserId,
} from '@sport-performance/domain';

/**
 * What a transaction tells Postgres about who is asking (ADR 0006). Row-level
 * policies read it through `app.current_club_id()`, `app.current_user_id()`
 * and `app.current_role()`. `null` means "no value": the policies deny.
 *
 * Shapes allowed: anonymous (all `null`), authenticated without a selected
 * club (`userId` only), the superadmin on the registry of clubs (no club,
 * role `superadmin`, ADR 0029), and acting in a club (all three).
 */
export type TenantContext =
  | { readonly clubId: null; readonly userId: null; readonly role: null }
  | { readonly clubId: null; readonly userId: UserId; readonly role: null }
  | { readonly clubId: null; readonly userId: UserId; readonly role: 'superadmin' }
  | { readonly clubId: ClubId; readonly userId: UserId; readonly role: Role };

export const ANONYMOUS_CONTEXT: TenantContext = Object.freeze({
  clubId: null,
  userId: null,
  role: null,
});

/**
 * The rest of what a request transaction carries besides the tenant context
 * (ADR 0032). All optional: the identity flows and the probes set none.
 */
export interface TransactionSettings {
  /**
   * `app.request_id`: the id of the request in the logs (ADR 0016). Audited
   * operations (medical reads and writes, the superadmin's support access)
   * refuse to run without it (ADR 0029); the change history records it.
   */
  readonly requestId?: string | null;
  /**
   * `app.change_reason`: why submitted values change (ADR 0030). Required
   * by the database to correct a value already loaded through the API.
   */
  readonly changeReason?: string | null;
  /**
   * Why a superadmin acts (ADR 0029). Required whenever the context's role
   * is `superadmin`: the transaction records it with
   * `app.begin_support_access(reason)` before anything else, or does not run.
   */
  readonly supportReason?: string | null;
}

/** Thrown before touching the database when a context or a setting is malformed. */
export class TenantContextError extends Error {
  override readonly name = 'TenantContextError';
}

/**
 * The database refused to record the superadmin's support access: the club
 * does not exist, or the user is not a superadmin anymore. Answered `403`.
 */
export class SupportAccessError extends Error {
  override readonly name = 'SupportAccessError';
}

/** Postgres settings the transaction writes, in the order of {@link SET_TENANT_CONTEXT_SQL}. */
export const TENANT_SETTINGS = [
  'app.club_id',
  'app.user_id',
  'app.role',
  'app.request_id',
  'app.change_reason',
] as const;

/**
 * Sets the settings for the current transaction only (`is_local = true` is
 * `SET LOCAL`). Values travel as bind parameters, never interpolated. All of
 * them are always written, an empty string meaning "no value", so a setting
 * left at session level by mistake is overridden inside every transaction.
 * The functions of `packages/db` read `''` as `NULL`: Postgres also reports
 * `''` for a custom setting after a transaction that set it ends.
 */
export const SET_TENANT_CONTEXT_SQL =
  "select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true), set_config('app.request_id', $4, true), set_config('app.change_reason', $5, true)";

/** Records the superadmin's support access in the transaction (ADR 0029). */
export const BEGIN_SUPPORT_ACCESS_SQL = 'select app.begin_support_access($1)';

/** Same rule as the API's request ids and the database's `change_history_request_id` check. */
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Trimmed, 1 to 500 characters; the rule of reasons in the database (ADR 0029, ADR 0030). */
function reasonParameter(value: string | null | undefined, name: string): string | null {
  if (value === undefined || value === null) return null;
  try {
    return parseChangeReason(value);
  } catch {
    throw new TenantContextError(`Transaction settings: ${name} must be 1 to 500 characters`);
  }
}

/** Bind parameters of a transaction: the settings and, for a superadmin, the support reason. */
export interface TransactionParameters {
  readonly settings: readonly [string, string, string, string, string];
  /** Reason for `app.begin_support_access`; set exactly when the role is `superadmin`. */
  readonly supportReason: string | null;
}

/**
 * Validates a context and its settings at runtime (they may come from a
 * session store or a header) and returns the bind parameters of
 * {@link SET_TENANT_CONTEXT_SQL}. A superadmin context without a support
 * reason is rejected: it would run without its audit (fail closed).
 */
export function transactionParameters(
  context: TenantContext,
  options: TransactionSettings = {},
): TransactionParameters {
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
  const registry = clubId === null && role === 'superadmin';
  const inClub = clubId !== null || role !== null;
  if (inClub && !registry && (clubId === null || role === null || userId === null)) {
    throw new TenantContextError('Tenant context: clubId and role go together, with a userId');
  }
  if (registry && userId === null) {
    throw new TenantContextError('Tenant context: the registry context needs a userId');
  }
  const requestId = options.requestId ?? null;
  if (requestId !== null && !REQUEST_ID.test(requestId)) {
    throw new TenantContextError(
      'Transaction settings: requestId must be 1 to 128 characters of [A-Za-z0-9._:-]',
    );
  }
  const changeReason = reasonParameter(options.changeReason, 'changeReason');
  const supportReason = reasonParameter(options.supportReason, 'supportReason');
  if (role === 'superadmin' && supportReason === null) {
    throw new TenantContextError('Tenant context: a superadmin acts only with a support reason');
  }
  if (role === 'superadmin' && requestId === null) {
    throw new TenantContextError('Tenant context: a support access needs the request id');
  }
  if (role !== 'superadmin' && supportReason !== null) {
    throw new TenantContextError('Tenant context: only a superadmin context has a support reason');
  }
  return {
    settings: [
      context.clubId ?? '',
      context.userId ?? '',
      context.role ?? '',
      requestId ?? '',
      changeReason ?? '',
    ],
    supportReason,
  };
}
