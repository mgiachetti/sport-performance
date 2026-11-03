import { describe, expect, it } from 'vitest';
import { cmjSparkSpec, wellnessSpec } from '../testing/fixtures.js';
import {
  heatmapBins,
  heatmapReadoutText,
  heatmapStep,
  heatmapSummary,
  heatmapTable,
  layoutHeatmap,
} from './heatmap.js';
import { layoutSparkline, sparklineSummary, sparklineTable } from './sparkline.js';
import { NBSP } from '@sport-performance/i18n';

describe('heatmap', () => {
  it('splits a fixed domain into named steps of growing intensity', () => {
    const bins = heatmapBins(wellnessSpec);
    expect(bins).toHaveLength(5);
    expect(bins[0]?.label).toBe('De 1,0 a 1,8');
    expect(bins.at(-1)?.label).toBe('De 4,2 a 5,0');
    const intensities = bins.map((bin) => bin.intensity);
    expect(intensities).toEqual([...intensities].sort((a, b) => a - b));
    expect(intensities[0]).toBeGreaterThan(0);
    expect(intensities.at(-1)).toBe(1);
  });

  it('assigns values to steps, the maximum in the last one', () => {
    const bins = heatmapBins(wellnessSpec);
    expect(heatmapStep(1, bins)).toBe(0);
    expect(heatmapStep(5, bins)).toBe(4);
    expect(heatmapStep(3.1, bins)).toBe(2);
    expect(heatmapStep(9, bins)).toBe(4);
  });

  it('lays out one cell per value, the missing one without step', () => {
    const layout = layoutHeatmap(wellnessSpec, { width: 300, height: 100 });
    expect(layout.cells).toHaveLength(6);
    expect(layout.cells[2]?.value).toBeNull();
    expect(layout.cells[2]?.step).toBeNull();
    expect(layout.cells[2]?.text).toBe('—');
    expect(layout.columnLabels.map((tick) => tick.label)).toEqual(['Lun', 'Mar', 'Mié']);
    expect(layout.rowLabels.map((tick) => tick.label)).toEqual(['Juan', 'Lucas']);
    // Cells keep a gap between them.
    const [a, b] = layout.cells;
    expect((b?.x ?? 0) - ((a?.x ?? 0) + (a?.width ?? 0))).toBeCloseTo(2);
  });

  it('writes values inside cells only when asked and when they fit', () => {
    expect(
      layoutHeatmap(wellnessSpec, { width: 300, height: 100 }).cells.some((c) => c.showText),
    ).toBe(false);
    const shown = layoutHeatmap({ ...wellnessSpec, showValues: true }, { width: 300, height: 100 });
    expect(shown.cells.filter((c) => c.showText)).toHaveLength(5);
    const tiny = layoutHeatmap({ ...wellnessSpec, showValues: true }, { width: 60, height: 30 });
    expect(tiny.cells.some((c) => c.showText)).toBe(false);
  });

  it('reads, tabulates and summarises in es-AR', () => {
    expect(heatmapReadoutText(wellnessSpec, 0, 2)).toBe('Juan · Mié. Valor: Sin dato.');
    expect(heatmapReadoutText(wellnessSpec, 1, 1)).toBe('Lucas · Mar. Valor: 4,8.');
    const table = heatmapTable(wellnessSpec);
    expect(table.columns.map((c) => c.label)).toEqual(['Lun', 'Mar', 'Mié']);
    expect(table.rows[0]?.cells.map((c) => c.text)).toEqual(['4,2', '3,1', '—']);
    expect(heatmapSummary(wellnessSpec)).toBe(
      'Bienestar de la semana. 2 filas por 3 columnas; valores de 2,6 a 4,8.',
    );
  });

  it('is empty without values and validates its shape', () => {
    const empty = {
      ...wellnessSpec,
      domain: undefined,
      values: [
        [null, null, null],
        [null, null, null],
      ],
    };
    expect(layoutHeatmap(empty, { width: 100, height: 100 }).empty).toBe(true);
    expect(heatmapSummary(empty)).toBe('Bienestar de la semana. Sin datos para mostrar.');
    expect(() => layoutHeatmap({ ...wellnessSpec, steps: 1 }, { width: 100, height: 100 })).toThrow(
      RangeError,
    );
    expect(() =>
      layoutHeatmap({ ...wellnessSpec, values: [[1, 2]] }, { width: 100, height: 100 }),
    ).toThrow(RangeError);
    expect(() =>
      layoutHeatmap({ ...wellnessSpec, domain: [5, 1] }, { width: 100, height: 100 }),
    ).toThrow(RangeError);
  });
});

describe('sparkline', () => {
  it('ends on a dot at the latest value and keeps the reference in range', () => {
    const layout = layoutSparkline(cmjSparkSpec, { width: 120, height: 32 });
    expect(layout.empty).toBe(false);
    expect(layout.last?.x).toBe(114);
    expect(layout.reference?.y).toBeGreaterThanOrEqual(6);
    expect(layout.reference?.y).toBeLessThan(layout.last?.y ?? 0);
    expect(layout.path.match(/M/g)?.length).toBe(2);
  });

  it('summarises and tabulates', () => {
    expect(sparklineSummary(cmjSparkSpec)).toBe(
      `CMJ. CMJ: 4 valores, de 38,2${NBSP}cm (V1 25) a 41,7${NBSP}cm (V1 26). Referencia de Primera: 45,0${NBSP}cm.`,
    );
    const table = sparklineTable(cmjSparkSpec);
    expect(table.rows[3]?.cells.map((c) => c.text)).toEqual(['—', `45,0${NBSP}cm`]);
  });

  it('is empty without values', () => {
    const empty = { ...cmjSparkSpec, values: [null, null, null, null, null], reference: undefined };
    expect(layoutSparkline(empty, { width: 120, height: 32 }).empty).toBe(true);
  });
});
