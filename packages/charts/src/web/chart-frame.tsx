import { useId, useState, type ReactNode } from 'react';
import type { ChartTable, LegendItem } from '../core/types.js';
import { ChartTableView } from './chart-table.js';
import { useChartOptions } from './context.js';
import { ChartKeySwatch } from './keys.js';

export interface ChartFrameProps {
  readonly title: string;
  /** Short line under the title (unit, period, what the reference is). */
  readonly description?: ReactNode;
  readonly legend: readonly LegendItem[];
  readonly table: ChartTable;
  readonly empty: boolean;
  /** Shows the table from the start (it is always in the DOM for screen readers). */
  readonly defaultTableVisible?: boolean | undefined;
  readonly className?: string | undefined;
  /** Extra content under the plot (the heatmap scale). */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Shell shared by every chart: `<figure>` with its caption, legend (two or more identities),
 * the plot, and the alternative table behind "Ver como tabla". The table stays in the DOM when
 * hidden (visually hidden, not `display: none`) so screen readers always reach it.
 */
export function ChartFrame({
  title,
  description,
  legend,
  table,
  empty,
  defaultTableVisible = false,
  className,
  footer,
  children,
}: ChartFrameProps) {
  const { translator } = useChartOptions();
  const { t } = translator;
  const [tableVisible, setTableVisible] = useState(defaultTableVisible);
  const id = useId();
  const tableId = `${id}-table`;
  const titleId = `${id}-title`;

  return (
    <figure
      className={className === undefined ? 'sp-chart' : `sp-chart ${className}`}
      aria-labelledby={titleId}
    >
      <figcaption className="sp-chart__caption">
        <span id={titleId} className="sp-chart__title">
          {title}
        </span>
        {description === undefined ? null : (
          <span className="sp-chart__description">{description}</span>
        )}
      </figcaption>
      {legend.length >= 2 && !empty ? (
        <ul className="sp-chart__legend" aria-label={t('chart.legend')}>
          {legend.map((item) => (
            <li key={`${item.key}:${item.label}`} className="sp-chart__legend-item">
              <ChartKeySwatch chartKey={item.key} />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {empty ? <p className="sp-chart__empty">{t('common.noData')}</p> : children}
      {empty ? null : footer}
      {empty ? null : (
        <>
          <button
            type="button"
            className="sp-chart__table-toggle"
            aria-expanded={tableVisible}
            aria-controls={tableId}
            onClick={() => {
              setTableVisible((visible) => !visible);
            }}
          >
            {tableVisible ? t('chart.table.hide') : t('chart.table.show')}
          </button>
          <div
            id={tableId}
            className={tableVisible ? 'sp-chart__table' : 'sp-chart__table sp-sr-only'}
          >
            <ChartTableView table={table} />
          </div>
        </>
      )}
    </figure>
  );
}
