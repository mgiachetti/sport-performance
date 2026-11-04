import type { Category, PanelAlert, PanelPlayer, WeeklyPanel } from '@sport-performance/contracts';
import {
  addDays,
  DEFAULT_CLUB_TIME_ZONE,
  daysBetween,
  localDateInTimeZone,
  ruleFor,
  type AvailabilityStatus,
  type LocalDate,
  type Role,
  type TimeZone,
} from '@sport-performance/domain';

/**
 * The staff's quick look before training (B-510, ADR 0081): who is not
 * available, who has an alert and who has not loaded the wellness today,
 * from the weekly panel of the API (ADR 0059) and the wellness rows the sync
 * brought after it. Pure: the screen and the tests share it.
 */

/** The cells of the matrix the weekly panel reads (the API's `PANEL_KINDS`). */
const BOARD_CELLS = [
  ['load_metrics', 'read'],
  ['wellness', 'read'],
  ['alert', 'read'],
  ['availability', 'read'],
] as const;

/** Whether the role sees the quick look: the same cells the API checks for the panel. */
export function canSeeStaffBoard(role: Role): boolean {
  return BOARD_CELLS.every(([kind, action]) => ruleFor(kind, action, role).effect === 'allow');
}

/** Whether the role can acknowledge or dismiss an alert (`alert.acknowledge`). */
export function canReviewAlerts(role: Role): boolean {
  return ruleFor('alert', 'acknowledge', role).effect === 'allow';
}

/** History weeks the board asks for: the minimum, it only reads the current week. */
export const BOARD_PANEL_WEEKS = 4;

/**
 * Why a player is on top, most urgent first. A player shows once, under the
 * most urgent reason; the rest of their state is on the same row.
 */
export const ATTENTION_REASONS = ['unavailable', 'critical', 'limited', 'warning'] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export interface BoardPlayer {
  readonly playerId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly categoryNames: readonly string[];
  /** `null` when the API does not report it for the player. */
  readonly availability: AvailabilityStatus | null;
  /** Active alerts, critical first, then by the day they were raised (newest first). */
  readonly alerts: readonly PanelAlert[];
  readonly wellnessToday: boolean;
  readonly reason: AttentionReason | null;
}

export interface BoardCounts {
  readonly players: number;
  readonly unavailable: number;
  readonly limited: number;
  /** Players with at least one critical alert. */
  readonly critical: number;
  /** Players whose worst alert is a warning. */
  readonly warning: number;
  readonly missingWellness: number;
}

export interface Board {
  /** The club day now (`boardClubDay`). */
  readonly today: LocalDate;
  /** The club day the panel was read for. */
  readonly panelDay: LocalDate;
  /**
   * The panel is of an earlier day (kept from another day, opened without
   * signal): its availability and alerts are of `panelDay`, and the wellness
   * of today comes only from the rows the sync brought.
   */
  readonly stale: boolean;
  readonly counts: BoardCounts;
  /** Players with a reason, by reason and then by last and first name. */
  readonly attention: readonly BoardPlayer[];
  /** Players without a reason and without wellness today, by name. */
  readonly missingWellness: readonly BoardPlayer[];
  /** Players with nothing to look at. */
  readonly clearCount: number;
}

export interface BoardInput {
  readonly panel: WeeklyPanel;
  /** The club day now (`boardClubDay`); the panel may be of an earlier one. */
  readonly today: LocalDate;
  readonly categories: readonly Pick<Category, 'id' | 'name'>[];
  /** Only the players in this category today; `null` for every player of the panel. */
  readonly categoryId: string | null;
  /**
   * Players with a wellness row of `today` on the device (pulled after the
   * panel was read): they count as loaded even if the panel says not.
   */
  readonly wellnessPlayerIds: ReadonlySet<string>;
}

const SEVERITY_ORDER = { critical: 0, warning: 1 } as const;

function sortedAlerts(alerts: readonly PanelAlert[]): PanelAlert[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.raisedOn.localeCompare(a.raisedOn),
  );
}

function reasonOf(player: PanelPlayer): AttentionReason | null {
  const availability = player.availability?.overall ?? null;
  if (availability === 'unavailable') return 'unavailable';
  if (player.alerts.some((alert) => alert.severity === 'critical')) return 'critical';
  if (availability === 'limited') return 'limited';
  if (player.alerts.length > 0) return 'warning';
  return null;
}

const collator = new Intl.Collator('es-AR', { sensitivity: 'base' });

function byName(a: BoardPlayer, b: BoardPlayer): number {
  return collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName);
}

