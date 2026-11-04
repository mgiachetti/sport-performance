import type {
  FieldMetricColumn,
  FieldSession,
  FieldSessionPlayer,
  FieldSessionReference,
  FieldSessionRules,
} from '@sport-performance/contracts';
import { RUGBY_LINE_CODES, type FieldMetricSource } from '@sport-performance/domain';

/**
 * What the field session view (B-408, ADR 0061) derives from the one
 * response of `GET /v1/training-sessions/{id}/field-metrics`: columns,
 * summary cards and the bars of a metric. Pure functions over a bounded
 * payload (the players of one session); every value keeps its source and
 * nothing here mixes two sources (principle 4).
 */

export type ColumnKey = `${string}:${FieldMetricSource}`;

export interface ViewColumn extends FieldMetricColumn {
  readonly key: ColumnKey;
  /** The same metric also comes from another source: the header names the source. */
  readonly sharedMetric: boolean;
}

export function columnKey(column: Pick<FieldMetricColumn, 'metricCode' | 'source'>): ColumnKey {
  return `${column.metricCode}:${column.source}`;
}

/** The API's columns (already in dictionary order), flagged when a metric has several sources. */
export function viewColumns(view: Pick<FieldSession, 'columns'>): ViewColumn[] {
  const perMetric = new Map<string, number>();
  for (const c of view.columns) perMetric.set(c.metricCode, (perMetric.get(c.metricCode) ?? 0) + 1);
  return view.columns.map((c) => ({
    ...c,
    key: columnKey(c),
    sharedMetric: (perMetric.get(c.metricCode) ?? 0) > 1,
  }));
}

/** Metrics measured by more than one source, and those sources: the mixed-source warning. */
export function mixedSources(
  columns: readonly ViewColumn[],
): { metricCodes: string[]; sources: FieldMetricSource[] } | null {
  const shared = columns.filter((c) => c.sharedMetric);
  if (shared.length === 0) return null;
  return {
    metricCodes: [...new Set(shared.map((c) => c.metricCode))],
    sources: [...new Set(shared.map((c) => c.source))],
  };
}

/** Sources present, in the order of the columns. */
export function sourcesOf(
  columns: readonly Pick<FieldMetricColumn, 'source'>[],
): FieldMetricSource[] {
  return [...new Set(columns.map((c) => c.source))];
}

export function valueOf(
  player: Pick<FieldSessionPlayer, 'values'>,
  column: Pick<FieldMetricColumn, 'metricCode' | 'source'>,
): number | null {
  return (
    player.values.find((v) => v.metricCode === column.metricCode && v.source === column.source)
      ?.value ?? null
  );
}

export type KpiAggregate = 'mean' | 'max' | 'sum';

/** The summary cards of the maqueta, in order: only those whose metric the session has. */
export const KPI_SPECS = [
  { metricCode: 'dist_m', aggregate: 'mean' },
  { metricCode: 'hsr_abs_m', aggregate: 'mean' },
  { metricCode: 'vmax_ms', aggregate: 'max' },
  { metricCode: 'contacts_n', aggregate: 'sum' },
] as const satisfies readonly { metricCode: string; aggregate: KpiAggregate }[];

export type KpiMetric = (typeof KPI_SPECS)[number]['metricCode'];

export interface Kpi {
  readonly metricCode: KpiMetric;
  readonly aggregate: KpiAggregate;
  readonly column: ViewColumn;
  readonly value: number;
  /** Players with a value. */
  readonly count: number;
  /** For `max`: who reached it. */
  readonly leader: FieldSessionPlayer | null;
}

/**
 * Summary cards. A metric from several sources is summarised from its first
 * source (dictionary order of sources), never from a blend; the card says
 * which source it is. The contacts card is only for sports that record
 * contacts (`fieldRules`, B-803): a hockey session never shows it.
 */
export function sessionKpis(
  view: Pick<FieldSession, 'players'> & { fieldRules?: Pick<FieldSessionRules, 'recordsContacts'> },
  columns: readonly ViewColumn[],
): Kpi[] {
  const kpis: Kpi[] = [];
  for (const spec of KPI_SPECS) {
    if (spec.metricCode === 'contacts_n' && view.fieldRules?.recordsContacts === false) continue;
    const column = columns.find((c) => c.metricCode === spec.metricCode);
    if (column === undefined) continue;
    const entries = view.players.flatMap((player) => {
      const value = valueOf(player, column);
      return value === null ? [] : [{ player, value }];
    });
    if (entries.length === 0) continue;
    let value: number;
    let leader: FieldSessionPlayer | null = null;
    if (spec.aggregate === 'max') {
      const best = entries.reduce((a, b) => (b.value > a.value ? b : a));
      value = best.value;
      leader = best.player;
    } else {
      const total = entries.reduce((sum, e) => sum + e.value, 0);
      value = spec.aggregate === 'sum' ? total : total / entries.length;
    }
    kpis.push({
      metricCode: spec.metricCode,
      aggregate: spec.aggregate,
      column,
      value,
      count: entries.length,
      leader,
    });
  }
  return kpis;
}

export type RugbyLine = (typeof RUGBY_LINE_CODES)[number];

export interface PlayerBar {
  readonly player: FieldSessionPlayer;
  readonly value: number;
  readonly line: RugbyLine | null;
}

function rugbyLine(player: FieldSessionPlayer): RugbyLine | null {
  const line = player.position?.lineCode ?? null;
  return (RUGBY_LINE_CODES as readonly (string | null)[]).includes(line)
    ? (line as RugbyLine)
    : null;
}

/** Players with a value of the column, highest first (ties by name, as the API sorts). */
export function playerBars(
  view: Pick<FieldSession, 'players'>,
  column: Pick<FieldMetricColumn, 'metricCode' | 'source'>,
): PlayerBar[] {
  return view.players
    .flatMap((player) => {
      const value = valueOf(player, column);
      return value === null ? [] : [{ player, value, line: rugbyLine(player) }];
    })
    .sort((a, b) => b.value - a.value);
}

/**
 * Whether the bars can be told apart by line (maqueta: backs in the brand
 * color, forwards in grey, named in the legend): only when every bar is a
 * rugby forward or back. Otherwise one tone, so a missing position never
 * reads as a group.
 */
export function splitByLine(bars: readonly PlayerBar[]): boolean {
  return bars.length > 0 && bars.every((bar) => bar.line !== null);
}

export function referenceOf(
  view: Pick<FieldSession, 'references'>,
  metricCode: string,
): FieldSessionReference | null {
  return view.references.find((r) => r.metricCode === metricCode) ?? null;
}
