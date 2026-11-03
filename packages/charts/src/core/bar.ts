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
import { BAR_MAX_WIDTH_PX, barPath, linePath, type Point, type Rect } from './geometry.js';
import { statusLabel } from './status.js';
import { estimateTextWidth, visibleLabelIndexes } from './text.js';
import type {
  AxisTick,
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
 * Fill of a bar: the club's brand color or grey. Two groups at most (match / training, forwards /
 * backs), named in the legend so the group never depends on color alone.
 */
export type BarTone = 'brand' | 'neutral';

export interface BarDatum {
  readonly key: string;
  /** X label (`S44`, `12`), already formatted. */
  readonly label: string;
  /** Longer name for the tooltip and the table (`Semana 44`, `Tomás Pérez`). Defaults to `label`. */
  readonly name?: string | undefined;
  readonly value: number | null;
  readonly tone?: BarTone | undefined;
  readonly status?: StatusLevel | null | undefined;
}

/** A line over the bars on the same axis (for example, the chronic load). Drawn in grey. */
export interface BarOverlay {
  readonly label: string;
  readonly values: readonly (number | null)[];
}

export interface BarChartSpec extends ChartSpecBase {
  readonly bars: readonly BarDatum[];
  /** Legend names of the tones in use (`{ brand: 'Partido', neutral: 'Entrenamiento' }`). */
  readonly tones?: Partial<Record<BarTone, string>> | undefined;
  /** Name of the value in the tooltip and table when there are no tones. Default "Valor". */
  readonly valueLabel?: string | undefined;
  readonly overlay?: BarOverlay | undefined;
  readonly reference?: ChartReference | undefined;
  /**
   * Which bar gets a direct value label: the last one (default), the highest, or none. Never
   * every bar: the axis, tooltip and table carry the rest.
   */
  readonly directLabel?: 'last' | 'max' | 'none' | undefined;
}

export interface BarLayout {
  readonly index: number;
  readonly key: string;
  readonly tone: BarTone;
  readonly value: number | null;
  readonly x: number;
  readonly width: number;
  /** Center of the bar (labels, tooltip anchor). */
  readonly center: number;
  /** Pixel of the data end. */
  readonly valueY: number;
  readonly path: string;
  readonly status?: StatusLevel | undefined;
}

