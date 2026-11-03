import { useId, useMemo, type ReactNode } from 'react';
import { px } from '../core/geometry.js';
import {
  heatmapReadout,
  heatmapReadoutText,
  heatmapSummary,
  heatmapTable,
  layoutHeatmap,
  type HeatmapSpec,
} from '../core/heatmap.js';
import { ChartFrame } from './chart-frame.js';
import { useChartOptions } from './context.js';
import { InteractivePlot, useActivePosition, type KeyMove } from './interactive-plot.js';
import { ChartTooltip } from './tooltip.js';
import { useMeasuredWidth } from './use-measured-width.js';

export interface HeatmapProps {
  readonly spec: HeatmapSpec;
  /** Height in px. Default: 28 px per row plus the column labels. */
  readonly height?: number | undefined;
  readonly width?: number | undefined;
  readonly description?: ReactNode;
  readonly defaultTableVisible?: boolean | undefined;
  readonly className?: string | undefined;
}

interface Cell {
  readonly row: number;
  readonly column: number;
}

function gridMove(rows: number, columns: number): KeyMove<Cell> {
  return (current, key) => {
    if (rows === 0 || columns === 0) return undefined;
    const at = current ?? { row: 0, column: 0 };
    switch (key) {
      case 'ArrowRight':
        return { row: at.row, column: Math.min(columns - 1, at.column + (current ? 1 : 0)) };
      case 'ArrowLeft':
        return { row: at.row, column: Math.max(0, at.column - (current ? 1 : 0)) };
      case 'ArrowDown':
        return { row: Math.min(rows - 1, at.row + (current ? 1 : 0)), column: at.column };
      case 'ArrowUp':
        return { row: Math.max(0, at.row - (current ? 1 : 0)), column: at.column };
      case 'Home':
        return { row: at.row, column: 0 };
      case 'End':
        return { row: at.row, column: columns - 1 };
      case 'Escape':
        return current === null ? undefined : null;
      default:
        return undefined;
    }
  };
}

