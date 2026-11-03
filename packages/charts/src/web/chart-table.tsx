import type { ChartTable } from '../core/types.js';
import { StatusBadge } from './status-badge.js';

/** The accessible alternative of a chart: every drawn value as a real table. */
export function ChartTableView({ table }: { readonly table: ChartTable }) {
  return (
    <table className="sp-chart-table">
      <caption>{table.caption}</caption>
      <thead>
        <tr>
          <th scope="col">{table.rowHeader}</th>
          {table.columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={column.numeric ? 'sp-chart-table__numeric' : undefined}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.header}</th>
            {row.cells.map((cell, index) => {
              const column = table.columns[index];
              return (
                <td
                  key={column?.key ?? index}
                  className={column?.numeric === true ? 'sp-chart-table__numeric' : undefined}
                >
                  {cell.status === undefined ? (
                    cell.text
                  ) : (
                    <StatusBadge level={cell.status} label={cell.text} />
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
