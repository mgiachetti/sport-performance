import type { MembershipSummary } from '@sport-performance/contracts';
import { NOTIFICATION_KINDS, type NotificationKind } from '@sport-performance/domain';
import { canSeeStaffBoard } from '../staff/board.ts';

/**
 * What a tap on a push opens (B-510, ADR 0054, ADR 0081). The worker sends
 * only `kind`, `clubId`, `notificationId` and an app `path` in `data`; the
 * app turns them into one of its routes and, when the push is of another
 * club, into the membership to act in.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PushData {
  readonly kind: NotificationKind;
  readonly clubId: string;
  readonly path: string;
}

const PATH_MAX_LENGTH = 200;

function isKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/** The `data` of a push, or `null` when it is not one of the worker's (never throws). */
export function parsePushData(data: unknown): PushData | null {
  if (typeof data !== 'object' || data === null) return null;
  const { kind, clubId, path } = data as Record<string, unknown>;
  if (!isKind(kind) || typeof clubId !== 'string' || !UUID.test(clubId)) return null;
  if (typeof path !== 'string' || path.length > PATH_MAX_LENGTH) return null;
  return { kind, clubId: clubId.toLowerCase(), path };
}

/** A route of the app (Expo Router), with its parameters. */
export type AppRoute =
  | { readonly pathname: '/home' }
  | { readonly pathname: '/alerts/[alertId]'; readonly params: { readonly alertId: string } }
  | {
      readonly pathname: '/staff';
      readonly params: { readonly sessionId: string; readonly tap?: string };
    };

const HOME: AppRoute = { pathname: '/home' };

/**
 * The app route of a push `path`:
 * - `/alerts/<id>` (critical alert): the alert;
 * - `/training-sessions/<id>` (summary before training): the staff's quick
 *   look, filtered by the category of that session;
 * - `/training-sessions/<id>/rpe` (RPE request and reminder): home until the
 *   player's RPE screen (B-503) takes it, its seam is here;
 * - anything else: home.
 */
export function routeForPush(data: PushData): AppRoute {
  const parts = data.path.split('/').filter((part) => part !== '');
  const [section, id, rest, ...more] = parts;
  if (id === undefined || !UUID.test(id) || more.length > 0) return HOME;
  if (section === 'alerts' && rest === undefined && data.kind === 'critical_alert') {
    return { pathname: '/alerts/[alertId]', params: { alertId: id.toLowerCase() } };
  }
  if (
    section === 'training-sessions' &&
    rest === undefined &&
    data.kind === 'pre_training_summary'
  ) {
    return { pathname: '/staff', params: { sessionId: id.toLowerCase() } };
  }
  return HOME;
}

/**
 * The route of the `tap`-th tap: the board is a tab that stays mounted, so a
 * new tap (even of the same session) carries its own `tap` and the board
 * starts again from that session's category instead of the last pick.
 */
export function withTap(route: AppRoute, tap: number): AppRoute {
  if (route.pathname !== '/staff') return route;
  return { pathname: '/staff', params: { ...route.params, tap: String(tap) } };
}

/** Whether a membership is one the push is for: the staff kinds for the staff, the RPE for the player. */
function fits(membership: MembershipSummary, data: PushData): boolean {
  if (membership.club.id.toLowerCase() !== data.clubId) return false;
  if (data.kind === 'rpe_request' || data.kind === 'rpe_reminder') {
    return membership.role === 'player';
  }
  return canSeeStaffBoard(membership.role);
}

/**
 * The membership to act in for a push: the active one when it fits, or the
 * first that does (a coach and an admin of the same club both fit an alert);
 * `null` when none does (a membership that ended): the app opens home in the
 * club it is in.
 */
export function membershipForPush(
  memberships: readonly MembershipSummary[],
  active: MembershipSummary | null,
  data: PushData,
): MembershipSummary | null {
  if (active !== null && fits(active, data)) return active;
  return memberships.find((membership) => fits(membership, data)) ?? null;
}
