/**
 * @sport-performance/charts/web — React DOM renderer of the own SVG charts (ADR 0056).
 *
 * Import the stylesheet once in the app: `import '@sport-performance/charts/web/charts.css';`.
 * Colors come from the `--sp-*` variables of packages/ui-tokens, so the club theme applies at
 * runtime. Wrap the app in `<ChartsProvider translator={…}>` to use the club's translator.
 */

export { ChartsProvider, useChartOptions, type ChartsProviderProps } from './context.js';
export { LineChart, type LineChartProps } from './line-chart.js';
export { BarChart, type BarChartProps } from './bar-chart.js';
export { Sparkline, type SparklineProps } from './sparkline.js';
export { Heatmap, type HeatmapProps } from './heatmap.js';
export { StatusBadge, StatusIcon, type StatusBadgeProps } from './status-badge.js';
export { ChartTableView } from './chart-table.js';
export { ChartFrame, type ChartFrameProps } from './chart-frame.js';
export { FALLBACK_WIDTH_PX, useMeasuredWidth } from './use-measured-width.js';
