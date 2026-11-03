import { NBSP } from '@sport-performance/i18n';
import { describe, expect, it } from 'vitest';
import { sessionSpec, weeklyLoadSpec } from '../testing/fixtures.js';
import {
  barChartLegend,
  barChartReadout,
  barChartReadoutText,
  barChartSummary,
  barChartTable,
  layoutBarChart,
} from './bar.js';
import { BAR_MAX_WIDTH_PX } from './geometry.js';
import { estimateTextWidth } from './text.js';

const size = { width: 480, height: 240 };

describe('layoutBarChart', () => {
  const layout = layoutBarChart(weeklyLoadSpec, size);

  it('grows every bar from the zero baseline', () => {
    expect(layout.yTicks[0]?.value).toBe(0);
    expect(layout.baselineY).toBeCloseTo(layout.plot.y + layout.plot.height);
    for (const bar of layout.bars) {
      if (bar.value !== null) expect(bar.valueY).toBeLessThan(layout.baselineY);
    }
  });

  it('caps the bar width and leaves a gap between neighbours', () => {
    const wide = layoutBarChart(weeklyLoadSpec, { width: 2000, height: 240 });
    expect(wide.bars[0]?.width).toBe(BAR_MAX_WIDTH_PX);
    const many = layoutBarChart(
      {
        ...weeklyLoadSpec,
        overlay: undefined,
        bars: Array.from({ length: 60 }, (_, i) => ({
          key: String(i),
          label: String(i),
          value: i,
        })),
      },
      { width: 300, height: 200 },
    );
    const [a, b] = many.bars;
    expect((b?.x ?? 0) - ((a?.x ?? 0) + (a?.width ?? 0))).toBeGreaterThanOrEqual(2 - 1e-9);
  });

  it('draws nothing for a missing week but keeps its slot', () => {
    expect(layout.bars[2]?.path).toBe('');
    expect(layout.columns).toHaveLength(4);
  });

  it('labels only the last bar by default', () => {
    expect(layout.directLabels).toEqual([
      { x: layout.bars[3]?.center, y: (layout.bars[3]?.valueY ?? 0) - 6, text: `1.980${NBSP}UA` },
    ]);
  });

  it('labels the highest bar when asked', () => {
    const session = layoutBarChart(sessionSpec, size);
    expect(session.directLabels[0]?.text).toBe(`6.010${NBSP}m`);
    expect(session.directLabels[0]?.x).toBe(session.bars[1]?.center);
  });

  it('marks flagged bars with a status glyph above the label', () => {
    expect(layout.statusMarks).toHaveLength(1);
    expect(layout.statusMarks[0]?.level).toBe('critical');
    expect(layout.statusMarks[0]?.y).toBeLessThan(layout.directLabels[0]?.y ?? 0);
    expect(layout.statusMarks[0]?.y).toBeGreaterThan(0);
  });

  it('draws the overlay on the same axis, skipping nothing it has', () => {
    expect(layout.overlay?.points).toHaveLength(4);
    expect(layout.overlay?.path.startsWith('M')).toBe(true);
  });

  it('keeps the reference label off the bars and the direct label', () => {
    const session = layoutBarChart(sessionSpec, size);
    const reference = session.reference;
    if (reference === undefined) throw new Error('reference expected');
    const width = estimateTextWidth(reference.text);
    const left = reference.anchor === 'end' ? reference.labelX - width : reference.labelX;
    const box = { x0: left, x1: left + width, y0: reference.labelY - 12, y1: reference.labelY + 2 };
    for (const bar of session.bars) {
      const overlaps =
        bar.x < box.x1 &&
        bar.x + bar.width > box.x0 &&
        Math.min(bar.valueY, session.baselineY) < box.y1 &&
        Math.max(bar.valueY, session.baselineY) > box.y0;
      expect(overlaps, bar.key).toBe(false);
    }
  });

  it('supports negative values below the baseline', () => {
    const negative = layoutBarChart(
      {
        title: 'Diferencia',
        bars: [
          { key: 'a', label: 'A', value: -5 },
          { key: 'b', label: 'B', value: 10 },
        ],
      },
      size,
    );
    expect(negative.bars[0]?.valueY).toBeGreaterThan(negative.baselineY);
    expect(negative.bars[1]?.valueY).toBeLessThan(negative.baselineY);
  });

  it('is empty without values', () => {
    expect(
      layoutBarChart({ title: 'x', bars: [{ key: 'a', label: 'a', value: null }] }, size).empty,
    ).toBe(true);
  });

  it('rejects an overlay that does not match the bars', () => {
    expect(() =>
      layoutBarChart({ ...weeklyLoadSpec, overlay: { label: 'x', values: [1] } }, size),
    ).toThrow(RangeError);
  });
});

describe('bar chart text', () => {
  it('names the tones in the legend, then the overlay and the reference', () => {
    expect(barChartLegend(sessionSpec)).toEqual([
      { key: 'brand', label: 'Backs' },
      { key: 'neutral', label: 'Delanteros' },
      { key: 'reference', label: `Primera 5.800${NBSP}m` },
    ]);
    expect(barChartLegend(weeklyLoadSpec)).toEqual([{ key: 'overlay', label: 'Crónica' }]);
  });

  it('reads a bar with its group, the overlay and the state', () => {
    expect(barChartReadout(sessionSpec, 0).rows[0]).toEqual({
      key: 'neutral',
      label: 'Delanteros',
      text: `4.820${NBSP}m`,
    });
    expect(barChartReadoutText(weeklyLoadSpec, 3)).toBe(
      `Semana 44. Carga: 1.980${NBSP}UA (Crítico); Crónica: 1.710${NBSP}UA.`,
    );
    expect(barChartReadout(weeklyLoadSpec, 2).rows[0]?.text).toBe('Sin dato');
  });

  it('builds the alternative table', () => {
    const table = barChartTable(weeklyLoadSpec);
    expect(table.columns.map((column) => column.label)).toEqual(['Carga', 'Crónica', 'Estado']);
    expect(table.rows.map((row) => row.header)).toEqual([
      'Semana 41',
      'Semana 42',
      'Semana 43',
      'Semana 44',
    ]);
    expect(table.rows[3]?.cells).toEqual([
      { text: `1.980${NBSP}UA` },
      { text: `1.710${NBSP}UA` },
      { text: 'Crítico', status: 'critical' },
    ]);
    const session = barChartTable(sessionSpec);
    expect(session.columns.map((column) => column.label)).toEqual(['Valor', 'Grupo', 'Primera']);
    expect(session.rows[0]?.cells[1]?.text).toBe('Delanteros');
  });

  it('summarises the extremes', () => {
    expect(barChartSummary(weeklyLoadSpec)).toBe(
      `Carga semanal. 3 barras; la más alta, 1.980${NBSP}UA (Semana 44); la más baja, 1.480${NBSP}UA (Semana 41). ` +
        `Crónica: 4 valores, de 1.550${NBSP}UA (Semana 41) a 1.710${NBSP}UA (Semana 44). 1 valor marcado con un estado.`,
    );
  });
});
