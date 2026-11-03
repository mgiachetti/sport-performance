import { checkLength, checkSize, readoutText, translatorOf } from './common.js';
import { formatValue } from './format.js';
import type { Rect } from './geometry.js';
import { extent } from './scale.js';
import { LABEL_FONT_PX, estimateTextWidth, visibleLabelIndexes } from './text.js';
import type {
  AxisTick,
  ChartCategory,
  ChartSize,
  ChartSpecBase,
  ChartTable,
  LayoutOptions,
  Readout,
} from './types.js';

/**
 * Grid of values (rows × columns): wellness per player and day, time per pitch zone. Magnitude
 * is a sequential scale of one hue (the brand), in steps named in the legend.
 */
export interface HeatmapSpec extends ChartSpecBase {
  readonly rows: readonly ChartCategory[];
  readonly columns: readonly ChartCategory[];
  /** `values[row][column]`; `null` when missing. */
  readonly values: readonly (readonly (number | null)[])[];
  /** Fixed scale bounds (wellness 1–5); defaults to the data extent. */
  readonly domain?: readonly [number, number] | undefined;
  /** Number of color steps, 2–9. Default 5. */
  readonly steps?: number | undefined;
  /** Writes the value inside each cell when it fits. Default `false` (tooltip and table have it). */
  readonly showValues?: boolean | undefined;
}

export interface HeatmapBin {
  readonly step: number;
  readonly from: number;
  readonly to: number;
  /** Opacity of the brand fill, 0–1, growing with the value. */
  readonly intensity: number;
  readonly label: string;
}

export interface HeatmapCell extends Rect {
  readonly row: number;
  readonly column: number;
  readonly value: number | null;
  /** Index into `bins`, `null` for a missing value. */
  readonly step: number | null;
  readonly text: string;
  readonly showText: boolean;
}

export interface HeatmapLayout {
  readonly width: number;
  readonly height: number;
  readonly empty: boolean;
  readonly plot: Rect;
  readonly rowLabels: readonly AxisTick[];
  readonly columnLabels: readonly AxisTick[];
  readonly cells: readonly HeatmapCell[];
  readonly bins: readonly HeatmapBin[];
}

const DEFAULT_STEPS = 5;
/** Gap between cells, in the surface color. */
export const HEATMAP_GAP_PX = 2;
const COLUMN_LABEL_ROOM_PX = LABEL_FONT_PX + 8;

function checkSpec(spec: HeatmapSpec): number {
  const steps = spec.steps ?? DEFAULT_STEPS;
  if (!Number.isInteger(steps) || steps < 2 || steps > 9) {
    throw new RangeError(`heatmap steps must be an integer from 2 to 9, got ${String(steps)}`);
  }
  checkLength('heatmap rows', spec.values.length, spec.rows.length);
  spec.values.forEach((row, index) => {
    checkLength(`heatmap row ${String(index)}`, row.length, spec.columns.length);
  });
  if (spec.domain !== undefined && !(spec.domain[0] < spec.domain[1])) {
    throw new RangeError('heatmap domain must be increasing');
  }
  return steps;
}

function domainOf(spec: HeatmapSpec): [number, number] | null {
  if (spec.domain !== undefined) return [spec.domain[0], spec.domain[1]];
  return extent(spec.values.flat());
}

/** Equal-width bins over the domain; the lightest step still shows on the surface. */
export function heatmapBins(spec: HeatmapSpec, options?: LayoutOptions): HeatmapBin[] {
  const { t } = translatorOf(options);
  const steps = checkSpec(spec);
  const domain = domainOf(spec);
  if (domain === null) return [];
  const [min, max] = domain;
  const width = (max - min) / steps;
  return Array.from({ length: steps }, (_, step) => {
    const from = min + width * step;
    const to = step === steps - 1 ? max : min + width * (step + 1);
    return {
      step,
      from,
      to,
      intensity: 0.2 + (0.8 * step) / (steps - 1),
      label: t('chart.heatmap.bin', {
        from: formatValue(from, spec.format),
        to: formatValue(to, spec.format),
      }),
    };
  });
}

export function heatmapStep(value: number, bins: readonly HeatmapBin[]): number {
  const first = bins[0];
  const last = bins.at(-1);
  if (first === undefined || last === undefined) return 0;
  if (last.to === first.from) return bins.length - 1;
  const ratio = (value - first.from) / (last.to - first.from);
  return Math.min(bins.length - 1, Math.max(0, Math.floor(ratio * bins.length)));
}

