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

/**
 * Where each alert kind keeps its observed value and the threshold it crossed (`values` of the
 * domain rules engine), and on which side of the threshold it alerts.
 */
const ALERT_MARGINS: Readonly<
  Record<string, { observed: string; threshold: string; direction: 'above' | 'below' }>
> = {
  acwr_high: { observed: 'acwrRatio', threshold: 'thresholdRatio', direction: 'above' },
  acwr_low: { observed: 'acwrRatio', threshold: 'thresholdRatio', direction: 'below' },
  wellness_low: { observed: 'wellnessScore', threshold: 'thresholdScore', direction: 'below' },
  wellness_zscore_low: { observed: 'zScore', threshold: 'thresholdZScore', direction: 'below' },
  cmj_drop: { observed: 'dropPct', threshold: 'thresholdPct', direction: 'above' },
  growth_peak: { observed: 'velocityCmYear', threshold: 'thresholdCmYear', direction: 'above' },
};

/**
 * How far past its threshold an alert is, relative to the threshold (0,53 against an ACWR floor
 * of 0,8 is further than 0,77). 0 when the kind or its values are unknown to this build.
 *
 * A display heuristic only (ADR 0097), not a severity scale: it puts margins of different kinds
 * side by side (a z-score margin against an ACWR margin), which are not the same magnitude. The
 * severity is the rule's own `severity`; this only orders the list within one.
 */
export function alertMargin(alert: {
  readonly kind: string;
  readonly values: Readonly<Record<string, number>>;
}): number {
  const keys = ALERT_MARGINS[alert.kind];
  if (keys === undefined) return 0;
  const observed = alert.values[keys.observed];
  const threshold = alert.values[keys.threshold];
  if (observed === undefined || threshold === undefined) return 0;
  const past = keys.direction === 'above' ? observed - threshold : threshold - observed;
  return Math.max(0, threshold === 0 ? past : past / Math.abs(threshold));
}

/**
 * Players with active alerts, prioritized: critical first; within a severity, the furthest past
 * its threshold (the largest margin among the alerts of that severity); ties keep the roster
 * order (alphabetical).
 */
export function playersNeedingAttention(players: readonly PanelPlayer[]): PanelPlayer[] {
  const ranked = players
    .filter((player) => player.alerts.length > 0)
    .map((player, index) => {
      const severity = worstSeverity(player);
      const margin = Math.max(
        0,
        ...player.alerts.filter((a) => a.severity === severity).map(alertMargin),
      );
      return { player, index, rank: severity === 'critical' ? 0 : 1, margin };
    });
  return ranked
    .sort((a, b) => a.rank - b.rank || b.margin - a.margin || a.index - b.index)
    .map(({ player }) => player);
}
