import { useMemo, type ReactNode } from 'react';
import { nearestIndex, px } from '../core/geometry.js';
import {
  STATUS_GLYPH_OFFSET_PX,
  layoutLineChart,
  lineChartLegend,
  lineChartReadout,
  lineChartReadoutText,
  lineChartSummary,
  lineChartTable,
  type LineChartSpec,
} from '../core/line.js';
import { CategoryLabels, ReferenceLine, StatusGlyph, ValueGrid } from './axes.js';
import { ChartFrame } from './chart-frame.js';
import { useChartOptions } from './context.js';
import { InteractivePlot, linearMove, useActivePosition } from './interactive-plot.js';
import { ChartTooltip } from './tooltip.js';
import { useMeasuredWidth } from './use-measured-width.js';

export interface LineChartProps {
  readonly spec: LineChartSpec;
  /** Height in px. Default 220. */
  readonly height?: number | undefined;
  /** Fixed width in px; by default the chart fills its container. */
  readonly width?: number | undefined;
  readonly description?: ReactNode;
  readonly defaultTableVisible?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * Evolution over categories (test windows, days): the player in the brand color, the category
 * average in grey, the first-team reference dashed with a direct label, one value axis, a
 * crosshair tooltip (pointer and keyboard) and the alternative table.
 */
export function LineChart({
  spec,
  height = 220,
  width: fixedWidth,
  description,
  defaultTableVisible,
  className,
}: LineChartProps) {
  const options = useChartOptions();
  const [containerRef, width] = useMeasuredWidth(fixedWidth);
  const layout = useMemo(
    () => layoutLineChart(spec, { width, height }, options),
    [spec, width, height, options],
  );
  const table = useMemo(() => lineChartTable(spec, options), [spec, options]);
  const legend = useMemo(() => lineChartLegend(spec, options), [spec, options]);
  const summary = useMemo(() => lineChartSummary(spec, options), [spec, options]);
  const count = spec.categories.length;
  const interaction = useActivePosition(linearMove(count), () => (count > 0 ? count - 1 : null));
  const activeIndex =
    interaction.active !== null && interaction.active.value < count
      ? interaction.active.value
      : null;
  const column = activeIndex === null ? undefined : layout.columns[activeIndex];

  return (
    <div ref={containerRef} className="sp-chart-container">
      <ChartFrame
        title={spec.title}
        description={description}
        legend={legend}
        table={table}
        empty={layout.empty}
        defaultTableVisible={defaultTableVisible}
        className={className === undefined ? 'sp-chart--line' : `sp-chart--line ${className}`}
      >
        <InteractivePlot
          label={spec.title}
          summary={summary}
          width={layout.width}
          height={layout.height}
          onKeyDown={interaction.onKeyDown}
          onFocus={interaction.onFocus}
          onBlur={interaction.onBlur}
          onPointerLeave={interaction.onPointerLeave}
          onPointer={(x) => {
            if (x < layout.plot.x - 8 || x > layout.plot.x + layout.plot.width + 8) {
              interaction.onPointerLeave();
              return;
            }
            interaction.setFromPointer(
              nearestIndex(
                layout.columns.map((item) => item.x),
                x,
              ),
            );
          }}
          announcement={
            activeIndex !== null && interaction.active?.source === 'keyboard'
              ? lineChartReadoutText(spec, activeIndex, options)
              : ''
          }
          tooltip={
            activeIndex === null || column === undefined ? null : (
              <ChartTooltip
                readout={lineChartReadout(spec, activeIndex, options)}
                x={column.x}
                y={layout.plot.y}
                width={layout.width}
                height={layout.height}
              />
            )
          }
        >
          <ValueGrid ticks={layout.yTicks} plot={layout.plot} />
          <CategoryLabels ticks={layout.xTicks} plot={layout.plot} y={layout.height - 8} />
          {column === undefined ? null : (
            <line
              className="sp-chart__crosshair"
              x1={px(column.x)}
              x2={px(column.x)}
              y1={px(layout.plot.y)}
              y2={px(layout.plot.y + layout.plot.height)}
            />
          )}
          {layout.reference === undefined ? null : <ReferenceLine reference={layout.reference} />}
          {layout.series.map((series) => (
            <g key={series.id} className={`sp-chart__series sp-chart__series--${series.role}`}>
              <path className="sp-chart__line" d={series.path} />
              {series.points.map((point) => (
                <circle
                  key={point.index}
                  className="sp-chart__point"
                  cx={px(point.x)}
                  cy={px(point.y)}
                  r={point.index === activeIndex ? 5.5 : 4}
                />
              ))}
              {series.points.map((point) =>
                point.status === 'warning' || point.status === 'critical' ? (
                  <StatusGlyph
                    key={`status-${String(point.index)}`}
                    level={point.status}
                    x={point.x}
                    y={point.y - STATUS_GLYPH_OFFSET_PX}
                  />
                ) : null,
              )}
            </g>
          ))}
        </InteractivePlot>
      </ChartFrame>
    </div>
  );
}
