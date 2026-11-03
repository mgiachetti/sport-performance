import type { Translator } from '@sport-performance/i18n';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import type { ValueFormat } from './format.js';
import type { Rect } from './geometry.js';

/**
 * A position on the X axis: a test window (`V1 25`), a day, a player. The label arrives already
 * formatted by the caller (dates in the club's time zone, ADR 0019); charts never parse dates.
 */
export interface ChartCategory {
  readonly key: string;
  readonly label: string;
}

/**
 * The first-team reference (ADR 0040): drawn as a dashed line with a direct label. The label
 * defaults to "Primera".
 */
export interface ChartReference {
  readonly value: number;
  readonly label?: string | undefined;
}

/** Common fields of every chart spec. */
export interface ChartSpecBase {
  /** Name of the chart; also the table caption and the start of the accessible summary. */
  readonly title: string;
  readonly format?: ValueFormat | undefined;
}

export interface ChartSize {
  readonly width: number;
  readonly height: number;
}

export interface LayoutOptions {
  /** Club translator (club overrides of the catalog); es-AR by default. */
  readonly translator?: Translator | undefined;
}

export interface AxisTick {
  readonly value: number;
  /** Pixel along the axis (y for the value axis, x for the category axis). */
  readonly position: number;
  readonly label: string;
}

/** Hit area of one X position: the crosshair snaps to it, the tooltip reads it. */
export interface HitColumn {
  readonly index: number;
  /** Pixel of the data position (crosshair). */
  readonly x: number;
  readonly x0: number;
  readonly x1: number;
}

/** The direct label of the first-team reference line. */
export interface ReferenceLayout {
  readonly y: number;
  readonly x1: number;
  readonly x2: number;
  readonly text: string;
  readonly labelX: number;
  readonly labelY: number;
  /** Text anchor of the label: at the right end (`end`) or the left one (`start`). */
  readonly anchor: 'start' | 'end';
  readonly dash: readonly [number, number];
}

export interface PlotLayout {
  readonly width: number;
  readonly height: number;
  readonly plot: Rect;
}

/** Visual identity of a row in the tooltip and the legend. */
export type ChartKey = 'player' | 'categoryAverage' | 'reference' | 'brand' | 'neutral' | 'overlay';

/** One line of a tooltip: the value leads, the series name follows. */
export interface ReadoutRow {
  readonly key: ChartKey;
  readonly label: string;
  readonly text: string;
  readonly status?: StatusLevel | undefined;
}

/** What the tooltip (and the live region, in words) shows for one position. */
export interface Readout {
  readonly title: string;
  readonly rows: readonly ReadoutRow[];
}

export interface LegendItem {
  readonly key: ChartKey;
  readonly label: string;
}

export interface ChartTableColumn {
  readonly key: string;
  readonly label: string;
  readonly numeric: boolean;
}

export interface ChartTableCell {
  readonly text: string;
  readonly status?: StatusLevel | undefined;
}

export interface ChartTableRow {
  readonly key: string;
  readonly header: string;
  readonly cells: readonly ChartTableCell[];
}

/** The accessible alternative of a chart: every value it draws, as text (es-AR). */
export interface ChartTable {
  readonly caption: string;
  /** Header of the first column (the category of each row). */
  readonly rowHeader: string;
  readonly columns: readonly ChartTableColumn[];
  readonly rows: readonly ChartTableRow[];
}