/** SVG ids cannot carry the characters React puts in `useId()`. */
function svgId(raw: string): string {
  return `sp${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/**
 * Grid of values in one hue (the brand) by steps, with the scale named under it. Missing cells
 * are hatched, not just pale, and every cell has its tooltip (pointer and keyboard).
 */
export function Heatmap({
  spec,
  height,
  width: fixedWidth,
  description,
  defaultTableVisible,
  className,
}: HeatmapProps) {
  const options = useChartOptions();
  const { t } = options.translator;
  const [containerRef, width] = useMeasuredWidth(fixedWidth);
  const resolvedHeight = height ?? 20 + 28 * Math.max(1, spec.rows.length);
  const layout = useMemo(
    () => layoutHeatmap(spec, { width, height: resolvedHeight }, options),
    [spec, width, resolvedHeight, options],
  );
  const table = useMemo(() => heatmapTable(spec, options), [spec, options]);
  const summary = useMemo(() => heatmapSummary(spec, options), [spec, options]);
  const rows = spec.rows.length;
  const columns = spec.columns.length;
  const interaction = useActivePosition(gridMove(rows, columns), () =>
    rows > 0 && columns > 0 ? { row: 0, column: 0 } : null,
  );
  const active =
    interaction.active !== null &&
    interaction.active.value.row < rows &&
    interaction.active.value.column < columns
      ? interaction.active.value
      : null;
  const activeCell =
    active === null ? undefined : layout.cells[active.row * columns + active.column];
  const hatchId = svgId(`${useId()}hatch`);
  const hasMissing = layout.cells.some((cell) => cell.value === null);

  const scale = (
    <ul className="sp-chart__scale" aria-label={t('chart.heatmap.scale')}>
      {layout.bins.map((bin) => (
        <li key={bin.step} className="sp-chart__scale-item">
          <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true" focusable="false">
            <rect
              className="sp-chart__cell"
              width={14}
              height={14}
              rx={2}
              fillOpacity={bin.intensity}
            />
          </svg>
          <span>{bin.label}</span>
        </li>
      ))}
      {hasMissing ? (
        <li className="sp-chart__scale-item">
          <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true" focusable="false">
            <rect className="sp-chart__cell--empty" width={14} height={14} rx={2} />
            <path className="sp-chart__hatch" d="M0 14L14 0M-3 3L3 -3M11 17L17 11" />
          </svg>
          <span>{t('chart.noValue')}</span>
        </li>
      ) : null}
    </ul>
  );

  return (
    <div ref={containerRef} className="sp-chart-container">
      <ChartFrame
        title={spec.title}
        description={description}
        legend={[]}
        table={table}
        empty={layout.empty}
        defaultTableVisible={defaultTableVisible}
        className={className === undefined ? 'sp-chart--heatmap' : `sp-chart--heatmap ${className}`}
        footer={scale}
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
          onPointer={(x, y) => {
            const hit = layout.cells.find(
              (cell) =>
                x >= cell.x - 1 &&
                x < cell.x + cell.width + 1 &&
                y >= cell.y - 1 &&
                y < cell.y + cell.height + 1,
            );
            interaction.setFromPointer(
              hit === undefined ? null : { row: hit.row, column: hit.column },
            );
          }}
          announcement={
            active !== null && interaction.active?.source === 'keyboard'
              ? heatmapReadoutText(spec, active.row, active.column, options)
              : ''
          }
          tooltip={
            active === null || activeCell === undefined ? null : (
              <ChartTooltip
                readout={heatmapReadout(spec, active.row, active.column, options)}
                x={activeCell.x + activeCell.width / 2}
                y={activeCell.y}
                width={layout.width}
                height={layout.height}
              />
            )
          }
        >
          <defs>
            <pattern id={hatchId} width={6} height={6} patternUnits="userSpaceOnUse">
              <path className="sp-chart__hatch" d="M0 6L6 0M-1.5 1.5L1.5 -1.5M4.5 7.5L7.5 4.5" />
            </pattern>
          </defs>
          <g className="sp-chart__axis">
            {layout.columnLabels.map((tick) => (
              <text
                key={tick.value}
                className="sp-chart__tick"
                x={px(tick.position)}
                y={px(layout.plot.y - 8)}
                textAnchor="middle"
              >
                {tick.label}
              </text>
            ))}
            {layout.rowLabels.map((tick) => (
              <text
                key={tick.value}
                className="sp-chart__tick"
                x={px(layout.plot.x - 8)}
                y={px(tick.position + 4)}
                textAnchor="end"
              >
                {tick.label}
              </text>
            ))}
          </g>
          <g>
            {layout.cells.map((cell) => {
              const isActive = activeCell === cell;
              const bin = cell.step === null ? undefined : layout.bins[cell.step];
              return (
                <g key={`${String(cell.row)}:${String(cell.column)}`}>
                  {bin === undefined ? (
                    <>
                      <rect
                        className="sp-chart__cell--empty"
                        x={px(cell.x)}
                        y={px(cell.y)}
                        width={px(cell.width)}
                        height={px(cell.height)}
                        rx={2}
                      />
                      <rect
                        x={px(cell.x)}
                        y={px(cell.y)}
                        width={px(cell.width)}
                        height={px(cell.height)}
                        rx={2}
                        fill={`url(#${hatchId})`}
                      />
                    </>
                  ) : (
                    <rect
                      className="sp-chart__cell"
                      x={px(cell.x)}
                      y={px(cell.y)}
                      width={px(cell.width)}
                      height={px(cell.height)}
                      rx={2}
                      fillOpacity={bin.intensity}
                    />
                  )}
                  {isActive ? (
                    <rect
                      className="sp-chart__cell-outline"
                      x={px(cell.x)}
                      y={px(cell.y)}
                      width={px(cell.width)}
                      height={px(cell.height)}
                      rx={2}
                    />
                  ) : null}
                  {cell.showText ? (
                    <text
                      className="sp-chart__cell-label"
                      x={px(cell.x + cell.width / 2)}
                      y={px(cell.y + cell.height / 2 + 4)}
                      textAnchor="middle"
                    >
                      {cell.text}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </InteractivePlot>
      </ChartFrame>
    </div>
  );
}
