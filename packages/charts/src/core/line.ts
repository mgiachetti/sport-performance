import type { StatusLevel } from '@sport-performance/ui-tokens';
import {
  LABEL_LINE_PX,
  pointArea,
  checkLength,
  checkSize,
  readoutText,
  referenceLayout,
  referenceText,
  seriesSummary,
  translatorOf,
  valueAxis,
} from './common.js';
import { formatValue } from './format.js';
import { linePath, type Point, type Rect } from './geometry.js';
import { statusLabel } from './status.js';
import { visibleLabelIndexes } from './text.js';
import type {
  AxisTick,
  ChartCategory,
  ChartReference,
  ChartSize,
  ChartSpecBase,
  ChartTable,
  ChartTableColumn,
  HitColumn,
  LayoutOptions,
  LegendItem,
  Readout,
  ReadoutRow,
  ReferenceLayout,
} from './types.js';

/**
 * What a line stands for. The role fixes its look: the player in the club's brand color, the
 * category average in grey. A chart has at most one series per role.
 */
export type LineSeriesRole = 'player' | 'categoryAverage';

export const LINE_SERIES_ROLES: readonly LineSeriesRole[] = ['player', 'categoryAverage'];

export interface LineSeries {
  readonly id: string;
  /** Name in the legend, tooltip and table (`Tomás`, `Promedio M17`). */
  readonly label: string;
  readonly role: LineSeriesRole;
  /** One value per category; `null` when missing (the line breaks there). */
  readonly values: readonly (number | null)[];
  /** Optional state of each value, shown with icon + text (never color alone). */
  readonly statuses?: readonly (StatusLevel | null | undefined)[] | undefined;
}

export interface LineChartSpec extends ChartSpecBase {
  readonly categories: readonly ChartCategory[];
  readonly series: readonly LineSeries[];
  readonly reference?: ChartReference | undefined;
}

export interface LinePointLayout extends Point {
  readonly index: number;
  readonly value: number;
  readonly status?: StatusLevel | undefined;
}

export interface LineSeriesLayout {
  readonly id: string;
  readonly role: LineSeriesRole;
  readonly label: string;
  readonly path: string;
  readonly points: readonly LinePointLayout[];
}

export interface LineChartLayout {
  readonly width: number;
  readonly height: number;
  readonly empty: boolean;
  readonly plot: Rect;
  readonly yTicks: readonly AxisTick[];
  readonly xTicks: readonly AxisTick[];
  /** Grey first, player last: the player's line is drawn on top. */
  readonly series: readonly LineSeriesLayout[];
  readonly reference?: ReferenceLayout | undefined;
  readonly columns: readonly HitColumn[];
}

const MARGIN = { top: 12, right: 12, bottom: 26 } as const;
/** Extra room on top for the status glyphs drawn above points. */
const STATUS_ROOM_PX = 16;

function validate(spec: LineChartSpec): void {
  const roles = new Set<LineSeriesRole>();
  for (const series of spec.series) {
    if (roles.has(series.role)) {
      throw new RangeError(`more than one series with role ${series.role}`);
    }
    roles.add(series.role);
    checkLength(`series ${series.id}`, series.values.length, spec.categories.length);
    if (series.statuses !== undefined) {
      checkLength(`statuses of ${series.id}`, series.statuses.length, spec.categories.length);
    }
  }
}

function hasValues(spec: LineChartSpec): boolean {
  return spec.series.some((series) =>
    series.values.some((value) => value !== null && Number.isFinite(value)),
  );
}

/** Legend, tooltip and table order: player first. */
function inLegendOrder(series: readonly LineSeries[]): LineSeries[] {
  return [...series].sort(
    (a, b) => LINE_SERIES_ROLES.indexOf(a.role) - LINE_SERIES_ROLES.indexOf(b.role),
  );
}

/** Draw order: grey below, brand on top. */
function ordered(series: readonly LineSeries[]): LineSeries[] {
  return inLegendOrder(series).reverse();
}

