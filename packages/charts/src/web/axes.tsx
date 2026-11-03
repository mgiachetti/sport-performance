import type { Rect } from '../core/geometry.js';
import { px } from '../core/geometry.js';
import type { StatusLevel } from '../core/status.js';
import type { AxisTick, ReferenceLayout } from '../core/types.js';
import { StatusIconPaths } from './status-badge.js';

/** Hairline gridlines and tick labels of the single value axis. */
export function ValueGrid({
  ticks,
  plot,
}: {
  readonly ticks: readonly AxisTick[];
  readonly plot: Rect;
}) {
  return (
    <g className="sp-chart__axis">
      {ticks.map((tick) => (
        <g key={tick.value}>
          <line
            className="sp-chart__grid"
            x1={px(plot.x)}
            x2={px(plot.x + plot.width)}
            y1={px(tick.position)}
            y2={px(tick.position)}
          />
          <text
            className="sp-chart__tick"
            x={px(plot.x - 8)}
            y={px(tick.position + 4)}
            textAnchor="end"
          >
            {tick.label}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Category labels under the plot; the edge ones are anchored inwards so they never clip. */
export function CategoryLabels({
  ticks,
  plot,
  y,
}: {
  readonly ticks: readonly AxisTick[];
  readonly plot: Rect;
  readonly y: number;
}) {
  return (
    <g className="sp-chart__axis">
      {ticks.map((tick) => {
        const anchor =
          tick.position <= plot.x + 0.5
            ? 'start'
            : tick.position >= plot.x + plot.width - 0.5
              ? 'end'
              : 'middle';
        return (
          <text
            key={tick.value}
            className="sp-chart__tick"
            x={px(tick.position)}
            y={px(y)}
            textAnchor={anchor}
          >
            {tick.label}
          </text>
        );
      })}
    </g>
  );
}

/** First-team reference: dashed line with its direct label. */
export function ReferenceLine({ reference }: { readonly reference: ReferenceLayout }) {
  return (
    <g className="sp-chart__reference">
      <line
        className="sp-chart__reference-line"
        x1={px(reference.x1)}
        x2={px(reference.x2)}
        y1={px(reference.y)}
        y2={px(reference.y)}
        strokeDasharray={reference.dash.join(' ')}
      />
      <text
        className="sp-chart__reference-label"
        x={px(reference.labelX)}
        y={px(reference.labelY)}
        textAnchor={reference.anchor}
      >
        {reference.text}
      </text>
    </g>
  );
}

/** Status glyph centred on `(x, y)`, in the status color (the table and tooltip name it). */
export function StatusGlyph({
  level,
  x,
  y,
}: {
  readonly level: StatusLevel;
  readonly x: number;
  readonly y: number;
}) {
  return (
    <g
      className={`sp-chart__status sp-status--${level}`}
      transform={`translate(${px(x - 6)} ${px(y - 6)})`}
    >
      <StatusIconPaths level={level} />
    </g>
  );
}
