import { useMemo } from 'react';
import { px } from '../core/geometry.js';
import {
  layoutSparkline,
  sparklineSummary,
  sparklineTable,
  type SparklineSpec,
} from '../core/sparkline.js';
import { ChartTableView } from './chart-table.js';
import { useChartOptions } from './context.js';

export interface SparklineProps {
  readonly spec: SparklineSpec;
  /** Default 120 × 32 px. */
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly className?: string | undefined;
}

/**
 * Mini chart for a stat tile or a list row: the trend in the brand color with the latest value
 * dotted and the optional reference dashed. No axes and no tooltip (the tile around it shows
 * the number); its summary names it and a visually hidden table carries every value.
 */
export function Sparkline({ spec, width = 120, height = 32, className }: SparklineProps) {
  const options = useChartOptions();
  const layout = useMemo(() => layoutSparkline(spec, { width, height }), [spec, width, height]);
  const summary = useMemo(() => sparklineSummary(spec, options), [spec, options]);
  const table = useMemo(() => sparklineTable(spec, options), [spec, options]);

  return (
    <div className={className === undefined ? 'sp-sparkline' : `sp-sparkline ${className}`}>
      <svg
        className="sp-sparkline__svg"
        role="img"
        aria-label={summary}
        width={width}
        height={height}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
      >
        {layout.reference === undefined ? null : (
          <line
            className="sp-chart__reference-line"
            x1={0}
            x2={width}
            y1={px(layout.reference.y)}
            y2={px(layout.reference.y)}
            strokeDasharray={layout.reference.dash.join(' ')}
          />
        )}
        <g className="sp-chart__series sp-chart__series--player">
          <path className="sp-chart__line" d={layout.path} />
          {layout.last === undefined ? null : (
            <circle
              className="sp-chart__point"
              cx={px(layout.last.x)}
              cy={px(layout.last.y)}
              r={4}
            />
          )}
        </g>
      </svg>
      {layout.empty ? null : (
        <div className="sp-sr-only">
          <ChartTableView table={table} />
        </div>
      )}
    </div>
  );
}