export function layoutHeatmap(
  spec: HeatmapSpec,
  size: ChartSize,
  options?: LayoutOptions,
): HeatmapLayout {
  checkSize(size.width, size.height);
  const bins = heatmapBins(spec, options);
  const { width, height } = size;
  if (bins.length === 0 || spec.rows.length === 0 || spec.columns.length === 0) {
    return {
      width,
      height,
      empty: true,
      plot: { x: 0, y: 0, width, height },
      rowLabels: [],
      columnLabels: [],
      cells: [],
      bins: [],
    };
  }

  const rowLabelWidth = Math.max(...spec.rows.map((row) => estimateTextWidth(row.label))) + 8;
  const plot: Rect = {
    x: rowLabelWidth,
    y: COLUMN_LABEL_ROOM_PX,
    width: Math.max(1, width - rowLabelWidth),
    height: Math.max(1, height - COLUMN_LABEL_ROOM_PX),
  };
  const cellWidth = plot.width / spec.columns.length;
  const cellHeight = plot.height / spec.rows.length;

  const cells: HeatmapCell[] = [];
  spec.values.forEach((row, rowIndex) => {
    row.forEach((raw, columnIndex) => {
      const value = raw !== null && Number.isFinite(raw) ? raw : null;
      const text = formatValue(value, spec.format);
      const innerWidth = cellWidth - HEATMAP_GAP_PX;
      const innerHeight = cellHeight - HEATMAP_GAP_PX;
      cells.push({
        row: rowIndex,
        column: columnIndex,
        x: plot.x + columnIndex * cellWidth + HEATMAP_GAP_PX / 2,
        y: plot.y + rowIndex * cellHeight + HEATMAP_GAP_PX / 2,
        width: Math.max(0, innerWidth),
        height: Math.max(0, innerHeight),
        value,
        step: value === null ? null : heatmapStep(value, bins),
        text,
        showText:
          spec.showValues === true &&
          value !== null &&
          estimateTextWidth(text) + 6 <= innerWidth &&
          LABEL_FONT_PX + 4 <= innerHeight,
      });
    });
  });

  const columnCenters = spec.columns.map((_, index) => plot.x + cellWidth * (index + 0.5));
  const columnLabels = visibleLabelIndexes(
    columnCenters,
    spec.columns.map((column) => column.label),
  ).map((index) => ({
    value: index,
    position: columnCenters[index] ?? 0,
    label: spec.columns[index]?.label ?? '',
  }));
  const rowStep = Math.max(1, Math.ceil((LABEL_FONT_PX + 2) / cellHeight));
  const rowLabels: AxisTick[] = [];
  for (let index = 0; index < spec.rows.length; index += rowStep) {
    rowLabels.push({
      value: index,
      position: plot.y + cellHeight * (index + 0.5),
      label: spec.rows[index]?.label ?? '',
    });
  }

  return { width, height, empty: false, plot, rowLabels, columnLabels, cells, bins };
}

export function heatmapReadout(
  spec: HeatmapSpec,
  row: number,
  column: number,
  options?: LayoutOptions,
): Readout {
  const { t } = translatorOf(options);
  const value = spec.values[row]?.[column] ?? null;
  return {
    title: `${spec.rows[row]?.label ?? ''} · ${spec.columns[column]?.label ?? ''}`,
    rows: [
      {
        key: 'brand',
        label: t('chart.table.value'),
        text: value === null ? t('chart.noValue') : formatValue(value, spec.format),
      },
    ],
  };
}

export function heatmapReadoutText(
  spec: HeatmapSpec,
  row: number,
  column: number,
  options?: LayoutOptions,
): string {
  return readoutText(translatorOf(options).t, heatmapReadout(spec, row, column, options));
}

export function heatmapTable(spec: HeatmapSpec, options?: LayoutOptions): ChartTable {
  const { t } = translatorOf(options);
  return {
    caption: t('chart.table.caption', { title: spec.title }),
    rowHeader: t('chart.table.item'),
    columns: spec.columns.map((column) => ({
      key: column.key,
      label: column.label,
      numeric: true,
    })),
    rows: spec.rows.map((row, index) => ({
      key: row.key,
      header: row.label,
      cells: spec.columns.map((_, column) => ({
        text: formatValue(spec.values[index]?.[column] ?? null, spec.format),
      })),
    })),
  };
}

export function heatmapSummary(spec: HeatmapSpec, options?: LayoutOptions): string {
  const { t } = translatorOf(options);
  const range = extent(spec.values.flat());
  if (range === null) return t('chart.summary.empty', { title: spec.title });
  return `${spec.title}. ${t('chart.summary.heatmap', {
    rows: spec.rows.length,
    columns: spec.columns.length,
    min: formatValue(range[0], spec.format),
    max: formatValue(range[1], spec.format),
  })}`;
}