export interface DirectLabel {
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export interface StatusMark {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly level: StatusLevel;
}

export interface BarChartLayout {
  readonly width: number;
  readonly height: number;
  readonly empty: boolean;
  readonly plot: Rect;
  readonly baselineY: number;
  readonly yTicks: readonly AxisTick[];
  readonly xTicks: readonly AxisTick[];
  readonly bars: readonly BarLayout[];
  readonly overlay?: { readonly path: string; readonly points: readonly Point[] } | undefined;
  readonly reference?: ReferenceLayout | undefined;
  readonly directLabels: readonly DirectLabel[];
  readonly statusMarks: readonly StatusMark[];
  readonly columns: readonly HitColumn[];
}

const MARGIN = { top: 10, right: 8, bottom: 26 } as const;

function isFiniteValue(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function hasValues(spec: BarChartSpec): boolean {
  return (
    spec.bars.some((bar) => isFiniteValue(bar.value)) ||
    (spec.overlay?.values.some(isFiniteValue) ?? false)
  );
}

function directLabelIndex(spec: BarChartSpec): number {
  const mode = spec.directLabel ?? 'last';
  if (mode === 'none') return -1;
  let found = -1;
  spec.bars.forEach((bar, index) => {
    if (!isFiniteValue(bar.value)) return;
    if (mode === 'last') found = index;
    else if (found === -1 || bar.value > (spec.bars[found]?.value ?? -Infinity)) found = index;
  });
  return found;
}

/** Geometry of a column chart: bars from one baseline (zero), one value axis. */
export function layoutBarChart(
  spec: BarChartSpec,
  size: ChartSize,
  options?: LayoutOptions,
): BarChartLayout {
  checkSize(size.width, size.height);
  if (spec.overlay !== undefined) {
    checkLength('overlay', spec.overlay.values.length, spec.bars.length);
  }
  const { t } = translatorOf(options);
  const { width, height } = size;
  if (!hasValues(spec)) {
    return {
      width,
      height,
      empty: true,
      plot: { x: 0, y: 0, width, height },
      baselineY: height,
      yTicks: [],
      xTicks: [],
      bars: [],
      directLabels: [],
      statusMarks: [],
      columns: [],
    };
  }

  const labelIndex = directLabelIndex(spec);
  const flagged = spec.bars.some((bar) => bar.status === 'warning' || bar.status === 'critical');
  const top = MARGIN.top + (labelIndex >= 0 ? LABEL_LINE_PX : 0) + (flagged ? LABEL_LINE_PX : 0);
  const bottom = height - MARGIN.bottom;
  const values = [
    ...spec.bars.map((bar) => bar.value).filter(isFiniteValue),
    ...(spec.overlay?.values.filter(isFiniteValue) ?? []),
    ...(spec.reference === undefined ? [] : [spec.reference.value]),
  ];
  const axis = valueAxis(values, { includeZero: true, top, bottom });
  const plot: Rect = {
    x: axis.labelWidth,
    y: top,
    width: Math.max(1, width - axis.labelWidth - MARGIN.right),
    height: Math.max(1, bottom - top),
  };
  const baselineY = axis.scale(0);
  const count = spec.bars.length;
  const slot = plot.width / Math.max(1, count);
  // Adjacent bars keep at least a 2 px surface gap; thick bars are capped and leave air.
  const barWidth = Math.max(1, Math.min(BAR_MAX_WIDTH_PX, slot * 0.7, slot - 2));
  const centers = spec.bars.map((_, index) => plot.x + slot * (index + 0.5));

  const bars = spec.bars.map((bar, index): BarLayout => {
    const center = centers[index] ?? 0;
    const x = center - barWidth / 2;
    const value = isFiniteValue(bar.value) ? bar.value : null;
    const valueY = value === null ? baselineY : axis.scale(value);
    const status = bar.status ?? undefined;
    return {
      index,
      key: bar.key,
      tone: bar.tone ?? 'brand',
      value,
      x,
      width: barWidth,
      center,
      valueY,
      path: value === null ? '' : barPath({ x, width: barWidth, baselineY, valueY }),
      ...(status === undefined ? {} : { status }),
    };
  });

  const directLabels: DirectLabel[] = [];
  const labelled = bars[labelIndex];
  if (labelled !== undefined && labelled.value !== null) {
    const positive = labelled.value >= 0;
    directLabels.push({
      x: labelled.center,
      y: positive ? labelled.valueY - 6 : labelled.valueY + LABEL_LINE_PX,
      text: formatValue(labelled.value, spec.format),
    });
  }

  const statusMarks: StatusMark[] = bars.flatMap((bar) => {
    if (bar.status !== 'warning' && bar.status !== 'critical') return [];
    const positive = (bar.value ?? 0) >= 0;
    const lift = bar.index === labelIndex ? LABEL_LINE_PX : 0;
    const y = positive ? bar.valueY - 10 - lift : bar.valueY + 10 + lift;
    return [{ index: bar.index, x: bar.center, y, level: bar.status }];
  });

  let overlay: BarChartLayout['overlay'];
  if (spec.overlay !== undefined) {
    const points: (Point | null)[] = spec.overlay.values.map((value, index) =>
      isFiniteValue(value) ? { x: centers[index] ?? 0, y: axis.scale(value) } : null,
    );
    overlay = {
      path: linePath(points),
      points: points.filter((point): point is Point => point !== null),
    };
  }

  const labels = spec.bars.map((bar) => bar.label);
  const xTicks = visibleLabelIndexes(centers, labels).map((index) => ({
    value: index,
    position: centers[index] ?? 0,
    label: labels[index] ?? '',
  }));

  const reference =
    spec.reference === undefined
      ? undefined
      : referenceLayout(
          axis.scale(spec.reference.value),
          plot,
          referenceText(t, spec.reference, spec.format),
          [
            ...bars
              .filter((bar) => bar.value !== null)
              .map((bar) => ({
                x: bar.x,
                y: Math.min(bar.valueY, baselineY),
                width: bar.width,
                height: Math.abs(baselineY - bar.valueY),
              })),
            ...(overlay?.points.map((point) => pointArea(point, 4)) ?? []),
            ...directLabels.map((label) => {
              const width = estimateTextWidth(label.text);
              return { x: label.x - width / 2, y: label.y - 12, width, height: 14 };
            }),
          ],
        );

  return {
    width,
    height,
    empty: false,
    plot,
    baselineY,
    yTicks: axis.ticks,
    xTicks,
    bars,
    overlay,
    reference,
    directLabels,
    statusMarks,
    columns: centers.map((x, index) => ({
      index,
      x,
      x0: plot.x + slot * index,
      x1: plot.x + slot * (index + 1),
    })),
  };
}

function tonesInUse(spec: BarChartSpec): BarTone[] {
  const used = new Set(spec.bars.map((bar) => bar.tone ?? 'brand'));
  return (['brand', 'neutral'] as const).filter(
    (tone) => used.has(tone) && spec.tones?.[tone] !== undefined,
  );
}

export function barChartLegend(spec: BarChartSpec, options?: LayoutOptions): LegendItem[] {
  const { t } = translatorOf(options);
  const items: LegendItem[] = tonesInUse(spec).map((tone) => ({
    key: tone,
    label: spec.tones?.[tone] ?? '',
  }));
  if (spec.overlay !== undefined) items.push({ key: 'overlay', label: spec.overlay.label });
  if (spec.reference !== undefined) {
    items.push({ key: 'reference', label: referenceText(t, spec.reference, spec.format) });
  }
  return items;
}

function valueName(spec: BarChartSpec, bar: BarDatum, t: (key: 'chart.table.value') => string) {
  const tone = bar.tone ?? 'brand';
  return spec.tones?.[tone] ?? spec.valueLabel ?? t('chart.table.value');
}

export function barChartReadout(
  spec: BarChartSpec,
  index: number,
  options?: LayoutOptions,
): Readout {
  const { t } = translatorOf(options);
  const bar = spec.bars[index];
  if (bar === undefined) return { title: '', rows: [] };
  const status = bar.status ?? undefined;
  const rows: ReadoutRow[] = [
    {
      key: bar.tone ?? 'brand',
      label: valueName(spec, bar, t),
      text: isFiniteValue(bar.value) ? formatValue(bar.value, spec.format) : t('chart.noValue'),
      ...(status === undefined ? {} : { status }),
    },
  ];
  if (spec.overlay !== undefined) {
    const value = spec.overlay.values[index] ?? null;
    rows.push({
      key: 'overlay',
      label: spec.overlay.label,
      text: isFiniteValue(value) ? formatValue(value, spec.format) : t('chart.noValue'),
    });
  }
  if (spec.reference !== undefined) {
    rows.push({
      key: 'reference',
      label: spec.reference.label ?? t('chart.reference.firstTeam'),
      text: formatValue(spec.reference.value, spec.format),
    });
  }
  return { title: bar.name ?? bar.label, rows };
}

export function barChartTable(spec: BarChartSpec, options?: LayoutOptions): ChartTable {
  const { t } = translatorOf(options);
  const tones = tonesInUse(spec);
  const hasStatus = spec.bars.some((bar) => bar.status !== null && bar.status !== undefined);
  const columns: ChartTableColumn[] = [
    { key: 'value', label: spec.valueLabel ?? t('chart.table.value'), numeric: true },
  ];
  if (tones.length > 0)
    columns.push({ key: 'group', label: t('chart.table.group'), numeric: false });
  if (spec.overlay !== undefined) {
    columns.push({ key: 'overlay', label: spec.overlay.label, numeric: true });
  }
  if (spec.reference !== undefined) {
    columns.push({
      key: 'reference',
      label: spec.reference.label ?? t('chart.reference.firstTeam'),
      numeric: true,
    });
  }
  if (hasStatus) columns.push({ key: 'status', label: t('chart.table.status'), numeric: false });

  return {
    caption: t('chart.table.caption', { title: spec.title }),
    rowHeader: t('chart.table.item'),
    columns,
    rows: spec.bars.map((bar, index) => {
      const status = bar.status ?? undefined;
      return {
        key: bar.key,
        header: bar.name ?? bar.label,
        cells: [
          { text: formatValue(bar.value, spec.format) },
          ...(tones.length > 0 ? [{ text: spec.tones?.[bar.tone ?? 'brand'] ?? '' }] : []),
          ...(spec.overlay === undefined
            ? []
            : [{ text: formatValue(spec.overlay.values[index], spec.format) }]),
          ...(spec.reference === undefined
            ? []
            : [{ text: formatValue(spec.reference.value, spec.format) }]),
          ...(hasStatus
            ? [status === undefined ? { text: '' } : { text: statusLabel(t, status), status }]
            : []),
        ],
      };
    }),
  };
}

export function barChartSummary(spec: BarChartSpec, options?: LayoutOptions): string {
  const { t } = translatorOf(options);
  if (!hasValues(spec)) return t('chart.summary.empty', { title: spec.title });
  const parts = [spec.title + '.'];
  let max: { bar: BarDatum; value: number } | undefined;
  let min: { bar: BarDatum; value: number } | undefined;
  let valued = 0;
  for (const bar of spec.bars) {
    if (!isFiniteValue(bar.value)) continue;
    valued += 1;
    if (max === undefined || bar.value > max.value) max = { bar, value: bar.value };
    if (min === undefined || bar.value < min.value) min = { bar, value: bar.value };
  }
  if (max !== undefined && min !== undefined) {
    parts.push(
      t('chart.summary.bars', {
        count: valued,
        max: formatValue(max.value, spec.format),
        maxLabel: max.bar.name ?? max.bar.label,
        min: formatValue(min.value, spec.format),
        minLabel: min.bar.name ?? min.bar.label,
      }),
    );
  }
  if (spec.overlay !== undefined) {
    parts.push(
      seriesSummary(
        t,
        spec.overlay.label,
        spec.overlay.values,
        spec.bars.map((bar) => ({ label: bar.name ?? bar.label })),
        spec.format,
      ),
    );
  }
  if (spec.reference !== undefined) {
    parts.push(
      t('chart.summary.reference', {
        label: spec.reference.label ?? t('chart.reference.firstTeam'),
        value: formatValue(spec.reference.value, spec.format),
      }),
    );
  }
  const flagged = spec.bars.filter(
    (bar) => bar.status === 'warning' || bar.status === 'critical',
  ).length;
  if (flagged > 0) parts.push(t('chart.summary.status', { count: flagged }));
  return parts.join(' ');
}

export function barChartReadoutText(
  spec: BarChartSpec,
  index: number,
  options?: LayoutOptions,
): string {
  return readoutText(translatorOf(options).t, barChartReadout(spec, index, options));
}
