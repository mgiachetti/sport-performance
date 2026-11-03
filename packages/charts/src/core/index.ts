/**
 * @sport-performance/charts — platform-free core of the own SVG charts (ADR 0056).
 *
 * No React, React Native or DOM: scales, ticks, geometry, the layout of every chart type, the
 * tooltip readout, the accessible summary and the alternative table, all formatted in es-AR.
 * Renderers (`@sport-performance/charts/web` today, a react-native-svg one in mobile) only draw
 * what these functions return.
 */

/** Workspace package identifier. */
export const packageName = '@sport-performance/charts' as const;

export { formatTick, formatValue, getDefaultTranslator, type ValueFormat } from './format.js';
export {
  decimalsOf,
  extent,
  finiteValues,
  linearScale,
  niceTicks,
  type LinearScale,
  type NiceTicks,
} from './scale.js';
export {
  BAR_MAX_WIDTH_PX,
  BAR_RADIUS_PX,
  barPath,
  linePath,
  nearestIndex,
  px,
  type BarShape,
  type Point,
  type Rect,
} from './geometry.js';
export { LABEL_FONT_PX, estimateTextWidth, visibleLabelIndexes } from './text.js';
export {
  STATUS_ICONS,
  isStatusLevel,
  statusLabel,
  statusLevels,
  type StatusIconPart,
  type StatusLevel,
} from './status.js';
export {
  REFERENCE_DASH,
  maxTicksFor,
  readoutText,
  referenceLayout,
  referenceText,
  valueAxis,
  type ValueAxis,
} from './common.js';
export type {
  AxisTick,
  ChartCategory,
  ChartKey,
  ChartReference,
  ChartSize,
  ChartSpecBase,
  ChartTable,
  ChartTableCell,
  ChartTableColumn,
  ChartTableRow,
  HitColumn,
  LayoutOptions,
  LegendItem,
  PlotLayout,
  Readout,
  ReadoutRow,
  ReferenceLayout,
} from './types.js';
export {
  LINE_SERIES_ROLES,
  STATUS_GLYPH_OFFSET_PX,
  hitColumns,
  layoutLineChart,
  lineChartLegend,
  lineChartReadout,
  lineChartReadoutText,
  lineChartSummary,
  lineChartTable,
  pointPositions,
  type LineChartLayout,
  type LineChartSpec,
  type LinePointLayout,
  type LineSeries,
  type LineSeriesLayout,
  type LineSeriesRole,
} from './line.js';
export {
  barChartLegend,
  barChartReadout,
  barChartReadoutText,
  barChartSummary,
  barChartTable,
  layoutBarChart,
  type BarChartLayout,
  type BarChartSpec,
  type BarDatum,
  type BarLayout,
  type BarOverlay,
  type BarTone,
  type DirectLabel,
  type StatusMark,
} from './bar.js';
export {
  layoutSparkline,
  sparklineSummary,
  sparklineTable,
  type SparklineLayout,
  type SparklineSpec,
} from './sparkline.js';
export {
  HEATMAP_GAP_PX,
  heatmapBins,
  heatmapReadout,
  heatmapReadoutText,
  heatmapStep,
  heatmapSummary,
  heatmapTable,
  layoutHeatmap,
  type HeatmapBin,
  type HeatmapCell,
  type HeatmapLayout,
  type HeatmapSpec,
} from './heatmap.js';
