import type { ChartKey } from '../core/types.js';

/**
 * The small key that ties a legend entry or a tooltip row to its mark: a stroke for lines, a
 * dashed stroke for the reference, a block for bars. Decorative (the text names the series).
 */
export function ChartKeySwatch({ chartKey }: { readonly chartKey: ChartKey }) {
  const isBlock = chartKey === 'brand' || chartKey === 'neutral';
  return (
    <svg
      className={`sp-chart__key sp-chart__key--${chartKey}`}
      width={16}
      height={10}
      viewBox="0 0 16 10"
      aria-hidden="true"
      focusable="false"
    >
      {isBlock ? (
        <rect x={3} y={0} width={10} height={10} rx={2} />
      ) : (
        <line x1={1} x2={15} y1={5} y2={5} />
      )}
    </svg>
  );
}
