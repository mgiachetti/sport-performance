import { NBSP, createTranslator } from '@sport-performance/i18n';
import { describe, expect, it } from 'vitest';
import { sprintSpec } from '../testing/fixtures.js';
import { estimateTextWidth } from './text.js';
import {
  layoutLineChart,
  lineChartLegend,
  lineChartReadout,
  lineChartReadoutText,
  lineChartSummary,
  lineChartTable,
  type LineChartSpec,
} from './line.js';

const size = { width: 400, height: 220 };

describe('layoutLineChart', () => {
  const layout = layoutLineChart(sprintSpec, size);

  it('draws the player on top of the category average', () => {
    expect(layout.series.map((series) => series.role)).toEqual(['categoryAverage', 'player']);
  });

  it('has a single value axis covering every series and the reference', () => {
    const values = [...sprintSpec.series.flatMap((s) => s.values), 5.25].filter(
      (v): v is number => v !== null,
    );
    const first = layout.yTicks[0];
    const last = layout.yTicks.at(-1);
    expect(first?.value).toBeLessThanOrEqual(Math.min(...values));
    expect(last?.value).toBeGreaterThanOrEqual(Math.max(...values));
    // Tick labels in es-AR, without the unit (it goes in the title).
    expect(layout.yTicks.map((tick) => tick.label)).toContain('5,4');
  });

  it('breaks the player line at the missing window and keeps its points', () => {
    const player = layout.series.find((series) => series.role === 'player');
    expect(player?.points.map((point) => point.index)).toEqual([0, 1, 3, 4]);
    expect(player?.path.match(/M/g)?.length).toBe(2);
  });

  it('places points from edge to edge of the plot', () => {
    const player = layout.series.find((series) => series.role === 'player');
    expect(player?.points[0]?.x).toBe(layout.plot.x);
    expect(player?.points.at(-1)?.x).toBe(layout.plot.x + layout.plot.width);
  });

  it('labels the first-team reference directly, inside the chart', () => {
    expect(layout.reference?.text).toBe(`Primera 5,25${NBSP}s`);
    expect(layout.reference?.labelY).toBeGreaterThan(0);
    expect(layout.reference?.labelY).toBeLessThanOrEqual(layout.plot.y + layout.plot.height);
    expect(layout.reference?.dash).toHaveLength(2);
  });

  it('moves the reference label off the data points', () => {
    const reference = layout.reference;
    if (reference === undefined) throw new Error('reference expected');
    const width = estimateTextWidth(reference.text);
    const left = reference.anchor === 'end' ? reference.labelX - width : reference.labelX;
    const covered = layout.series
      .flatMap((series) => series.points)
      .filter(
        (point) =>
          point.x + 6 > left &&
          point.x - 6 < left + width &&
          point.y + 6 > reference.labelY - 12 &&
          point.y - 6 < reference.labelY + 2,
      );
    expect(covered).toEqual([]);
  });

  it('keeps the reference label at the right end when nothing is in the way', () => {
    const far = layoutLineChart({ ...sprintSpec, reference: { value: 4.5 } }, size);
    expect(far.reference?.anchor).toBe('end');
    expect(far.reference?.labelX).toBe(far.plot.x + far.plot.width);
    expect(far.reference?.labelY).toBeLessThan(far.reference?.y ?? 0);
  });

  it('makes room above the points for status glyphs', () => {
    const withoutStatus = layoutLineChart(
      { ...sprintSpec, series: sprintSpec.series.map((s) => ({ ...s, statuses: undefined })) },
      size,
    );
    expect(layout.plot.y).toBeGreaterThan(withoutStatus.plot.y);
  });

  it('has one hit column per category covering the plot without gaps', () => {
    expect(layout.columns).toHaveLength(5);
    expect(layout.columns[0]?.x0).toBe(layout.plot.x);
    expect(layout.columns.at(-1)?.x1).toBe(layout.plot.x + layout.plot.width);
    layout.columns.slice(1).forEach((column, i) => {
      expect(column.x0).toBeCloseTo(layout.columns[i]?.x1 ?? Number.NaN);
    });
  });

  it('is empty without values', () => {
    const empty = layoutLineChart(
      {
        ...sprintSpec,
        series: [{ id: 'p', role: 'player', label: 'P', values: [null, null, null, null, null] }],
      },
      size,
    );
    expect(empty.empty).toBe(true);
    expect(empty.series).toEqual([]);
  });

  it('rejects inconsistent specs', () => {
    const bad: LineChartSpec = {
      ...sprintSpec,
      series: [{ id: 'p', role: 'player', label: 'P', values: [1] }],
    };
    expect(() => layoutLineChart(bad, size)).toThrow(RangeError);
    const twice: LineChartSpec = {
      ...sprintSpec,
      series: [sprintSpec.series[1], sprintSpec.series[1]].filter((s) => s !== undefined),
    };
    expect(() => layoutLineChart(twice, size)).toThrow(/more than one/);
    expect(() => layoutLineChart(sprintSpec, { width: 0, height: 10 })).toThrow(RangeError);
  });
});

describe('line chart text', () => {
  it('builds the legend: player, average, reference', () => {
    expect(lineChartLegend(sprintSpec).map((item) => item.key)).toEqual([
      'player',
      'categoryAverage',
      'reference',
    ]);
  });

  it('reads every series at a position, saying when a value is missing', () => {
    const readout = lineChartReadout(sprintSpec, 2);
    expect(readout.title).toBe('V3 25');
    expect(readout.rows.map((row) => row.text)).toEqual([
      'Sin dato',
      `5,55${NBSP}s`,
      `5,25${NBSP}s`,
    ]);
    expect(lineChartReadoutText(sprintSpec, 3)).toBe(
      `V4 25. Tomás Pérez: 5,41${NBSP}s (Atención); Promedio M17: 5,52${NBSP}s; Primera: 5,25${NBSP}s.`,
    );
  });

  it('builds the alternative table with every value and the states as text', () => {
    const table = lineChartTable(sprintSpec);
    expect(table.caption).toBe('Datos de «Sprint 40 m»');
    expect(table.columns.map((column) => column.label)).toEqual([
      'Tomás Pérez',
      'Promedio M17',
      'Primera',
      'Estado',
    ]);
    expect(table.rows).toHaveLength(5);
    expect(table.rows[2]?.cells.map((cell) => cell.text)).toEqual([
      '—',
      `5,55${NBSP}s`,
      `5,25${NBSP}s`,
      '',
    ]);
    expect(table.rows[3]?.cells[3]).toEqual({ text: 'Atención', status: 'warning' });
  });

  it('summarises the chart for screen readers', () => {
    expect(lineChartSummary(sprintSpec)).toBe(
      `Sprint 40 m. Tomás Pérez: 4 valores, de 5,62${NBSP}s (V1 25) a 5,31${NBSP}s (V1 26). ` +
        `Promedio M17: 5 valores, de 5,68${NBSP}s (V1 25) a 5,49${NBSP}s (V1 26). ` +
        `Referencia de Primera: 5,25${NBSP}s. 1 valor marcado con un estado.`,
    );
  });

  it('uses the club translator when given one', () => {
    const translator = createTranslator({
      overrides: { 'chart.reference.firstTeam': 'Plantel superior' },
    });
    expect(lineChartLegend(sprintSpec, { translator }).at(-1)?.label).toBe(
      `Plantel superior 5,25${NBSP}s`,
    );
  });
});