/**
 * Which opening of the board a category pick belongs to: the session of the
 * summary push and the tap that opened it (`withTap`), so a later tap, even
 * of the same session, starts filtered by its session's category again.
 */
export function boardOpeningKey(sessionId: unknown, tap: unknown): string {
  return `${typeof sessionId === 'string' ? sessionId : ''}:${typeof tap === 'string' ? tap : ''}`;
}

/**
 * The club day now, for a panel read at `fetchedAtMs` for `panelDay` (the
 * club day the API answered). The app does not know the club's time zone
 * (the membership does not carry it): it counts the days that went by since
 * the read in `DEFAULT_CLUB_TIME_ZONE` (ADR 0081) and adds them to the
 * panel's day, so the day always comes from the server and only the change
 * of day is local. For a club in another zone, the change is seen up to the
 * difference of offsets early or late. Never before the panel's day.
 */
export function boardClubDay(
  panelDay: LocalDate,
  fetchedAtMs: number | null,
  nowMs: number,
  timeZone: TimeZone = DEFAULT_CLUB_TIME_ZONE,
): LocalDate {
  if (fetchedAtMs === null) return panelDay;
  const elapsed = daysBetween(
    localDateInTimeZone(fetchedAtMs, timeZone),
    localDateInTimeZone(nowMs, timeZone),
  );
  return elapsed > 0 ? addDays(panelDay, elapsed) : panelDay;
}

export function buildBoard(input: BoardInput): Board {
  const { panel, today, categoryId, wellnessPlayerIds } = input;
  const stale = today !== panel.today;
  const names = new Map(input.categories.map((category) => [category.id, category.name]));
  const players = panel.players
    .filter(
      (player) =>
        categoryId === null || player.categoryIds.some((id) => (id as string) === categoryId),
    )
    .map((player): BoardPlayer => ({
      playerId: player.playerId,
      firstName: player.firstName,
      lastName: player.lastName,
      categoryNames: player.categoryIds.flatMap((id) => {
        const name = names.get(id);
        return name === undefined ? [] : [name];
      }),
      availability: player.availability?.overall ?? null,
      alerts: sortedAlerts(player.alerts),
      // The panel's flag is of its own day: of no use once that day is over.
      wellnessToday:
        (!stale && player.wellness.submittedToday) || wellnessPlayerIds.has(player.playerId),
      reason: reasonOf(player),
    }));
  const rank = (reason: AttentionReason) => ATTENTION_REASONS.indexOf(reason);
  const attention = players
    .filter((player) => player.reason !== null)
    .sort((a, b) => rank(a.reason ?? 'warning') - rank(b.reason ?? 'warning') || byName(a, b));
  const missingWellness = players
    .filter((player) => player.reason === null && !player.wellnessToday)
    .sort(byName);
  const counts: BoardCounts = {
    players: players.length,
    unavailable: players.filter((p) => p.availability === 'unavailable').length,
    limited: players.filter((p) => p.availability === 'limited').length,
    critical: players.filter((p) => p.alerts.some((a) => a.severity === 'critical')).length,
    warning: players.filter(
      (p) => p.alerts.length > 0 && p.alerts.every((a) => a.severity === 'warning'),
    ).length,
    missingWellness: players.filter((p) => !p.wellnessToday).length,
  };
  return {
    today,
    panelDay: panel.today,
    stale,
    counts,
    attention,
    missingWellness,
    clearCount: players.length - attention.length - missingWellness.length,
  };
}

/** Categories that have a player in the panel, in the club's order: the filter chips. */
export function boardCategories(
  panel: WeeklyPanel,
  categories: readonly Category[],
): Pick<Category, 'id' | 'name'>[] {
  const present = new Set(panel.players.flatMap((player) => player.categoryIds));
  return categories
    .filter((category) => present.has(category.id))
    .map((category) => ({ id: category.id, name: category.name }));
}

/** The alert of the panel with this id (the alert screen without signal), and its player. */
export function findPanelAlert(
  panel: WeeklyPanel | undefined,
  alertId: string,
): { readonly alert: PanelAlert; readonly player: PanelPlayer } | null {
  for (const player of panel?.players ?? []) {
    const alert = player.alerts.find((candidate) => candidate.id === alertId);
    if (alert !== undefined) return { alert, player };
  }
  return null;
}

/** The player of the panel with this id (the alert screen shows their name). */
export function findPanelPlayer(
  panel: WeeklyPanel | undefined,
  playerId: string,
): PanelPlayer | null {
  return panel?.players.find((player) => player.playerId === playerId) ?? null;
}
