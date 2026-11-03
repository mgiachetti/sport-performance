import type { Category, PanelPlayer, WeeklyPanel } from '@sport-performance/contracts';
import {
  DEFAULT_PCT_ADULT_HEIGHT_BIO_BANDING,
  DEFAULT_PHV_OFFSET_BIO_BANDING,
  groupByBioBand,
  type AlertSeverity,
  type BioBandScheme,
  type LocalDate,
} from '@sport-performance/domain';

/**
 * The weekly panel as a view over `GET /v1/panel/weekly` (B-403): groups (by
 * category or by maturity, bio-banding), the summary of a group and its load
 * chart. Pure functions over what the API derived: no load or wellness
 * formula is recalculated here, only means of the players of a group.
 */

/** How the panel groups its players: by category, or by maturity with a bio-banding scheme. */
export const PANEL_GROUPINGS = ['category', 'phv_offset', 'pct_adult_height'] as const;
export type PanelGrouping = (typeof PANEL_GROUPINGS)[number];

/** The domain's schemes (B-204): years from PHV, or % of predicted adult height. */
export const BIO_BAND_SCHEMES: Readonly<Record<Exclude<PanelGrouping, 'category'>, BioBandScheme>> =
  {
    phv_offset: DEFAULT_PHV_OFFSET_BIO_BANDING,
    pct_adult_height: DEFAULT_PCT_ADULT_HEIGHT_BIO_BANDING,
  };

/** Group key of the players without a maturity value for the scheme. */
export const UNBANDED_GROUP = 'unbanded';

export type PanelGroupLabel =
  | { readonly kind: 'category'; readonly name: string }
  | { readonly kind: 'band'; readonly code: string }
  | { readonly kind: 'unbanded' };

export interface PanelGroup {
  readonly key: string;
  readonly label: PanelGroupLabel;
  readonly players: readonly PanelPlayer[];
}

/** Maturity value a scheme bands by (the offset projected to the reference day). */
export function maturityValue(player: PanelPlayer, scheme: BioBandScheme): number | null {
  const maturity = player.maturity;
  if (maturity === null) return null;
  return scheme.indicator === 'phv_offset_years'
    ? maturity.phvOffsetYearsOnDate
    : maturity.adultHeightPct;
}

/**
 * The groups of the panel, in a stable order: categories in the club's order
 * (a player in two current categories is in both), or the scheme's bands from
 * least to most mature, then the players without data. Empty groups are left
 * out.
 */
export function panelGroups(
  players: readonly PanelPlayer[],
  grouping: PanelGrouping,
  categories: readonly Pick<Category, 'id' | 'name'>[],
): PanelGroup[] {
  if (grouping === 'category') {
    return categories
      .map((category) => ({
        key: category.id,
        label: { kind: 'category' as const, name: category.name },
        players: players.filter((player) => player.categoryIds.includes(category.id)),
      }))
      .filter((group) => group.players.length > 0);
  }
  const scheme = BIO_BAND_SCHEMES[grouping];
  const { groups, unbanded } = groupByBioBand(players, scheme, (player) =>
    maturityValue(player, scheme),
  );
  const banded: PanelGroup[] = groups.map((group) => ({
    key: group.band.code,
    label: { kind: 'band', code: group.band.code },
    players: group.items,
  }));
  const rest: PanelGroup = { key: UNBANDED_GROUP, label: { kind: 'unbanded' }, players: unbanded };
  return [...banded, rest].filter((group) => group.players.length > 0);
}

/** Worst severity of the player's active alerts on the reference day (dismissed ones never come), or `null`. */
export function worstSeverity(player: PanelPlayer): AlertSeverity | null {
  if (player.alerts.some((alert) => alert.severity === 'critical')) return 'critical';
  return player.alerts.length > 0 ? 'warning' : null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface PanelSummary {
  readonly players: number;
  /** Players that submitted wellness today (current week) or any day of the week (past one). */
  readonly wellnessResponded: number;
  readonly wellnessMeanScore: number | null;
  readonly wellnessPlayers: number;
  readonly loadMeanAu: number | null;
  readonly loadPlayers: number;
  readonly withAlerts: number;
  readonly critical: number;
}

/** Whether the panel's week is the club's current one (it has a "today"). */
export function isCurrentWeek(panel: Pick<WeeklyPanel, 'today' | 'week'>): boolean {
  return panel.week.from <= panel.today && panel.today <= panel.week.to;
}

export function panelSummary(players: readonly PanelPlayer[], currentWeek: boolean): PanelSummary {
  const withWellness = players.filter((player) => player.wellness.weekMeanScore !== null);
  const withLoad = players.filter((player) => player.load.weeks.at(-1)?.hasData === true);
  const severities = players.map(worstSeverity);
  return {
    players: players.length,
    wellnessResponded: players.filter((player) =>
      currentWeek ? player.wellness.submittedToday : player.wellness.weekEntries > 0,
    ).length,
    wellnessMeanScore: mean(withWellness.map((player) => player.wellness.weekMeanScore ?? 0)),
    wellnessPlayers: withWellness.length,
    loadMeanAu: mean(withLoad.map((player) => player.load.weekLoadAu)),
    loadPlayers: withLoad.length,
    withAlerts: severities.filter((severity) => severity !== null).length,
    critical: severities.filter((severity) => severity === 'critical').length,
  };
}

export interface WeeklyLoadPoint {
  readonly from: LocalDate;
  /** Mean sRPE of the players with load that week (UA); `null` when nobody had load. */
  readonly meanLoadAu: number | null;
  /** Mean weekly-equivalent chronic load of the players with history; `null` without any. */
  readonly meanChronicWeeklyAu: number | null;
}

/** The group's load per week of the panel, oldest first. */
export function weeklyLoadSeries(
  weeks: WeeklyPanel['weeks'],
  players: readonly PanelPlayer[],
): WeeklyLoadPoint[] {
  return weeks.map((week, index) => {
    const loads = players.flatMap((player) => {
      const value = player.load.weeks[index];
      return value?.hasData === true ? [value.loadAu] : [];
    });
    const chronic = players.flatMap((player) => {
      const value = player.load.weeks[index]?.chronicWeeklyAu;
      return value === null || value === undefined ? [] : [value];
    });
    return { from: week.from, meanLoadAu: mean(loads), meanChronicWeeklyAu: mean(chronic) };
  });
}

/** Players with active alerts, critical first, otherwise in roster order (alphabetical). */
export function playersNeedingAttention(players: readonly PanelPlayer[]): PanelPlayer[] {
  const rank = (player: PanelPlayer) => (worstSeverity(player) === 'critical' ? 0 : 1);
  return players
    .filter((player) => player.alerts.length > 0)
    .map((player, index) => ({ player, index }))
    .sort((a, b) => rank(a.player) - rank(b.player) || a.index - b.index)
    .map(({ player }) => player);
}
