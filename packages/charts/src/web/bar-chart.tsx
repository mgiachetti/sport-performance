import { useMemo, type ReactNode } from 'react';
import {
  barChartLegend,
  barChartReadout,
  barChartReadoutText,
  barChartSummary,
  barChartTable,
  layoutBarChart,
  type BarChartSpec,
} from '../core/bar.js';
import { px } from '../core/geometry.js';
import { CategoryLabels, ReferenceLine, StatusGlyph, ValueGrid } from './axes.js';
import { ChartFrame } from './chart-frame.js';
import { useChartOptions } from './context.js';
import { InteractivePlot, linearMove, useActivePosition } from './interactive-plot.js';
import { ChartTooltip } from './tooltip.js';
import { useMeasuredWidth } from './use-measured-width.js';

export interface BarChartProps {
  readonly spec: BarChartSpec;
  /** Height in px. Default 240. */
  readonly height?: number | undefined;
  readonly width?: number | undefined;
  readonly description?: ReactNode;
  readonly defaultTableVisible?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * Columns from one baseline (weekly load, a session metric per player): brand or grey tone named
 * in the legend, an optional grey line on the same axis, the first-team reference, one direct
 * value label, status glyphs, per-bar tooltip (pointer and keyboard) and the alternative table.
 */
export function BarChart({
  spec,
  height = 240,
  width: fixedWidth,
  description,
  defaultTableVisible,
  className,
}: BarChartProps) {
  const options = useChartOptions();
  const [containerRef, width] = useMeasuredWidth(fixedWidth);
  const layout = useMemo(
    () => layoutBarChart(spec, { width, height }, options),
    [spec, width, height, options],
  );
  const table = useMemo(() => barChartTable(spec, options), [spec, options]);
  const legend = useMemo(() => barChartLegend(spec, options), [spec, options]);
  const summary = useMemo(() => barChartSummary(spec, options), [spec, options]);
  const count = spec.bars.length;
  const interaction = useActivePosition(linearMove(count), () => (count > 0 ? count - 1 : null));
  const activeIndex =
    interaction.active !== null && interaction.active.value < count
      ? interaction.active.value
      : null;
  const activeBar = activeIndex === null ? undefined : layout.bars[activeIndex];

  return (
    <div ref={containerRef} className="sp-chart-container">
      <ChartFrame
        title={spec.title}
        description={description}
        legend={legend}
        table={table}
        empty={layout.empty}
        defaultTableVisible={defaultTableVisible}
        className={className === undefined ? 'sp-chart--bar' : `sp-chart--bar ${className}`}
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
            const hit = layout.columns.find((item) => x >= item.x0 && x < item.x1);
            if (hit === undefined) interaction.onPointerLeave();
            else interaction.setFromPointer(hit.index);
          }}
          announcement={
            activeIndex !== null && interaction.active?.source === 'keyboard'
              ? barChartReadoutText(spec, activeIndex, options)
              : ''
          }
          tooltip={
            activeIndex === null || activeBar === undefined ? null : (
              <ChartTooltip
                readout={barChartReadout(spec, activeIndex, options)}
                x={activeBar.center}
                y={layout.plot.y}
                width={layout.width}
                height={layout.height}
              />
            )
          }
        >
          <ValueGrid ticks={layout.yTicks} plot={layout.plot} />
          <CategoryLabels ticks={layout.xTicks} plot={layout.plot} y={layout.height - 8} />
          {activeIndex === null ? null : (
            <rect
              className="sp-chart__hover-band"
              x={px(layout.columns[activeIndex]?.x0 ?? 0)}
              y={px(layout.plot.y)}
              width={px(
                (layout.columns[activeIndex]?.x1 ?? 0) - (layout.columns[activeIndex]?.x0 ?? 0),
              )}
              height={px(layout.plot.height)}
            />
          )}
          <g className="sp-chart__bars">
            {layout.bars.map((bar) =>
              bar.path === '' ? null : (
                <path
                  key={bar.key}
                  className={`sp-chart__bar sp-chart__bar--${bar.tone}${
                    bar.index === activeIndex ? ' is-active' : ''
                  }`}
                  d={bar.path}
                />
              ),
            )}
          </g>
          <line
            className="sp-chart__baseline"
            x1={px(layout.plot.x)}
            x2={px(layout.plot.x + layout.plot.width)}
            y1={px(layout.baselineY)}
            y2={px(layout.baselineY)}
          />
          {layout.overlay === undefined ? null : (
            <g className="sp-chart__series sp-chart__series--overlay">
              <path className="sp-chart__line" d={layout.overlay.path} />
              {layout.overlay.points.map((point) => (
                <circle
                  key={`${px(point.x)}:${px(point.y)}`}
                  className="sp-chart__point"
                  cx={px(point.x)}
                  cy={px(point.y)}
                  r={3}
                />
              ))}
            </g>
          )}
          {layout.reference === undefined ? null : <ReferenceLine reference={layout.reference} />}
          {layout.directLabels.map((label) => (
            <text
              key={`${px(label.x)}:${px(label.y)}`}
              className="sp-chart__direct-label"
              x={px(label.x)}
              y={px(label.y)}
              textAnchor="middle"
            >
              {label.text}
            </text>
          ))}
          {layout.statusMarks.map((mark) => (
            <StatusGlyph key={mark.index} level={mark.level} x={mark.x} y={mark.y} />
          ))}
        </InteractivePlot>
      </ChartFrame>
    </div>
  );
}
