import type { Readout } from '../core/types.js';
import { ChartKeySwatch } from './keys.js';
import { StatusBadge } from './status-badge.js';

export interface ChartTooltipProps {
  readonly readout: Readout;
  /** Anchor in chart pixels: the tooltip sits beside it, never on top of the mark. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Hover/focus readout. Values lead (strong), series names follow. Hidden from assistive tech:
 * the same text is announced by the chart's live region, and the table has every value.
 * Data labels are rendered as text nodes, never as HTML.
 */
export function ChartTooltip({ readout, x, y, width, height }: ChartTooltipProps) {
  const alignEnd = x > width / 2;
  return (
    <div
      className="sp-chart__tooltip"
      data-align={alignEnd ? 'end' : 'start'}
      aria-hidden="true"
      style={{
        left: `${String((x / width) * 100)}%`,
        top: `${String((Math.max(0, y) / height) * 100)}%`,
      }}
    >
      <div className="sp-chart__tooltip-title">{readout.title}</div>
      <ul className="sp-chart__tooltip-rows">
        {readout.rows.map((row) => (
          <li key={`${row.key}:${row.label}`} className="sp-chart__tooltip-row">
            <ChartKeySwatch chartKey={row.key} />
            <strong className="sp-chart__tooltip-value">{row.text}</strong>
            <span className="sp-chart__tooltip-label">{row.label}</span>
            {row.status === undefined ? null : <StatusBadge level={row.status} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