/** X pixel of each category: evenly spaced, first and last on the plot edges. */
export function pointPositions(count: number, plot: Rect): number[] {
  if (count === 1) return [plot.x + plot.width / 2];
  return Array.from({ length: count }, (_, i) => plot.x + (i * plot.width) / (count - 1));
}

export function hitColumns(positions: readonly number[], plot: Rect): HitColumn[] {
  return positions.map((x, index) => ({
    index,
    x,
    x0: index === 0 ? plot.x : (x + (positions[index - 1] ?? x)) / 2,
    x1:
      index === positions.length - 1 ? plot.x + plot.width : (x + (positions[index + 1] ?? x)) / 2,
  }));
}

/**
 * Geometry of a line chart, pure and platform-free (the web and mobile renderers draw it as is).
 * One value axis, the domain covering every series and the reference.
 */
export function layoutLineChart(
  spec: LineChartSpec,
  size: ChartSize,
  options?: LayoutOptions,
): LineChartLayout {
  checkSize(size.width, size.height);
  validate(spec);
  const { t } = translatorOf(options);
  const { width, height } = size;

  if (!hasValues(spec)) {
    return {
      width,
      height,
      empty: true,
      plot: { x: 0, y: 0, width, height },
      yTicks: [],
      xTicks: [],
      series: [],
      columns: [],
    };
  }

  const hasStatus = spec.series.some((series) =>
    series.statuses?.some((status) => status === 'warning' || status === 'critical'),
  );
  const top = MARGIN.top + (hasStatus ? STATUS_ROOM_PX : 0);
  const bottom = height - MARGIN.bottom;
  const values: number[] = [];
  for (const series of spec.series) {
    for (const value of series.values) {
      if (value !== null && Number.isFinite(value)) values.push(value);
    }
  }
  if (spec.reference !== undefined) values.push(spec.reference.value);
  const axis = valueAxis(values, { includeZero: false, top, bottom });

  const plot: Rect = {
    x: axis.labelWidth,
    y: top,
    width: Math.max(1, width - axis.labelWidth - MARGIN.right),
    height: Math.max(1, bottom - top),
  };
  const xs = pointPositions(spec.categories.length, plot);
  const labels = spec.categories.map((category) => category.label);
  const xTicks = visibleLabelIndexes(xs, labels).map((index) => ({
    value: index,
    position: xs[index] ?? 0,
    label: labels[index] ?? '',
  }));

  const series = ordered(spec.series).map((item): LineSeriesLayout => {
    const points: LinePointLayout[] = [];
    const path = linePath(
      item.values.map((value, index) => {
        if (value === null || !Number.isFinite(value)) return null;
        const status = item.statuses?.[index] ?? undefined;
        const point = {
          index,
          value,
          x: xs[index] ?? 0,
          y: axis.scale(value),
          ...(status === undefined ? {} : { status }),
        };
        points.push(point);
        return point;
      }),
    );
    return { id: item.id, role: item.role, label: item.label, path, points };
  });

  const reference =
    spec.reference === undefined
      ? undefined
      : referenceLayout(
          axis.scale(spec.reference.value),
          plot,
          referenceText(t, spec.reference, spec.format),
          series.flatMap((item) => item.points.map((point) => pointArea(point))),
        );

  return {
    width,
    height,
    empty: false,
    plot,
    yTicks: axis.ticks,
    xTicks,
    series,
    reference,
    columns: hitColumns(xs, plot),
  };
}

/** Status glyph offset above a point. */
export const STATUS_GLYPH_OFFSET_PX = LABEL_LINE_PX;

/** Legend entries: player first, then the average, then the reference. */
export function lineChartLegend(spec: LineChartSpec, options?: LayoutOptions): LegendItem[] {
  const { t } = translatorOf(options);
  const items: LegendItem[] = inLegendOrder(spec.series).map((series) => ({
    key: series.role,
    label: series.label,
  }));
  if (spec.reference !== undefined) {
    items.push({
      key: 'reference',
      label: referenceText(t, spec.reference, spec.format),
    });
  }
  return items;
}

/** Tooltip content at one category: every series (missing ones say "Sin dato"). */
export function lineChartReadout(
  spec: LineChartSpec,
  index: number,
  options?: LayoutOptions,
): Readout {
  const { t } = translatorOf(options);
  const rows: ReadoutRow[] = inLegendOrder(spec.series).map((series) => {
    const value = series.values[index] ?? null;
    const status = series.statuses?.[index] ?? undefined;
    return {
      key: series.role,
      label: series.label,
      text: value === null ? t('chart.noValue') : formatValue(value, spec.format),
      ...(status === undefined ? {} : { status }),
    };
  });
  if (spec.reference !== undefined) {
    rows.push({
      key: 'reference',
      label: spec.reference.label ?? t('chart.reference.firstTeam'),
      text: formatValue(spec.reference.value, spec.format),
    });
  }
  return { title: spec.categories[index]?.label ?? '', rows };
}

/** The alternative table: one row per category, one column per series (+ reference, states). */
export function lineChartTable(spec: LineChartSpec, options?: LayoutOptions): ChartTable {
  const { t } = translatorOf(options);
  const series = inLegendOrder(spec.series);
  const withStatus = series.filter(
    (item) => item.statuses?.some((s) => s !== null && s !== undefined) === true,
  );
  const columns: ChartTableColumn[] = series.map((item) => ({
    key: item.id,
    label: item.label,
    numeric: true,
  }));
  if (spec.reference !== undefined) {
    columns.push({
      key: 'reference',
      label: spec.reference.label ?? t('chart.reference.firstTeam'),
      numeric: true,
    });
  }
  for (const item of withStatus) {
    columns.push({
      key: `${item.id}:status`,
      label:
        withStatus.length === 1
          ? t('chart.table.status')
          : `${t('chart.table.status')} (${item.label})`,
      numeric: false,
    });
  }
  return {
    caption: t('chart.table.caption', { title: spec.title }),
    rowHeader: t('chart.table.item'),
    columns,
    rows: spec.categories.map((category, index) => ({
      key: category.key,
      header: category.label,
      cells: [
        ...series.map((item) => ({ text: formatValue(item.values[index], spec.format) })),
        ...(spec.reference === undefined
          ? []
          : [{ text: formatValue(spec.reference.value, spec.format) }]),
        ...withStatus.map((item) => {
          const status = item.statuses?.[index] ?? undefined;
          return status === undefined ? { text: '' } : { text: statusLabel(t, status), status };
        }),
      ],
    })),
  };
}

/** Accessible summary (the `aria-label` of the drawing). */
export function lineChartSummary(spec: LineChartSpec, options?: LayoutOptions): string {
  const { t } = translatorOf(options);
  if (!hasValues(spec)) return t('chart.summary.empty', { title: spec.title });
  const parts = [spec.title + '.'];
  for (const series of inLegendOrder(spec.series)) {
    parts.push(seriesSummary(t, series.label, series.values, spec.categories, spec.format));
  }
  if (spec.reference !== undefined) {
    parts.push(
      t('chart.summary.reference', {
        label: spec.reference.label ?? t('chart.reference.firstTeam'),
        value: formatValue(spec.reference.value, spec.format),
      }),
    );
  }
  const flagged = spec.series.reduce(
    (count, series) =>
      count + (series.statuses?.filter((s) => s === 'warning' || s === 'critical').length ?? 0),
    0,
  );
  if (flagged > 0) parts.push(t('chart.summary.status', { count: flagged }));
  return parts.join(' ');
}

/** The readout at `index` as a sentence, for the live region. */
export function lineChartReadoutText(
  spec: LineChartSpec,
  index: number,
  options?: LayoutOptions,
): string {
  return readoutText(translatorOf(options).t, lineChartReadout(spec, index, options));
}
